// Unit kits before a balance change (assets/kit_dates.json), shared by the CN update builder
// (scripts/gen_cn_event_schedule.cjs) and the server (src/nya/eventSchedule.ts, which rebuilds the update
// when the game clock crosses a kit date).
//
// A unit is { name, stages: [{ until, source, rows }] } (or one stage written inline: { until, rows }).
// Until a stage's date (game clock, UTC) its rows ship instead of the game's own; the earliest stage
// still ahead of the clock wins, so a unit changed by two patches lists its oldest kit first. Row keys
// are "<table>#<row key>", values a full row or { cols: { <index>: text } } for one line's columns.
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

module.exports = { readKits, activeStages, kitState }
