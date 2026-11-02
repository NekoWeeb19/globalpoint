// Builds kit stages for assets/kit_dates.json from a balance patch note (assets/balance_global_*.json rows
// { unit, part, before, after }): for number-only changes to a leader skill or ability, the unit's current
// CN row (which matches the note's "after") gets the "before" percentages back.
//
//   node scripts/build_kit_text.cjs <patch.json> <until "YYYY-MM-DD hh:mm:ss" UTC> <label> <unit names file> [--write]
//
// <unit names file>: a JSON list of the unit names (as the note writes them) to build. A line that isn't
// numbers-only, or whose numbers can't be placed in the row, is skipped and listed.
//
// Row columns (CN): ability lines (5 = 0 "when", 1 "while"): level 1 / max value 51/52 or 113/114, stacks 34
// or 102; leader lines: values 49/50 or 111/112, stacks 32 or 100. 100000 = 100%.
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")
const { readTable } = require("./cdn_master.cjs")

const [patchFile, until, label, namesFile, flag] = process.argv.slice(2)
const KIT_FILE = path.join(__dirname, "..", "assets", "kit_dates.json")
// the note's spelling -> global's
const FIX = { "lavish tunderbolt metis": "lavish thunderbolt metis", "sunny-sdie fambler naska": "sunny-side gambler naska", "knight of the whilte helm gerard": "knight of the white helm gerard", "the neovilolin virtuoso lyra": "the neoviolin virtuoso lyra", "hight-hat negotiant libram": "high-hat negotiant libram", "one-eyed gunnder selgir": "one-eyed gunner selgir" }
const norm = s => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' !&.-]/g, " ").replace(/\s+/g, " ").trim()
const skeleton = s => s.replace(/[/]/g, " ").replace(/\s+/g, " ").replace(/\d+(\.\d+)?/g, "N").replace(/\s*([+\-%&]|N)\s*/g, "$1").trim()

/** The percentages of a note line in order: { value, max } (max = the "(Max +X%)" after it, if any). */
function percents(text) {
    const out = []
    const re = /(\d+(?:\.\d+)?)\s*%(\s*(?:to [^()%]*?)?\(Max\s*\+?\s*(\d+(?:\.\d+)?)\s*%\))?/g
    for (const m of text.matchAll(re)) out.push({ value: parseFloat(m[1]), max: m[3] !== undefined ? parseFloat(m[3]) : null })
    // a "(Max +X%)" is also matched as a plain percentage on its own: drop those
    return out.filter((p, i) => !out.some((q, j) => j < i && q.max === p.value && i === j + 1))
}

const stagesOf = kit => kit === undefined ? [] : Array.isArray(kit.stages) ? kit.stages : kit.rows ? [{ until: kit.until, source: kit.source, rows: kit.rows }] : []
/** The unit's next stage after a date (the kit between this patch and the next one), or null. */
const laterStage = (kit, until) => stagesOf(kit).filter(s => s.until > until).sort((a, b) => a.until.localeCompare(b.until))[0] ?? null

function columns(fields, leader) {
    const during = leader ? fields[3] === "1" : fields[5] === "1"
    if (leader) return during ? { lv1: 111, max: 112, stacks: 100 } : { lv1: 49, max: 50, stacks: 32 }
    return during ? { lv1: 113, max: 114, stacks: 102 } : { lv1: 51, max: 52, stacks: 34 }
}

/** The row with the before values, or a reason it can't be built. */
function rebuild(rowText, before, after, leader) {
    const b = percents(before), a = percents(after)
    if (b.length !== a.length || a.length === 0) return { error: `${a.length} new vs ${b.length} old percentages` }
    const lines = R.splitCsvLines(rowText.replace(/\n$/, "")).map(l => R.splitCsv(l))
    const used = new Set()
    for (let k = 0; k < a.length; k++) {
        if (a[k].value === b[k].value && a[k].max === b[k].max) continue
        const want = String(Math.round(a[k].value * 1000))
        // the first line not used yet whose max value is the new percentage (lines changed by an earlier number skip)
        const n = lines.findIndex((f, i) => !used.has(i) && f[columns(f, leader).max] === want)
        if (n < 0) return { error: `new value ${a[k].value}% not found` }
        used.add(n)
        const f = lines[n], c = columns(f, leader)
        const ratio = b[k].value / a[k].value
        f[c.lv1] = String(Math.round(Number(f[c.lv1]) * ratio))
        f[c.max] = String(Math.round(b[k].value * 1000))
        if (a[k].max !== null && b[k].max !== null) {
            const stacksA = Math.round(a[k].max / a[k].value), stacksB = Math.round(b[k].max / b[k].value)
            if (stacksA !== stacksB) {
                if (f[c.stacks] !== String(stacksA)) return { error: `stack count ${stacksA} not in column ${c.stacks} (${f[c.stacks]})` }
                f[c.stacks] = String(stacksB)
            }
        }
    }
    return { text: lines.map(l => l.map(R.csvField).join(",")).join("\n") }
}

;(async () => {
    const rows = JSON.parse(fs.readFileSync(patchFile, "utf8")).units
    const names = new Set(JSON.parse(fs.readFileSync(namesFile, "utf8")))
    const text = await readTable("master/character/character_text.orderedmap", false)
    const byName = new Map()
    // the first unit with a title + name (story versions of a unit share it and come later)
    for (const [id, t] of Object.entries(text)) { const c = R.splitCsv(t); const k = norm(`${c[3]} ${c[0]}`); if (!byName.has(k)) byName.set(k, id) }
    const AB = "master/ability/ability.orderedmap", LD = "master/ability/leader_ability.orderedmap"
    const tables = { [AB]: await readCnTable(AB), [LD]: await readCnTable(LD) }
    // a unit's leader skill row is named in its character row (column 17), not always its own id
    const chars = await readCnTable("master/character/character.orderedmap")
    const leaderKey = id => (chars[id] && R.splitCsv(String(chars[id]))[17]) || id
    const kits = fs.existsSync(KIT_FILE) ? JSON.parse(fs.readFileSync(KIT_FILE, "utf8")) : {}
    const built = new Map(), skipped = []
    for (const r of rows) {
        if (!names.has(r.unit)) continue
        const m = r.part.match(/^(Leader|Ability (\d))$/)
        if (!m) continue // skill lines: no numbers to put back (cost changes aren't given)
        if (skeleton(r.before) !== skeleton(r.after)) { skipped.push(`${r.unit} ${r.part}: not numbers-only`); continue }
        const n = norm(r.unit), id = byName.get(FIX[n] ?? n)
        if (!id) { skipped.push(`${r.unit}: unit not found`); continue }
        const leader = m[1] === "Leader", table = leader ? LD : AB, key = leader ? leaderKey(id) : id + m[2]
        const current = tables[table][key]
        if (current === undefined) { skipped.push(`${r.unit} ${r.part}: no CN row ${key}`); continue }
        // a row a later patch also changed starts from that patch's old row (the unit's kit between the two)
        const later = laterStage(kits[id], until)
        const base = built.get(id)?.rows[`${table}#${key}`] ?? (typeof later?.rows[`${table}#${key}`] === "string" ? later.rows[`${table}#${key}`] : current)
        const res = rebuild(String(base), r.before, r.after, leader)
        if (res.error) { skipped.push(`${r.unit} ${r.part}: ${res.error}`); continue }
        if (!built.has(id)) built.set(id, { name: r.unit, rows: {} })
        built.get(id).rows[`${table}#${key}`] = res.text
    }
    for (const [unit, { name, rows: stageRows }] of built) {
        const kit = kits[unit] ?? {}
        const stages = stagesOf(kit)
        // before this patch the later patches' old rows applied too: this stage carries them
        const later = laterStage(kit, until)
        const rowsAll = { ...(later?.rows ?? {}), ...stageRows }
        kits[unit] = { name: kit.name ?? name, stages: [...stages.filter(s => s.until !== until), { until, source: label, rows: rowsAll }].sort((a, b) => a.until.localeCompare(b.until)) }
    }
    console.log(`${built.size} unit(s), ${[...built.values()].reduce((n, u) => n + Object.keys(u.rows).length, 0)} row(s); skipped ${skipped.length}`)
    for (const s of skipped) console.log("  skipped: " + s)
    if (flag === "--write") { fs.writeFileSync(KIT_FILE, JSON.stringify(kits, null, 1) + "\n"); console.log("written " + KIT_FILE) }
})()
