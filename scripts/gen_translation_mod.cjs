// Builds a translation mod for units that global never translated (released after its end of service):
//
//   node scripts/gen_translation_mod.cjs [unit ids...]        (default: every unit in units.json)
//
// Text comes from assets/translations/units.json (name, titles, skill, voice actor), when present
// assets/translations/<id>.json (profile, home lines, character stories, title conditions,
// encyclopedia), and assets/translations/events.json (event, mission, item and UI text). The patched tables go into .cdn/mods/translations.zip as hashed CDN files
// (production/upload/xx/...), which the server sends with the asset update (src/routes/api/asset.ts).
// .cdn/translations-revert.zip gets the untouched originals of the same files, to put in .cdn/mods in
// place of the mod if the game should go back to the Japanese text.
//
// Every edit names one column of one row and is refused unless that column holds Japanese text, so a
// wrong position or a changed table fails the build instead of overwriting something else.

const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const { ROOT, decodeFile, encodeFile, setLeafText, leaves, readHashedFile } = require("./cdn_rows.cjs")

const { uploadPath: hashed } = require("./cdn_hash.cjs")
const TABLES = {
    characterText: hashed("master/character/character_text.orderedmap"),
    character: hashed("master/character/character.orderedmap"),
    actionSkill: hashed("master/skill/action_skill.orderedmap"),
    speech: hashed("master/character/character_speech.orderedmap"),
    storyCharacter: hashed("master/story/story_character.orderedmap"),
    characterQuest: hashed("master/quest/character_quest.orderedmap"),
    degree: hashed("master/degree/degree.orderedmap"),
    degreeMission: hashed("master/mission/degree_mission.orderedmap"),
    encyclopedia: hashed("master/encyclopedia/encyclopedia.orderedmap"),
    // the character story list (one row per unit, keyed by its own number) and the table giving each
    // unit's row there (column 0); logical names unknown
    storyList: "production/upload/69/bb6ccf19b48beaf6436f51cdbe4e5444dde432",
    storyListIndex: "production/upload/aa/abdd2e178d62dba4997034aab8c236a4422154",
}
const scenario = (dev, episode) => hashed(`master/story/character_story_quest/${dev}_00${episode}/scenario.orderedmap`)

const TRANSLATIONS = path.join(ROOT, "assets", "translations")
const MOD_OUT = path.join(ROOT, ".cdn", "mods", "translations.zip")
const REVERT_OUT = path.join(ROOT, ".cdn", "translations-revert.zip")
const STORY_WIDTH = 38

// untranslated text: Japanese, or Korean (global left some post-EoS rows in Korean)
const JAPANESE = /[぀-ヿ㐀-鿿！-～가-힣]/
const isJapanese = s => JAPANESE.test(s)

/** CSV records of a row's text, each field with its span (quoted fields may hold commas and newlines). */
function parseRecords(text) {
    const records = []
    let fields = [], start = 0, value = "", quoted = false, i = 0
    const endField = end => { fields.push({ start, end, value }); value = ""; start = end + 1 }
    for (; i < text.length; i++) {
        const ch = text[i]
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') { value += '"'; i++ } else quoted = false
            } else value += ch
        } else if (ch === '"') quoted = true
        else if (ch === ",") endField(i)
        else if (ch === "\n") { endField(i); records.push(fields); fields = [] }
        else value += ch
    }
    endField(i)
    records.push(fields)
    return records
}

const csvField = value => /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

/** Wraps story text at `width` characters (explicit \n breaks are kept). */
function wrap(text, width) {
    return text.split("\n").map(paragraph => {
        const lines = []
        let line = ""
        for (const word of paragraph.split(" ")) {
            if (line && (line + " " + word).length > width) { lines.push(line); line = word } else line = line ? line + " " + word : word
        }
        lines.push(line)
        return lines.join("\n")
    }).join("\n")
}

/** Collects the edits for one unit: [{ file, key: [..], record?: (fields) => bool, col, en }]. */
function unitEdits(id, unit, extra) {
    const edits = []
    const add = (file, key, col, en, record, optional) => { if (en !== undefined && en !== null) edits.push({ file, key, col, en, record, optional }) }
    const ct = TABLES.characterText
    add(ct, [id], 0, unit.name)
    add(ct, [id], 2, extra?.profile)
    add(ct, [id], 3, unit.title)
    add(ct, [id], 4, unit.skill)
    add(ct, [id], 5, unit.skillText)
    add(ct, [id], 6, unit.skill && unit.skill + "+")
    add(ct, [id], 7, unit.skillText)
    add(ct, [id], 8, unit.leaderTitle)
    add(ct, [id], 9, unit.voice)
    add(TABLES.character, [id], 18, unit.leaderTitle)
    add(TABLES.degree, [id], 2, unit.title)
    // the second title (mana board 2) only some units have
    add(TABLES.degree, [String(1000000 + Number(id))], 2, unit.leaderTitle, undefined, true)
    const dev = unit.devName ?? extra?.devName
    if (dev) {
        add(TABLES.actionSkill, [dev, "1"], 0, unit.skill)
        add(TABLES.actionSkill, [dev, "1"], 1, unit.skillText)
        add(TABLES.actionSkill, [dev, "2"], 0, unit.skill + "+")
        add(TABLES.actionSkill, [dev, "2"], 1, unit.skillText)
        add(TABLES.storyCharacter, [dev], 0, unit.name)
    }
    add(TABLES.storyList, { storyListOf: id }, 0, unit.name)
    if (!extra) return edits

    for (const [key, name] of Object.entries(extra.storyNames ?? {})) add(TABLES.storyCharacter, [key], 0, name)
    add(TABLES.degree, [id], 4, extra.titleCondition)
    add(TABLES.degree, [String(1000000 + Number(id))], 4, extra.leaderTitleCondition, undefined, true)
    add(TABLES.degreeMission, [id], 2, extra.titleCondition)
    add(TABLES.degreeMission, [String(1000000 + Number(id))], 2, extra.leaderTitleCondition, undefined, true)
    for (const [voiceKey, en] of Object.entries(extra.speech ?? {})) add(TABLES.speech, [id], 3, en, fields => fields[fields.length - 1]?.value === voiceKey)
    for (const [episode, story] of Object.entries(extra.episodes ?? {})) {
        const questKey = [String(Number(id) * 100 + Number(episode))]
        add(TABLES.characterQuest, questKey, 3, story.title)
        add(TABLES.characterQuest, questKey, "summary", story.summary)
        const file = scenario(dev, episode)
        for (const [line, en] of Object.entries(story.lines ?? {})) add(file, { suffix: line }, 5, wrap(en, STORY_WIDTH))
    }
    for (const [key, cols] of Object.entries(extra.encyclopedia ?? {})) {
        for (const [col, en] of Object.entries(cols)) add(TABLES.encyclopedia, key.split("/"), Number(col), en)
    }
    // one-off rows in other tables, by hashed file: { "production/upload/..": { "row/key": { col: en } } }
    for (const [file, rows] of Object.entries(extra.otherRows ?? {})) {
        for (const [key, cols] of Object.entries(rows)) {
            for (const [col, en] of Object.entries(cols)) add(file, key.split("/"), Number(col), en)
        }
    }
    return edits
}

/** Applies a file's edits; returns problems (each edit must hit exactly one Japanese field). */
function applyEdits(tree, edits, storyListRows) {
    const problems = []
    const rows = leaves(tree)
    const byRow = new Map()
    for (const edit of edits) {
        let matches
        if (Array.isArray(edit.key)) matches = rows.filter(r => r.path.join("/") === edit.key.join("/"))
        else if (edit.key.suffix) matches = rows.filter(r => r.path[r.path.length - 1] === edit.key.suffix)
        else matches = rows.filter(r => r.path.length === 1 && r.path[0] === storyListRows[edit.key.storyListOf])
        if (matches.length === 0 && edit.optional) continue
        if (matches.length !== 1) { problems.push(`${edit.file} ${JSON.stringify(edit.key)}: ${matches.length} rows match`); continue }
        const row = matches[0]
        if (!byRow.has(row)) byRow.set(row, [])
        byRow.get(row).push(edit)
    }
    for (const [row, rowEdits] of byRow) {
        const text = row.leaf.text
        const records = parseRecords(text)
        const spans = []
        for (const edit of rowEdits) {
            const candidates = edit.record ? records.filter(edit.record) : records
            if (candidates.length !== 1) { problems.push(`${row.path.join("/")}: ${candidates.length} records match`); continue }
            const fields = candidates[0]
            const col = edit.col === "summary" ? fields.findIndex((f, i) => i > 3 && isJapanese(f.value)) : edit.col
            const field = fields[col]
            if (!field) { problems.push(`${row.path.join("/")}: no column ${edit.col}`); continue }
            if (!isJapanese(field.value)) {
                if (field.value !== edit.en) problems.push(`${row.path.join("/")} col ${col}: not Japanese (${field.value.slice(0, 40)}), left as is`)
                continue
            }
            spans.push({ field, en: edit.en })
        }
        spans.sort((a, b) => b.field.start - a.field.start)
        let out = text
        for (const { field, en } of spans) out = out.slice(0, field.start) + csvField(en) + out.slice(field.end)
        if (out !== text) setLeafText(row.leaf, out)
    }
    return problems
}

/**
 * Applies one table of assets/translations/events.json: every field in `cols` whose whole value is an
 * untranslated string listed in `strings` becomes its English. Returns the strings it used, so the
 * caller can refuse a table that no longer matches.
 */
function applyStringTable(tree, { cols, strings }) {
    const used = new Set()
    for (const row of leaves(tree)) {
        const text = row.leaf.text
        const spans = []
        for (const fields of parseRecords(text)) {
            for (const col of cols) {
                const field = fields[col]
                if (!field || !isJapanese(field.value) || !Object.hasOwn(strings, field.value)) continue
                used.add(field.value)
                spans.push({ field, en: strings[field.value] })
            }
        }
        spans.sort((a, b) => b.field.start - a.field.start)
        let out = text
        for (const { field, en } of spans) out = out.slice(0, field.start) + csvField(en) + out.slice(field.end)
        if (out !== text) setLeafText(row.leaf, out)
    }
    return used
}

// --- a small zip writer (deflate), enough for the mod archive ---
function zip(files) {
    const locals = [], centrals = []
    let offset = 0
    for (const { name, data } of files) {
        const nameBuf = Buffer.from(name, "utf8")
        const deflated = zlib.deflateRawSync(data)
        const crc = zlib.crc32(data)
        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8)
        local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(deflated.length, 18); local.writeUInt32LE(data.length, 22)
        local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28)
        const central = Buffer.alloc(46)
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10)
        central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(deflated.length, 20); central.writeUInt32LE(data.length, 24)
        central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42)
        locals.push(local, nameBuf, deflated)
        centrals.push(central, nameBuf)
        offset += 30 + nameBuf.length + deflated.length
    }
    const centralBuf = Buffer.concat(centrals)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
    end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16)
    return Buffer.concat([...locals, centralBuf, end])
}

module.exports = { parseRecords, csvField, wrap, unitEdits, applyEdits, applyStringTable, zip, TABLES }

if (require.main === module) (async () => {
    const units = JSON.parse(fs.readFileSync(path.join(TRANSLATIONS, "units.json"), "utf8"))
    const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(units).filter(k => !k.startsWith("_"))
    const edits = []
    for (const id of ids) {
        if (!units[id]) throw new Error(`Unit ${id} isn't in units.json.`)
        const extraPath = path.join(TRANSLATIONS, `${id}.json`)
        const extra = fs.existsSync(extraPath) ? JSON.parse(fs.readFileSync(extraPath, "utf8")) : null
        for (const edit of unitEdits(id, units[id], extra)) edits.push({ ...edit, unit: id })
    }

    // each unit's row in the character story list
    const storyListRows = {}
    for (const row of leaves(decodeFile(await readHashedFile(TABLES.storyListIndex)))) if (ids.includes(row.path[0])) storyListRows[row.path[0]] = parseRecords(row.leaf.text)[0][0].value

    // event, mission, item and UI text (assets/translations/events.json)
    const eventsPath = path.join(TRANSLATIONS, "events.json")
    const eventTables = fs.existsSync(eventsPath) ? JSON.parse(fs.readFileSync(eventsPath, "utf8")).tables : {}

    const files = [...new Set([...edits.map(e => e.file), ...Object.keys(eventTables)])]
    const modFiles = [], revertFiles = []
    const problems = []
    for (const file of files) {
        const original = await readHashedFile(file)
        const tree = decodeFile(original)
        for (const id of ids) {
            const unitEditsForFile = edits.filter(e => e.file === file && e.unit === id)
            if (unitEditsForFile.length) problems.push(...applyEdits(tree, unitEditsForFile, storyListRows).map(p => `[${id}] ${p}`))
        }
        if (eventTables[file]) {
            const used = applyStringTable(tree, eventTables[file])
            for (const jp of Object.keys(eventTables[file].strings)) if (!used.has(jp)) problems.push(`[events: ${eventTables[file].name}] ${file}: ${JSON.stringify(jp).slice(0, 60)} not found`)
        }
        const patched = encodeFile(tree)
        if (Buffer.compare(patched, original) === 0) continue
        modFiles.push({ name: file, data: patched })
        revertFiles.push({ name: file, data: original })
        console.log(`${file}: ${edits.filter(e => e.file === file).length} edits${eventTables[file] ? ` + ${eventTables[file].name}` : ""}`)
    }
    for (const p of problems) console.log(`WARNING ${p}`)
    if (problems.some(p => !p.includes("left as is"))) throw new Error(`${problems.length} edits didn't apply; nothing written.`)

    fs.mkdirSync(path.dirname(MOD_OUT), { recursive: true })
    fs.writeFileSync(MOD_OUT, zip(modFiles))
    fs.writeFileSync(REVERT_OUT, zip(revertFiles))
    console.log(`Wrote ${MOD_OUT} (${modFiles.length} files) and ${REVERT_OUT}.`)
})()
