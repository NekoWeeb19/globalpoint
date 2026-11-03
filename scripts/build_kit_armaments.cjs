// Builds armament kit stages for assets/kit_dates.json from the 2022-05-31 armament patch note
// (assets/balance_global_2022-05-31.json "armamentRows"): in each armament's CN ability row
// (master/ability/ability_soul.orderedmap) the note's new values go back to the old ones, and an awakening
// ability the patch added (old "-") is left out.
//
//   node scripts/build_kit_armaments.cjs <until "YYYY-MM-DD hh:mm:ss" UTC> <label> [--write]
//
// Row lines: column 0 = 0 base ability / 1 awakening ability, column 1 = the awakening level it comes at
// (1, 3, 5). Base lines hold the level 1 / max awakening values in 48/49 ("when" lines) or 110/111
// ("while" lines, column 2 = 1). Kit keys are "armament:<id>".
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")
const { readTable } = require("./cdn_master.cjs")

const [until, label, flag] = process.argv.slice(2)
const KIT_FILE = path.join(__dirname, "..", "assets", "kit_dates.json")
const TABLE = "master/ability/ability_soul.orderedmap"
const pct = s => [...String(s).matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)].map(m => parseFloat(m[1]))
const skeleton = s => String(s).replace(/\s+/g, " ").replace(/-?\d+(\.\d+)?/g, "N").replace(/\s*([+\-%&]|N)\s*/g, "$1").trim()

/** The note's armaments: { name, before: { lv1: [texts], lv3, lv5, max: [texts] }, after: same }. */
function parseNote(rows) {
    const out = []
    let cur = null, side = null
    for (const row of rows) {
        if (row[0] === "Armament" || row[0] === "Rarity" || /^★|^Sum$/.test(row[0])) continue
        if (row[2] === "Before" && row.length === 7) { cur = { name: row[0], before: null, after: null }; out.push(cur); side = "before"; cur.before = { lv1: [row[3]], lv3: row[4], lv5: row[5], max: [row[6]] }; continue }
        if (row[0] === "After" && row.length === 5) { side = "after"; cur.after = { lv1: [row[1]], lv3: row[2], lv5: row[3], max: [row[4]] }; continue }
        // a second effect of the level 1 / max ability (2 cells, or 4 with the awakening columns)
        if (cur && side && (row.length === 2 || row.length === 4)) { cur[side].lv1.push(row[0]); cur[side].max.push(row[row.length - 1]) }
    }
    return out
}

;(async () => {
    const note = parseNote(require("../assets/balance_global_2022-05-31.json").armamentRows)
    const globalEq = await readTable("master/item/equipment.orderedmap", false)
    const idOf = new Map(Object.entries(globalEq).map(([id, t]) => [R.splitCsv(t)[1], id]))
    const table = await readCnTable(TABLE)
    const kits = fs.existsSync(KIT_FILE) ? JSON.parse(fs.readFileSync(KIT_FILE, "utf8")) : {}
    const built = [], skipped = [], dropped = []
    for (const a of note) {
        const id = idOf.get(a.name)
        if (!id || table[id] === undefined) { skipped.push(`${a.name}: not found`); continue }
        const lines = R.splitCsvLines(String(table[id]).replace(/\n$/, "")).map(l => R.splitCsv(l))
        let ok = true, changed = false, removed = []
        // base ability: each effect line, matched by its new max value
        for (let e = 0; e < a.after.lv1.length && ok; e++) {
            if (a.after.lv1[e] === "-" && a.before.lv1[e] === "-") continue
            // "(Max +X%)": the cap is the value times a stack count the row keeps; it must stay the same count
            const capOf = s => { const m = String(s).match(/\(Max\s*\+?\s*(-?\d+(?:\.\d+)?)\s*%\)/); return m ? parseFloat(m[1]) : null }
            const noCap = s => String(s).replace(/\(Max[^)]*\)/g, "")
            const b1 = pct(noCap(a.before.lv1[e] ?? "")), bm = pct(noCap(a.before.max[e] ?? "")), a1 = pct(noCap(a.after.lv1[e])), am = pct(noCap(a.after.max[e]))
            const caps = [a.before.lv1[e], a.after.lv1[e], a.before.max[e], a.after.max[e]].map(capOf)
            const sameStacks = caps.every(c => c === null) || (caps.every(c => c !== null) && Math.abs(caps[0] / b1[0] - caps[1] / a1[0]) < 1e-6 && Math.abs(caps[2] / bm[0] - caps[3] / am[0]) < 1e-6)
            if (skeleton(a.before.lv1[e]) !== skeleton(a.after.lv1[e]) || a1.length !== 1 || am.length !== 1 || b1.length !== 1 || bm.length !== 1 || !sameStacks) { ok = false; skipped.push(`${a.name}: base effect ${e + 1} isn't a plain number change`); break }
            if (a1[0] === b1[0] && am[0] === bm[0]) continue
            const want1 = String(Math.round(a1[0] * 1000)), wantM = String(Math.round(am[0] * 1000))
            const line = lines.find(f => f[0] === "0" && ((f[48] === want1 && f[49] === wantM) || (f[110] === want1 && f[111] === wantM)))
            if (!line) { ok = false; skipped.push(`${a.name}: base values ${a1[0]}% / ${am[0]}% not in the row`); break }
            const [c1, cm] = line[48] === want1 ? [48, 49] : [110, 111]
            line[c1] = String(Math.round(b1[0] * 1000)); line[cm] = String(Math.round(bm[0] * 1000)); changed = true
        }
        // awakening abilities (level 3 and 5): added by the patch -> left out; changed -> numbers back
        for (const [lv, key] of [["3", "lv3"], ["5", "lv5"]]) {
            if (!ok) break
            const b = a.before[key], af = a.after[key]
            if (af === "-") continue
            let idx = lines.findIndex(f => f !== null && f[0] === "1" && f[1] === lv)
            // the note's level column isn't always the level CN keeps the line at: with one awakening line left, it's that one
            const awake = lines.map((f, i) => f !== null && f[0] === "1" ? i : -1).filter(i => i >= 0)
            if (idx < 0 && awake.length === 1 && [a.before.lv3, a.after.lv3, a.before.lv5, a.after.lv5].filter(x => x !== "-").length === 1) idx = awake[0]
            if (idx < 0) { ok = false; skipped.push(`${a.name}: no level ${lv} line`); break }
            if (b === "-") { removed.push(lv); lines[idx] = null; changed = true; continue }
            if (skeleton(b) !== skeleton(af)) { ok = false; skipped.push(`${a.name}: level ${lv} isn't a plain number change`); break }
        }
        if (!ok || !changed) continue
        const text = lines.filter(Boolean).map(l => l.map(R.csvField).join(",")).join("\n")
        if (removed.length) dropped.push(`${a.name} (awakening Lv${removed.join(", Lv")})`)
        built.push(a.name)
        const unit = `armament:${id}`
        const kit = kits[unit] ?? { name: a.name, stages: [] }
        kit.stages = [...(kit.stages ?? []).filter(s => s.until !== until), { until, source: label, rows: { [`${TABLE}#${id}`]: text } }]
        kits[unit] = kit
    }
    console.log(`${built.length} armament(s) built; skipped ${skipped.length}; with awakening lines left out: ${dropped.length}`)
    for (const s of skipped) console.log("  skipped: " + s)
    for (const d of dropped) console.log("  left out: " + d)
    if (flag === "--write") { fs.writeFileSync(KIT_FILE, JSON.stringify(kits, null, 1) + "\n"); console.log("written " + KIT_FILE) }
})()
