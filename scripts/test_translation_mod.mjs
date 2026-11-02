// Checks the translation mod (scripts/gen_translation_mod.cjs) against the original CDN files:
//   node scripts/test_translation_mod.mjs        (after building the mod)
// - every file in .cdn/mods/translations.zip decodes, and only rows of translated units changed
// - those rows hold no Japanese except the fields English units keep in Japanese too (readings)
// - story lines are wrapped like global's (at most 38 characters a line)
// - the revert archive holds the untouched originals
// - event/mission/item/UI tables (events.json) change only their listed columns, to the listed English
// - the CSV helpers round-trip quoted fields, commas and newlines

import { createRequire } from "module"
import fs from "fs"
import path from "path"
const require = createRequire(import.meta.url)
const unzipper = require("unzipper")
const { decodeFile, leaves, readHashedFile, ROOT } = require("./cdn_rows.cjs")
const { parseRecords, csvField, wrap, TABLES } = require("./gen_translation_mod.cjs")

let failures = 0
const check = (ok, what) => { if (!ok) { failures++; console.log(`FAIL ${what}`) } else console.log(`ok   ${what}`) }
const japanese = /[぀-ヿ㐀-鿿]/

// CSV helpers
{
    const text = `0,2,,"Hello, ""you""\nthere",home/a\n1,,1,plain,ally/b`
    const records = parseRecords(text)
    check(records.length === 2 && records[0][3].value === 'Hello, "you"\nthere' && records[1][3].value === "plain", "parseRecords reads quoted fields and several records")
    check(csvField('a, "b"') === '"a, ""b"""' && csvField("plain") === "plain", "csvField quotes only when needed")
    check(wrap("one two three four five six seven", 10).split("\n").every(l => l.length <= 10), "wrap keeps lines to the width")
}

const units = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "translations", "units.json"), "utf8"))
const modPath = path.join(ROOT, ".cdn", "mods", "translations.zip")
const revertPath = path.join(ROOT, ".cdn", "translations-revert.zip")
check(fs.existsSync(modPath) && fs.existsSync(revertPath), "mod and revert archives exist")

const mod = await unzipper.Open.file(modPath)
const revert = await unzipper.Open.file(revertPath)
check(mod.files.length > 0 && mod.files.length === revert.files.length, `mod has ${mod.files.length} files, revert the same`)

// which unit a row belongs to (by id, dev name or story file)
const translatedIds = new Set(Object.keys(units).filter(k => !k.startsWith("_")))
const devNames = new Set([...translatedIds].map(id => units[id].devName))
// units with full text (their own <id>.json): only their rows must be free of Japanese
const fullIds = new Set([...translatedIds].filter(id => fs.existsSync(path.join(ROOT, "assets", "translations", `${id}.json`))))
const fullDevNames = [...fullIds].map(id => units[id].devName)
// story names a unit's file translates (background characters such as old_woman)
for (const id of fullIds) for (const key of Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "translations", `${id}.json`), "utf8")).storyNames ?? {})) devNames.add(key), fullDevNames.push(key)
const isFullRow = key => fullIds.has(key) || fullIds.has(String(Number(key) - 1000000)) || fullIds.has(String(Math.floor(Number(key) / 100)))
    || fullDevNames.some(d => key === d || key.startsWith(d + "_")) || key.startsWith("mob_") || !/^\d+$/.test(key) && !devNames.has(key)
// fields English units keep in Japanese: character_text col 1 (Japanese name), degree col 3 (reading),
// encyclopedia col 17 (reading)
const keptJapanese = { [TABLES.characterText]: [1], [TABLES.degree]: [3], [TABLES.encyclopedia]: [17] }

// event, mission, item and UI tables (assets/translations/events.json): only listed columns change,
// each to the English its Japanese/Korean value is listed with, and no listed value is left
const eventsPath = path.join(ROOT, "assets", "translations", "events.json")
const eventTables = fs.existsSync(eventsPath) ? JSON.parse(fs.readFileSync(eventsPath, "utf8")).tables : {}
check(Object.keys(eventTables).every(file => !Object.values(TABLES).includes(file)), `events.json: ${Object.keys(eventTables).length} tables, none of them unit tables`)
for (const file of Object.keys(eventTables)) check(mod.files.some(e => e.path === file), `${eventTables[file].name}: in the mod`)

for (const entry of mod.files) {
    const name = entry.path
    const patched = await entry.buffer()
    const original = await readHashedFile(name)
    const revertEntry = revert.files.find(e => e.path === name)
    check(revertEntry && Buffer.compare(await revertEntry.buffer(), original) === 0, `${name}: revert copy is the original`)
    let tree
    try { tree = decodeFile(patched) } catch (e) { check(false, `${name}: decodes (${e.message})`); continue }
    const before = new Map(leaves(decodeFile(original)).map(r => [r.path.join("/"), r.leaf.text]))
    const after = leaves(tree)
    check(after.length === before.size && after.every(r => before.has(r.path.join("/"))), `${name}: same ${before.size} rows and keys`)
    const changed = after.filter(r => before.get(r.path.join("/")) !== r.leaf.text)
    const events = eventTables[name]
    if (events) {
        let wrongField = 0, left = 0
        for (const row of changed) {
            const was = parseRecords(before.get(row.path.join("/"))), now = parseRecords(row.leaf.text)
            if (was.length !== now.length || was.some((fields, i) => fields.length !== now[i].length)) { wrongField++; continue }
            was.forEach((fields, i) => fields.forEach((f, col) => {
                if (f.value !== now[i][col].value && !(events.cols.includes(col) && events.strings[f.value] === now[i][col].value)) wrongField++
            }))
        }
        for (const row of after) for (const fields of parseRecords(row.leaf.text)) for (const col of events.cols) if (fields[col] && Object.hasOwn(events.strings, fields[col].value)) left++
        check(changed.length > 0, `${events.name}: ${changed.length} rows changed`)
        check(wrongField === 0, `${events.name}: only listed columns changed, each to its listed English`)
        check(left === 0, `${events.name}: no listed text left untranslated`)
        continue
    }
    const isStory = changed.some(r => r.path[0].startsWith("story/character_story_quest/"))
    let stray = 0, leftover = 0, wide = 0
    for (const row of changed) {
        const text = row.leaf.text
        const records = parseRecords(text)
        const ownRow = isStory || translatedIds.has(row.path[0]) || translatedIds.has(String(Number(row.path[0]) - 1000000)) || [...devNames].some(d => row.path[0] === d || row.path[0].startsWith(d + "_"))
            || row.path[0].startsWith("mob_") || Math.floor(Number(row.path[0]) / 100) + "" in units || /^\d+$/.test(row.path[0])
        if (!ownRow) stray++
        if (isStory || isFullRow(row.path[0])) records.forEach(fields => fields.forEach((f, col) => {
            if (japanese.test(f.value) && !(keptJapanese[name] ?? []).includes(col)) leftover++
        }))
        if (isStory) for (const line of records[0][5].value.split("\n")) if (line.length > 38) wide++
    }
    check(changed.length > 0, `${name}: ${changed.length} rows changed`)
    check(stray === 0, `${name}: no rows of other units changed`)
    if (!isStory) check(leftover === 0, `${name}: no Japanese left in the changed rows`)
    else {
        // story files: only dialogue was translated; every changed line has no Japanese left
        check(changed.every(r => !japanese.test(parseRecords(r.leaf.text)[0][5].value)), `${name}: every changed line is English`)
        const untranslated = after.filter(r => r.leaf.text.startsWith("0,") && japanese.test(parseRecords(r.leaf.text)[0][5].value))
        check(untranslated.length === 0, `${name}: no Japanese dialogue left (${untranslated.length})`)
        check(wide === 0, `${name}: story lines fit 38 characters`)
    }
}

// spot checks on the main table
const textEntry = mod.files.find(e => e.path === TABLES.characterText)
const textRow = leaves(decodeFile(await textEntry.buffer())).find(r => r.path[0] === "131134")
const fields = parseRecords(textRow.leaf.text)[0]
check(fields[0].value === "Käsivars" && fields[1].value === "カシヴァルス" && fields[3].value === "Cage Liberator" && fields[8].value === "Body Designer Full of Desire", "character_text: Käsivars' name and titles, Japanese name kept")
check(fields.length === 10, "character_text: still 10 columns")

console.log(failures === 0 ? "\nAll translation mod checks passed." : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
