// Custom units (docs/CUSTOM_UNITS.md): new CN units made from game data and files only, one JSON file per
// unit in assets/custom_units/ (or CUSTOM_UNITS_DIR, relative paths from the repo folder). Shared by the CN
// schedule build (scripts/gen_cn_event_schedule.cjs adds the rows to the tables it ships), the server
// (src/lib/assets.ts merges the unit into its character, Mana Board and summon data) and
// scripts/research/clone_cn_unit.cjs (writes such a file).
//
// A unit file:
//   {
//     "id": "111907", "dev": "gp_test_haruhi", "name": "Haruhi (GP Test)",
//     "character": { "name": "", "rarity": 5, "element": 0, "skill_count": 6, "cn": true },   // assets/character.json entry
//     "manaNodes": { "1": { "<node id>": { items, manaCost, field1, field5, field6 } }, "2": {...} },  // mana_node_cn.json board
//     "banners": ["1613"],            // optional: summon banners (assets/gacha.json) whose pool gets the unit
//     "art": { "patch": "1.4.900", "files": ["production/medium_upload/ab/cd...", ...] },  // the unit's own files
//     "rows": { "<table>": { "<row key>": "<row text>" | { "<sub key>": ... } } }
//   }
// <table> is a stored path ("upload/5c/6a4f...", as CN names tables without a known logical name) or a logical
// name ("master/character/character.orderedmap"). Rows nest like the table: a string is a row's text, an
// object a map of rows (e.g. character_status "<id>": { "1": ..., "10": ... }). JSON puts number-like keys
// in ascending order; the game looks rows up by key, so order doesn't matter.
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { uploadPath } = require("./cdn_hash.cjs")

const ROOT = path.join(__dirname, "..")
const MANA_NODE_TABLE = "production/upload/1d/222e5126fc7ebe3f22c7efe87325f73742eb4f" // master/mana_board/mana_node
const CHARACTER_TABLE = "production/upload/2d/5cb9b28d18f984a51b345a4d7aab03d77bddfc" // master/character/character

/** The folder of custom unit files: CUSTOM_UNITS_DIR (relative to the repo folder), else assets/custom_units. */
function customUnitsDir() {
    return path.resolve(ROOT, process.env.CUSTOM_UNITS_DIR || path.join("assets", "custom_units"))
}

/** A table reference as its stored path, "production/upload/ab/cdef...". */
function tableFile(ref) {
    if (/^production\/[a-z_]+\/[0-9a-f]{2}\/[0-9a-f]{38}$/.test(ref)) return ref
    if (/^[a-z_]+upload\/[0-9a-f]{2}\/[0-9a-f]{38}$/.test(ref) || /^upload\/[0-9a-f]{2}\/[0-9a-f]{38}$/.test(ref)) return "production/" + ref
    return uploadPath(ref)
}

/** A Mana Board node id the game can find: unit * 2000 + board * 200 + index (GeneralManaNodeLogic.get_values). */
const manaNodeId = (unit, board, index) => Number(unit) * 2000 + Number(board) * 200 + Number(index)
const nodeIdFits = (unit, board, id) => {
    const n = Number(id), index = n % 200
    return Number.isInteger(n) && Math.floor(n / 2000) === Number(unit) && Math.floor(n / 200) % 10 === Number(board) && index >= 1
}

/** What's wrong with a unit file (empty when nothing). */
function unitProblems(unit) {
    const problems = []
    // the game reads rarity and element from the character row (columns 2, 3), not the id (CN has 700000-700019, 999999);
    // only StarPoint's summon reads the first digit (src/lib/gacha.ts: stars = 6 - digit), so it must match the rarity
    // when the unit is in a summon banner. The second digit (element) is convention only.
    if (!/^\d{6}$/.test(String(unit.id ?? ""))) problems.push(`id "${unit.id}" isn't a unit id (6 digits)`)
    else if ((unit.banners ?? []).length > 0 && unit.character && Number(String(unit.id)[0]) !== 6 - Number(unit.character.rarity))
        problems.push(`id ${unit.id} starts with ${String(unit.id)[0]}, but a summonable ${unit.character.rarity}★ unit needs ${6 - Number(unit.character.rarity)} (the summon screen's rarity comes from it)`)
    if (!/^[a-z0-9_]+$/.test(String(unit.dev ?? ""))) problems.push(`dev (string id) "${unit.dev}" must be lower case letters, digits and _`)
    if (!unit.character || typeof unit.character !== "object") problems.push("no character entry")
    if (!unit.rows || typeof unit.rows !== "object") problems.push("no rows")
    for (const [board, nodes] of Object.entries(unit.manaNodes ?? {}))
        for (const id of Object.keys(nodes ?? {}))
            if (!nodeIdFits(unit.id, board, id)) problems.push(`Mana Board ${board} node ${id} isn't ${unit.id} * 2000 + ${board} * 200 + index`)
    for (const [ref, rows] of Object.entries(unit.rows ?? {})) {
        if (tableFile(ref) !== MANA_NODE_TABLE) continue
        for (const [key, boards] of Object.entries(rows ?? {})) for (const [board, nodes] of Object.entries(boards ?? {}))
            for (const [index, text] of Object.entries(nodes ?? {})) {
                const id = String(typeof text === "string" ? text : "").split(",")[0]
                if (key !== String(unit.id) || String(manaNodeId(unit.id, board, index)) !== id)
                    problems.push(`mana_node row ${key}/${board}/${index} has node id ${id}, not ${manaNodeId(unit.id, board, index)}`)
            }
    }
    return problems
}

/**
 * Every unit file in a folder (sorted by name). Files with problems are left out and listed in problems,
 * so a bad file never stops the server.
 */
function readCustomUnits(dir = customUnitsDir()) {
    const units = [], problems = []
    if (!fs.existsSync(dir)) return { units, problems, fingerprint: "" }
    const hash = crypto.createHash("sha1")
    const seen = new Set()
    for (const name of fs.readdirSync(dir).filter(f => f.endsWith(".json") && !f.startsWith("_")).sort()) {
        const file = path.join(dir, name)
        let unit
        try {
            const text = fs.readFileSync(file, "utf8")
            hash.update(name + "\0" + text + "\0")
            unit = JSON.parse(text)
        } catch (e) { problems.push(`${name}: ${e.message}`); continue }
        const found = unitProblems(unit)
        if (seen.has(String(unit.id))) found.push(`unit ${unit.id} is in another file too`)
        if (found.length > 0) { problems.push(...found.map(p => `${name}: ${p}`)); continue }
        seen.add(String(unit.id))
        units.push({ ...unit, id: String(unit.id), file })
    }
    return { units, problems, fingerprint: units.length || problems.length ? hash.digest("hex") : "" }
}

/** The stored paths of the tables a list of units adds rows to. */
function unitTables(units) {
    return [...new Set(units.flatMap(u => Object.keys(u.rows).map(tableFile)))].sort()
}

/** A JSON row value as a table node (cdn_rows.cjs tree: new nodes have no raw bytes, so they're encoded fresh). */
function toNode(value) {
    if (typeof value === "string") return { kind: "leaf", text: value }
    return { kind: "map", dirty: true, entries: Object.entries(value).map(([key, v]) => ({ key, node: toNode(v) })) }
}

/** A table node as a JSON row value (the reverse of toNode). */
function fromNode(node) {
    return node.kind === "leaf" ? node.text : Object.fromEntries(node.entries.map(e => [e.key, fromNode(e.node)]))
}

/** Adds (or replaces) a unit's rows of one table in a decoded table tree. Returns the row count. */
function addRows(tree, rows) {
    let added = 0
    for (const [key, value] of Object.entries(rows)) {
        tree.entries = tree.entries.filter(e => e.key !== key)
        tree.entries.push({ key, node: toNode(value) })
        added++
    }
    if (added > 0) tree.dirty = true
    return added
}

/** The units' summon pools: a banner's pool tier of the unit's rarity gets it at the tier's average weight,
 *  the others scaled down so the tier still sums the same (src/lib/gacha.ts rolls 0-1000 in list order). */
function addToGachaPools(gachas, units) {
    const out = { ...gachas }
    for (const unit of units) for (const banner of unit.banners ?? []) {
        const gacha = out[String(banner)]
        if (!gacha?.pool) continue
        const pool = { ...gacha.pool }
        const tier = Object.keys(pool).find(k => pool[k].some(item => item.rank === unit.character.rarity))
        if (tier === undefined || pool[tier].some(item => String(item.id) === unit.id)) continue
        const items = pool[tier], total = items.reduce((s, item) => s + item.rarity, 0), n = items.length
        pool[tier] = [...items.map(item => ({ ...item, rarity: item.rarity * n / (n + 1) })),
            { id: Number(unit.id), rank: unit.character.rarity, odds: 1, isRateUp: false, rarity: total / (n + 1) }]
        out[String(banner)] = { ...gacha, pool }
    }
    return out
}

module.exports = { customUnitsDir, tableFile, manaNodeId, unitProblems, readCustomUnits, unitTables, toNode, fromNode, addRows, addToGachaPools, MANA_NODE_TABLE, CHARACTER_TABLE }
