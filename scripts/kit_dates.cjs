// Unit kits before a balance change (assets/kit_dates.json), shared by the CN update builder
// (scripts/gen_cn_event_schedule.cjs) and the server (src/nya/eventSchedule.ts, which rebuilds the update
// when the game clock crosses a kit date).
//
// A unit is { name, stages: [{ until, source, rows }] } (or one stage written inline: { until, rows }).
// Until a stage's date (game clock, UTC) its rows ship instead of the game's own; the earliest stage
// still ahead of the clock wins, so a unit changed by two patches lists its oldest kit first. Row keys
// are "<table>#<row key>", values a full row or { cols: { <index>: text } } for one line's columns.
// <table> is a logical name (master/ability/ability.orderedmap) or a stored path (upload/5c/6a4f...); a row key
// in a nested table joins its keys with "/" (character_status "111001/80").
const fs = require("fs")

const parseDate = text => Date.parse(String(text).replace(" ", "T") + "Z")

/** The units of a kit file with their stages, oldest first. Empty when there is no file. */
function readKits(file) {
    if (!fs.existsSync(file)) return null
    const raw = JSON.parse(fs.readFileSync(file, "utf8"))
    const units = new Map()
    for (const [unit, kit] of Object.entries(raw)) {
        if (unit.startsWith("_") || kit === null || typeof kit !== "object") continue
        const stages = (Array.isArray(kit.stages) ? kit.stages : [kit])
            .map(s => ({ until: parseDate(s.until), rows: s.rows ?? {} }))
            .filter(s => !isNaN(s.until))
            .sort((a, b) => a.until - b.until)
        units.set(unit, stages)
    }
    return units
}

/** Each unit's stage in force at a moment (ms), or null when the game's own kit applies. */
function activeStages(kits, nowMs) {
    const out = new Map()
    for (const [unit, stages] of kits ?? []) out.set(unit, stages.find(s => nowMs < s.until) ?? null)
    return out
}

/** A short text naming every unit's stage in force, to tell when the update needs rebuilding. */
function kitState(kits, nowMs) {
    return [...activeStages(kits, nowMs)].map(([unit, s]) => `${unit}:${s === null ? "now" : s.until}`).sort().join(",")
}

// ---- matching a balance patch note's unit names to unit ids (scripts/build_kit_text.cjs, test_kit_dates.mjs) ----

/** The note's misspellings -> global's spelling. */
const NAME_FIXES = { "lavish tunderbolt metis": "lavish thunderbolt metis", "sunny-sdie fambler naska": "sunny-side gambler naska", "knight of the whilte helm gerard": "knight of the white helm gerard", "the neovilolin virtuoso lyra": "the neoviolin virtuoso lyra", "hight-hat negotiant libram": "high-hat negotiant libram", "one-eyed gunnder selgir": "one-eyed gunner selgir" }
const normName = s => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' !&.-]/g, " ").replace(/\s+/g, " ").trim()

/**
 * A lookup from a note's unit name to its id, from global's character_text rows ({ id: text }, name in column 0,
 * title in 3): the first unit with that title + name (story copies of a unit share it and come later).
 */
function unitNameLookup(characterText, splitCsv) {
    const byName = new Map()
    for (const [id, t] of Object.entries(characterText)) { const c = splitCsv(t); const key = normName(`${c[3]} ${c[0]}`); if (!byName.has(key)) byName.set(key, id) }
    return name => { const n = normName(name); return byName.get(NAME_FIXES[n] ?? n) ?? null }
}

module.exports = { readKits, activeStages, kitState, unitNameLookup }
