// Builds number-only kit stages for assets/kit_dates.json: in a unit's current CN row (the game's own kit,
// which matches global's after a balance patch), the patch's new values are put back to the old ones.
//
//   node scripts/build_kit_numbers.cjs <changes.json> <until "YYYY-MM-DD hh:mm:ss" UTC> <label> [--write]
//
// <changes.json>: [{ unit, table, key, before: [values], after: [values] }], values raw ("25000") in row
// order. A row whose new values aren't all in the CN row (in order) is skipped and listed, so nothing is
// guessed. Without --write it only reports.
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")

const [changesFile, until, label, flag] = process.argv.slice(2)
const KIT_FILE = path.join(__dirname, "..", "assets", "kit_dates.json")

/** Replaces the after values with the before values, in order, field by field. null when they don't line up. */
function swapBack(rowText, before, after) {
    const lines = R.splitCsvLines(rowText.replace(/\n$/, "")).map(l => R.splitCsv(l))
    let i = 0
    for (const fields of lines) for (let f = 0; f < fields.length && i < after.length; f++) {
        if (fields[f] === after[i]) { fields[f] = before[i]; i++ }
    }
    if (i < after.length) return null
    return lines.map(l => l.map(R.csvField).join(",")).join("\n")
}

;(async () => {
    const changes = JSON.parse(fs.readFileSync(changesFile, "utf8"))
    const tables = {}
    const kits = fs.existsSync(KIT_FILE) ? JSON.parse(fs.readFileSync(KIT_FILE, "utf8")) : {}
    const stageRows = new Map(), skipped = []
    for (const c of changes) {
        tables[c.table] ??= await readCnTable(c.table)
        const current = tables[c.table][c.key]
        if (current === undefined) { skipped.push(`${c.unit} ${c.key}: no CN row`); continue }
        const old = swapBack(String(current), c.before.map(String), c.after.map(String))
        if (old === null) { skipped.push(`${c.unit} ${c.key}: new values ${c.after.join(" ")} not found in order`); continue }
        if (!stageRows.has(c.unit)) stageRows.set(c.unit, {})
        // rows with text (skills) are read from CN's own (Chinese) copy: only the changed columns are sent,
        // so the translated name and description stay
        let value = old
        if (c.table.includes("/skill/")) {
            const a = R.splitCsv(R.splitCsvLines(String(current).replace(/\n$/, ""))[0]), b = R.splitCsv(R.splitCsvLines(old)[0])
            value = { cols: Object.fromEntries(b.map((v, i) => [i, v]).filter(([i, v]) => v !== a[i])) }
        }
        stageRows.get(c.unit)[`${c.table}#${c.key}`] = value
    }
    for (const [unit, rows] of stageRows) {
        const kit = kits[unit] ?? {}
        const stages = Array.isArray(kit.stages) ? kit.stages : kit.rows ? [{ until: kit.until, source: kit.source, rows: kit.rows }] : []
        const others = stages.filter(s => s.until !== until)
        kits[unit] = { name: kit.name ?? changes.find(c => c.unit === unit)?.name, stages: [...others, { until, source: label, rows }].sort((a, b) => a.until.localeCompare(b.until)) }
    }
    console.log(`${stageRows.size} unit(s), ${[...stageRows.values()].reduce((n, r) => n + Object.keys(r).length, 0)} row(s); skipped ${skipped.length}`)
    for (const s of skipped) console.log("  skipped: " + s)
    if (flag === "--write") { fs.writeFileSync(KIT_FILE, JSON.stringify(kits, null, 1) + "\n"); console.log("written " + KIT_FILE) }
})()
