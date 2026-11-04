// Armament editor (dashboard Unit editor > Armaments, docs/UNIT_EDITOR.md): an armament's abilities, stats, name and
// description, with the unit editor's checks and wording, saved as a change file
// (<custom units folder>/changes/armament-editor-<id>.json) that the CN schedule build ships.
//
// The tables (names from the CN 1.8.1 client's parsers):
//   master/item/equipment          <id>: string_id, name, kind, ..., pixelart, description, max_level (col 8), ...
//   master/item/equipment_status   <id>/<level>: hp, atk at armament levels 1 (and 3, 5)
//   master/ability/ability_soul    <id>: one line per (slot, learn_level): slot, learn_level, kind, then the unit
//                                  ability layout 3 columns to the left. The client keeps, per slot, the line with the
//                                  highest learn level the armament has reached; values scale from level 1 to max level.
// The server keeps no copy of any of these (src/lib/equipment.ts only stores owner, level, enhancement, stack).
const fs = require("fs")
const path = require("path")
const UE = require("./unit_editor.cjs")
const CU = require("./custom_units.cjs")
const TEXT = require("./unit_editor_text.cjs")
const { gameTable, lines, rowText, pad, uniqueIds, uniqueName, soulToAbility, abilityToSoul } = UE._internal
const CODES = require(path.join(__dirname, "..", "assets", "unit_editor", "ability_codes.json"))

const T = { equipment: "master/item/equipment.orderedmap", status: "master/item/equipment_status.orderedmap", soul: "master/ability/ability_soul.orderedmap" }
const PREFIX = "armament-editor-"
/** The most slots (effects) an armament may have, and versions per slot: CN's own most (10 slots; levels 1, 3, 5). */
const MAX_SLOTS = 10, MAX_VERSIONS = 3
const SOUL_COLUMNS = 123

let base = null
async function baseTables() {
    if (base) return base
    base = {}
    for (const [k, logical] of Object.entries(T)) base[k] = await gameTable(logical)
    return base
}
const editorFile = id => path.join(CU.customUnitsDir(), "changes", `${PREFIX}${id}.json`)
const editorFiles = () => {
    const dir = path.join(CU.customUnitsDir(), "changes")
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.startsWith(PREFIX) && f.endsWith(".json")).map(f => ({ id: f.slice(PREFIX.length, -5), file: path.join(dir, f) })) : []
}

/** Every armament (name, rarity, max level, edited). */
async function listArmaments() {
    const b = await baseTables()
    const edited = new Set(editorFiles().map(f => f.id))
    return Object.entries(b.equipment).filter(([id]) => !id.includes("/")).map(([id, text]) => {
        const c = lines(text)[0]
        return { id, name: c[1] || c[0], rarity: Number(c[5]), maxLevel: Number(c[8]) || 1, edited: edited.has(id) }
    }).sort((a, b) => a.name.localeCompare(b.name))
}

/** An armament's rows as the game will have them (its own, with every change file on top) and its own. */
async function armamentRows(id) {
    const b = await baseTables()
    if (b.equipment[id] === undefined) return null
    const own = {
        equipment: { [id]: b.equipment[id] },
        status: Object.fromEntries(Object.entries(b.status).filter(([k]) => k.startsWith(id + "/"))),
        soul: b.soul[id] === undefined ? {} : { [id]: b.soul[id] },
    }
    const current = JSON.parse(JSON.stringify(own))
    const changes = CU.readUnitChanges()
    for (const [k, logical] of Object.entries(T)) {
        const rows = changes.rows.get(require("./cdn_hash.cjs").uploadPath(logical))
        if (!rows) continue
        for (const [key, value] of rows) {
            if (current[k][key] === undefined) continue
            if (typeof value === "string") current[k][key] = value.replace(/\n$/, "")
            else { const ls = lines(current[k][key]); for (const [i, v] of Object.entries(value.cols ?? {})) ls[0][+i] = String(v); current[k][key] = rowText(ls) }
        }
    }
    return { own, current }
}

/** Soul lines grouped by slot (each slot = one effect, its lines = versions by learn level), in the ability layout. */
function slotsOf(text) {
    const out = []
    for (const c of lines(text ?? "")) {
        const slot = Number(c[0]) || 0
        ;(out[slot] ??= []).push(pad(soulToAbility(c)))
    }
    return out.filter(Boolean).map(ls => ls.sort((a, b) => Number(a[2]) - Number(b[2])))
}

/** The page's view of an armament (the same shape as a unit's: abilities = slots, no leader or skills). */
async function getArmament(id) {
    id = String(id)
    const r = await armamentRows(id)
    if (!r) return null
    const c = lines(r.current.equipment[id])[0], g = lines(r.own.equipment[id])[0]
    const maxLevel = Number(c[8]) || 1
    const own = slotsOf(r.own.soul[id]), cur = slotsOf(r.current.soul[id])
    const stats = Object.keys(r.current.status).map(k => k.split("/")[1]).sort((a, b) => a - b).map(level => {
        const [hp, atk] = lines(r.current.status[`${id}/${level}`])[0], [ghp, gatk] = lines(r.own.status[`${id}/${level}`] ?? "")[0] ?? []
        return { level, hp: Number(hp), atk: Number(atk), game: { hp: Number(ghp), atk: Number(gatk) } }
    })
    return {
        kind: "armament", id, name: c[1] || c[0], title: "armament", rarity: Number(c[5]), element: "", maxLevel,
        custom: false, saved: fs.existsSync(editorFile(id)), others: [], kit: false,
        abilities: cur.map((ls, i) => ({ key: `slot${i}`, slot: i + 1, lines: ls, game: own[i] ?? [] })),
        leader: null, skills: [], stats,
        details: { name: c[1] ?? "", description: c[7] ?? "", hasText: true, armament: true, game: { name: g[1] ?? "", description: g[7] ?? "" } },
    }
}

/** The armament in the game's words: at level 1 (each slot's version learned by then) and at its max level. */
function armamentText(slots, maxLevel, strings) {
    const at = (level, power) => {
        // per effect, the version from the highest level reached ({ slot, line } kept for a line the game's wording can't cover yet)
        const chosen = slots.map((ls, slot) => ls.map((c, line) => ({ c, slot, line })).filter(x => Number(x.c[2] || 1) <= level).sort((a, b) => Number(b.c[2]) - Number(a.c[2]))[0]).filter(Boolean)
        return TEXT.abilityText(chosen.map(x => x.c), power, strings, CODES, i => ({ slot: chosen[i].slot, line: chosen[i].line }))
    }
    return { low: at(1, "low"), high: at(maxLevel, "high") }
}

/**
 * Checks an armament edit: the unit editor's line checks (guard rails, contradictions, unreadable rows), plus the
 * armament's own rules: learn levels 1 to max level and different within a slot, at most MAX_SLOTS slots and
 * MAX_VERSIONS versions each, a max level 1 armament can't scale (the client stops on min != max then), a
 * unit-specific buff only if the armament's own rows use it.
 */
async function checkArmament(id, edit, advanced = false) {
    const r = await armamentRows(String(id))
    const maxLevel = r ? Number(lines(r.current.equipment[id])[0][8]) || 1 : 5
    const out = await UE.checkEdit({ ...edit, id: undefined, leader: null, skills: [] }, advanced)
    const own = new Set(slotsOf(r?.own.soul[id]).flat().flatMap(uniqueIds))
    const problems = []
    if ((edit.abilities ?? []).length > MAX_SLOTS) problems.push(`${edit.abilities.length} effects; the most is ${MAX_SLOTS}`)
    ;(edit.abilities ?? []).forEach((a, i) => {
        if (a.lines.length > MAX_VERSIONS) problems.push(`Effect ${i + 1} has ${a.lines.length} versions; the most is ${MAX_VERSIONS}`)
        const levels = a.lines.map(c => Number(c[2] || 1))
        if (new Set(levels).size !== levels.length) problems.push(`Effect ${i + 1} has two versions from the same armament level`)
        a.lines.forEach((c, n) => {
            const res = out.abilities[i]?.[n]
            if (!res) return
            const lv = Number(c[2] || 1)
            if (!Number.isInteger(lv) || lv < 1 || lv > maxLevel) res.errors.push(`"from armament level" must be 1 to ${maxLevel}`)
            if (maxLevel === 1 && pairsDiffer(pad(c))) res.errors.push("this armament has only level 1, so every min and max must be equal (the game stops otherwise)")
            for (const u of uniqueIds(pad(c))) if (!own.has(u)) res.errors.push("uses another unit's or armament's own buff: only its owner can use it")
        })
    })
    out.tooMany = [...(out.tooMany ?? []).filter(t => !t.startsWith("Leader")), ...problems]
    out.ok = out.ok && problems.length === 0 && out.abilities.flat().every(x => x.errors.length === 0)
    const strings = (await UE.catalog()).strings
    try { out.texts = { abilities: [armamentTextGroup(edit.abilities ?? [], maxLevel, strings)], leader: null, armament: true } } catch { out.texts = null }
    return out
}
const armamentTextGroup = (abilities, maxLevel, strings) => armamentText(abilities.map(a => a.lines.map(pad)), maxLevel, strings)
// any pair whose min and max differ (the fields a line's codes read)
function pairsDiffer(c) {
    for (const [part, at] of [["condition", 6], ["condition", 13], ["condition", 20], ["whenTrigger", 27], ["whenEffect", 47], ["whileTrigger", 97], ["whileEffect", 109]]) {
        const fields = CODES[part]?.[c[at]]?.fields ?? {}
        for (const d of Object.values(fields)) if (d.pair && c[d.cols[0]] !== c[d.cols[1]]) return true
    }
    return false
}

/** Saves an armament edit: only rows that differ from the game's own, as a change file. */
async function saveArmament(id, edit, advanced = false) {
    id = String(id)
    const check = await checkArmament(id, edit, advanced)
    if (!check.ok) return { errors: check }
    const r = await armamentRows(id)
    if (!r) return { errors: { message: `no armament ${id}` } }
    const rows = {}
    // abilities: slots renumbered 0.., each version a line (slot, learn level, kind, ...)
    const soul = (edit.abilities ?? []).flatMap((a, slot) => a.lines.map(c => { const s = abilityToSoul(pad(c)); s[0] = String(slot); return s.slice(0, SOUL_COLUMNS) }))
    const soulText = rowText(soul)
    if (r.own.soul[id] !== undefined && soulText !== r.own.soul[id]) rows[`${T.soul}#${id}`] = soulText
    for (const s of edit.stats ?? []) {
        const key = `${id}/${s.level}`
        if (r.own.status[key] !== undefined && `${s.hp},${s.atk}` !== r.own.status[key]) rows[`${T.status}#${key}`] = `${s.hp},${s.atk}`
    }
    if (edit.details) {
        const g = lines(r.own.equipment[id])[0], cols = {}
        if (edit.details.name !== undefined && edit.details.name !== g[1]) cols[1] = edit.details.name
        if (edit.details.description !== undefined && edit.details.description !== g[7]) cols[7] = edit.details.description
        if (Object.keys(cols).length) rows[`${T.equipment}#${id}`] = { cols }
    }
    const file = editorFile(id)
    if (Object.keys(rows).length === 0) { if (fs.existsSync(file)) fs.unlinkSync(file); return { file: null, rows: 0 } }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ [id]: { name: `Armament editor: ${lines(r.own.equipment[id])[0][1] || id}`, rows } }, null, 1) + "\n")
    return { file, rows: Object.keys(rows).length }
}

function resetArmament(id) {
    const file = editorFile(String(id))
    if (!fs.existsSync(file)) return false
    fs.unlinkSync(file)
    return true
}

/** The editor's armament changes as one file (all, or some ids): itself a unit change file. */
function exportArmamentKits(ids = []) {
    const want = new Set(ids.map(String))
    const out = { _format: "globalpoint-armament-kits", _note: "Armament editor kits (GlobalPoint). Import on the dashboard's Unit editor page (Armaments), or put this file in the custom units folder's changes/." }
    for (const { id, file } of editorFiles()) {
        if (want.size && !want.has(id)) continue
        try { Object.assign(out, JSON.parse(fs.readFileSync(file, "utf8"))) } catch { }
    }
    return out
}

/** Imports armament kits: each armament's rows become its editor file if they're its own and pass the checks. */
async function importArmamentKits(data) {
    const imported = [], refused = []
    if (!data || typeof data !== "object") return { imported, refused: [{ id: "", why: "not a kit file" }] }
    const b = await baseTables()
    for (const [id, kit] of Object.entries(data)) {
        if (id.startsWith("_")) continue
        const no = why => refused.push({ id, why })
        if (b.equipment[id] === undefined) { no("no armament with this id"); continue }
        if (!kit || typeof kit.rows !== "object") { no("no rows"); continue }
        const bad = Object.keys(kit.rows).filter(ref => {
            const at = ref.indexOf("#"), table = ref.slice(0, at), key = ref.slice(at + 1)
            return at < 0 || !Object.values(T).includes(table) || !(key === id || key.startsWith(id + "/"))
        })
        if (bad.length) { no(`rows that aren't this armament's: ${bad.slice(0, 3).join(", ")}`); continue }
        const file = editorFile(id), before = fs.existsSync(file) ? fs.readFileSync(file) : null
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify({ [id]: { name: kit.name ?? `Armament editor: ${id}`, rows: kit.rows } }, null, 1) + "\n")
        const a = await getArmament(id), check = await checkArmament(id, a, true)
        if (!check.ok) { if (before) fs.writeFileSync(file, before); else fs.unlinkSync(file); no("some lines can't be read by the game or break the armament's rules"); continue }
        imported.push(id)
    }
    return { imported, refused }
}

/** Another armament's lines, to copy one (each slot's versions). */
async function armamentLines(id) {
    const a = await getArmament(id)
    return a && { id: a.id, name: a.name, abilities: a.abilities.map(x => ({ slot: x.slot, lines: x.lines })), leader: [] }
}

module.exports = { listArmaments, getArmament, checkArmament, saveArmament, resetArmament, exportArmamentKits, importArmamentKits, armamentLines, armamentText, MAX_SLOTS, MAX_VERSIONS, _setBase: b => { base = b } }
