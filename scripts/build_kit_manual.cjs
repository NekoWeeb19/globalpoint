// Hand-made kit changes for assets/kit_dates.json: balance patch lines the other builders can't do
// (an effect the patch added, or numbers the note's text doesn't place). Each edit starts from the unit's
// row as of its patch (a later patch's old row if there is one, else CN's current row), and the stage it
// lands in also goes into the unit's earlier stages that don't have the row (stages are cumulative).
// These change codes, not just numbers: check them in game (the unit page text).
//
//   node scripts/build_kit_manual.cjs [--write]
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")

const KIT_FILE = path.join(__dirname, "..", "assets", "kit_dates.json")
const AB = "master/ability/ability.orderedmap", LD = "master/ability/leader_ability.orderedmap"
const P2022 = { until: "2022-05-31 06:00:00", source: "global news 1241 (live 2022-05-31)" }
const P2024 = { until: "2024-05-27 06:00:00", source: "global 2.1.108 game files (2024-05-27)" }

// drop: line indexes to leave out; set: { line: { column: value } } (indexes of the starting row)
const EDITS = [
    // leader skills: the attack line the patch added is left out
    { unit: "121002", name: "Top-class Diviner Suizen", ...P2022, table: LD, key: "121002", drop: [1], note: "Leader: +40% HP only (the +40% attack was added)" },
    { unit: "131005", name: "King of the Ring Barrek", ...P2022, table: LD, key: "131005", set: { 0: { 49: "48750", 50: "65000" } }, drop: [2, 3], note: "Leader: +65% attack, no Power Flip damage" },
    { unit: "131013", name: "Midsummer Magician Illumine", ...P2022, table: LD, key: "131013", drop: [1], note: "Leader: +20% HP / Fever gauge on skill, no +40% attack" },
    { unit: "251002", name: "Knight of the White Helm Gerard", ...P2022, table: LD, key: "251002", drop: [2], note: "Leader: +20% HP & +15% Dark resistance, no +20% attack" },
    // abilities: the attack line the patch added is left out
    { unit: "241002", name: "Halcyon Hunter Aurore", ...P2022, table: AB, key: "2410021", drop: [2], note: "Ability 1: +15% HP only" },
    { unit: "261011", name: "Uncouth Alchemist Bryce", ...P2022, table: AB, key: "2610111", drop: [1], note: "Ability 1: +50% skill gauge on first skill only" },
    // numbers the note's text doesn't place
    { unit: "261010", name: "Aspiring First-Class Adventurer Grieg", ...P2022, table: AB, key: "2610103", set: { 0: { 30: "400000", 31: "400000", 51: "4000", 52: "8000" } }, note: "Ability 3: every 4 kills +8% Power Flip damage (Max +80%)" },
    { unit: "211004", name: "Demon-born Hunter Asukirimaru", ...P2022, table: AB, key: "2110043", set: { 1: { 51: "20000", 52: "40000" } }, note: "Ability 3: +40% attack (combo -3 unchanged)" },
    { unit: "161005", name: "Dare Devil Carla", ...P2022, table: AB, key: "1610051", set: { 0: { 51: "5000", 52: "10000" } }, note: "Ability 1: +10% attack per skill (Max +50%)" },
    { unit: "261005", name: "Seeker of the Abyss Liam", ...P2022, table: AB, key: "2610053", set: { 0: { 57: "15000000", 58: "30000000" } }, note: "Ability 3: Pierce for 5 seconds" },
    // 2024-05-27 rows whose old values replaced a fixed value
    { unit: "131098", name: "Lavender Widow Mayuzuki", ...P2024, table: AB, key: "1310983", set: { 2: { 113: "60000", 114: "120000" } }, note: "Ability 3: old values from the game files" },
    { unit: "161027", name: "Hope in the Darkness Adjudicus", ...P2024, table: AB, key: "1610273", set: { 1: { 113: "87500", 114: "175000" } }, note: "Ability 3: old values from the game files" },
]

const stagesOf = kit => kit === undefined ? [] : Array.isArray(kit.stages) ? kit.stages : kit.rows ? [{ until: kit.until, source: kit.source, rows: kit.rows }] : []

;(async () => {
    const tables = { [AB]: await readCnTable(AB), [LD]: await readCnTable(LD) }
    const kits = fs.existsSync(KIT_FILE) ? JSON.parse(fs.readFileSync(KIT_FILE, "utf8")) : {}
    const problems = []
    for (const e of EDITS) {
        const ref = `${e.table}#${e.key}`
        const kit = kits[e.unit] ?? { name: e.name }
        const stages = stagesOf(kit)
        const here = stages.find(s => s.until === e.until)
        const later = stages.filter(s => s.until > e.until).sort((a, b) => a.until.localeCompare(b.until))[0]
        const start = typeof here?.rows[ref] === "string" ? here.rows[ref] : typeof later?.rows[ref] === "string" ? later.rows[ref] : tables[e.table][e.key]
        if (start === undefined) { problems.push(`${e.name}: no row ${e.key}`); continue }
        const lines = R.splitCsvLines(String(start).replace(/\n$/, "")).map(l => R.splitCsv(l))
        for (const [n, cols] of Object.entries(e.set ?? {})) {
            if (!lines[n]) { problems.push(`${e.name}: no line ${n}`); continue }
            for (const [c, v] of Object.entries(cols)) lines[n][c] = v
        }
        const text = lines.filter((_, i) => !(e.drop ?? []).includes(i)).map(l => l.map(R.csvField).join(",")).join("\n")
        // into this patch's stage (made with the next stage's rows if new), and the earlier stages lacking it
        let stage = here
        if (!stage) { stage = { until: e.until, source: e.source, rows: { ...(later?.rows ?? {}) } }; stages.push(stage) }
        stage.rows[ref] = text
        for (const s of stages) if (s.until < e.until && s.rows[ref] === undefined) s.rows[ref] = text
        stages.sort((a, b) => a.until.localeCompare(b.until))
        kits[e.unit] = { name: kit.name ?? e.name, stages }
        console.log(`${e.name}: ${e.note}`)
    }
    for (const p of problems) console.log("  problem: " + p)
    if (process.argv.includes("--write")) { fs.writeFileSync(KIT_FILE, JSON.stringify(kits, null, 1) + "\n"); console.log("written " + KIT_FILE) }
})()
