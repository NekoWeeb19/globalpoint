// CN's real calendar (assets/cn_calendar_dates.json, from scripts/import_cn_calendar.cjs) applied to CN tables.
// The CN game files date CN's first year with JP's calendar; CN launched 2021-10-26 and ran its own. The dates file
// holds, for each row, the date cells to change: CN's own dates, and for the events CN never ran ("hidden") dates
// in the year before CN's paid test, so they can still be played from the dashboard's date (the CN calendar
// switch, decided 2026-11-22; the import works those out):
// - a hidden event moves back whole years so it starts in 2020, all its rows together, keeping months, days and length;
// - any hidden date still after CN's paid test began (2021-08-17 10:00, China time) ends there, as in the fork the
//   dates come from: e.g. the ticket-only portals, open 2017-2199 in CN's files.
// A cell only changes while it still holds the CN files' date, so applying it twice changes nothing.
//
//   const CAL = require("./cn_calendar.cjs")
//   CAL.applyToTree(hashedPath, tree)   // a decoded table (scripts/cdn_rows.cjs decodeFile), changed in place
//   CAL.applyToBuffer(hashedPath, buf)  // the same on a table file's bytes
//   CAL.FILES                           // hashed paths of every table it changes
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { uploadPath } = require("./cdn_hash.cjs")

const DATES_FILE = path.join(__dirname, "..", "assets", "cn_calendar_dates.json")
// CN's paid test began 2021-08-17 10:00 (China time): what CN never ran ends before it
const JP_ONLY_END = "2021-08-17 09:59:59"

let cache = null
/** hashed path -> row key -> cell -> [CN files' date, CN's date] */
function load() {
    if (cache) return cache
    const data = fs.existsSync(DATES_FILE) ? JSON.parse(fs.readFileSync(DATES_FILE, "utf8")) : {}
    cache = new Map(Object.entries(data.tables ?? {}).map(([logical, rows]) => [uploadPath(logical), rows]))
    return cache
}

/** Hashed paths of every table the calendar changes. */
const FILES = [...load().keys()].sort()

/** "YYYY-..." moved back by whole years (a 29 February that no longer exists becomes the 28th). */
function minusYears(date, years) {
    if (years === 0) return date
    const y = Number(date.slice(0, 4)) - years
    let rest = date.slice(4)
    if (rest.startsWith("-02-29") && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) rest = "-02-28" + rest.slice(6)
    return String(y).padStart(4, "0") + rest
}

/** Puts one table's rows on CN's calendar, in place. Returns how many rows changed. */
function applyToTree(file, tree) {
    const rows = load().get(file)
    if (!rows) return 0
    let changed = 0
    for (const { path: keys, leaf } of R.leaves(tree)) {
        const cells = rows[keys.join("/")]
        if (!cells) continue
        const end = leaf.text.endsWith("\n") ? "\n" : ""
        const recs = R.splitCsvLines(leaf.text.replace(/\n$/, "")).map(R.splitCsv)
        let rowChanged = false
        for (const [cell, [from, to]] of Object.entries(cells)) {
            const [r, col] = cell.includes(":") ? cell.split(":").map(Number) : [0, Number(cell)]
            if (recs[r]?.[col] === from) { recs[r][col] = to; rowChanged = true }
        }
        if (!rowChanged) continue
        R.setLeafText(leaf, recs.map(rec => rec.map(R.csvField).join(",")).join("\n") + end)
        changed++
    }
    return changed
}

/** The same on a table file's bytes (the same bytes back when nothing applies). */
function applyToBuffer(file, buf) {
    if (!buf || !load().has(file)) return buf
    const tree = R.decodeFile(buf)
    return applyToTree(file, tree) > 0 ? R.encodeFile(tree) : buf
}

module.exports = { FILES, applyToTree, applyToBuffer, JP_ONLY_END, minusYears }
