// Adds the battle rewards only the CN client has (clear rewards, score rewards, rare score rewards of
// CN-only quests) to the server's reward files. Global's rewards are left as they are.
//
// CN rows (same layout as global's):
//   clear_reward:      0 name, 1 type, 2 id, 3 count
//   score_reward:      0 name, 1 type; type 0: 2 reward type, 3 id, 4 count, 5 weight; type 1: 6 id, 7 chance
//   rare_score_reward: 0 name, 1 type, 2 id, 3 count, 4 chance
// The conversion is first checked against every group both have (printed as "matches").
//
//   node scripts/gen_cn_rewards.cjs [--dry]
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("F:/WF client/tools/cn_read.cjs")

const ROOT = path.join(__dirname, "..")
const DRY = process.argv.includes("--dry")
const int = v => (v === undefined || v === "" || v === "(None)" ? undefined : Math.trunc(Number(v)))
const float = v => (v === undefined || v === "" || v === "(None)" ? undefined : Number(v))

function clearEntry(c) {
    const e = { name: "", type: int(c[1]) }
    if (int(c[2]) !== undefined) e.id = int(c[2])
    if (int(c[3]) !== undefined) e.count = int(c[3])
    return e
}
function scoreEntry(c) {
    if (c[1] === "1") return { name: "", type: 1, id: int(c[6]), rarity: float(c[7]) }
    return { name: "", type: int(c[1]), reward_type: int(c[2]), count: int(c[4]), field5: int(c[5]), id: int(c[3]) }
}
function rareEntry(c) {
    return { name: "", type: int(c[1]), rarity: float(c[4]), id: int(c[2]), count: int(c[3]) }
}

const same = (a, b) => JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b ?? {}).sort())

async function groups(table) {
    const t = await readCnTable(`master/reward/${table}.orderedmap`)
    const out = {}
    for (const [k, line] of Object.entries(t)) {
        const [g, n] = k.split("/")
        ;(out[g] ??= []).push([Number(n ?? 0), R.splitCsv(line.replace(/\n$/, ""))])
    }
    for (const g of Object.keys(out)) out[g] = out[g].sort((a, b) => a[0] - b[0]).map(x => x[1])
    return out
}

;(async () => {
    const report = {}
    // clear rewards: one row per id
    {
        const file = path.join(ROOT, "assets", "clear_reward.json")
        const data = JSON.parse(fs.readFileSync(file, "utf8"))
        const t = await readCnTable("master/reward/clear_reward.orderedmap")
        let match = 0, shared = 0, added = 0
        for (const [id, line] of Object.entries(t)) {
            const e = clearEntry(R.splitCsv(line.replace(/\n$/, "")))
            if (data[id] !== undefined) { shared++; if (same(e, data[id])) match++; continue }
            data[id] = e; added++
        }
        report.clear_reward = { shared, matches: match, added }
        if (!DRY) fs.writeFileSync(file, JSON.stringify(data))
    }
    for (const [table, toEntry] of [["score_reward", scoreEntry], ["rare_score_reward", rareEntry]]) {
        const file = path.join(ROOT, "assets", `${table}.json`)
        const data = JSON.parse(fs.readFileSync(file, "utf8"))
        const cn = await groups(table)
        let match = 0, shared = 0, added = 0
        const bad = []
        for (const [g, rows] of Object.entries(cn)) {
            const entries = rows.map(toEntry)
            if (data[g] !== undefined) {
                shared++
                if (entries.length === data[g].length && entries.every((e, i) => same(e, data[g][i]))) match++
                else if (bad.length < 2) bad.push({ g, cn: entries.slice(0, 2), server: data[g].slice(0, 2) })
                continue
            }
            data[g] = entries; added++
        }
        report[table] = { shared, matches: match, added, bad }
        if (!DRY) fs.writeFileSync(file, JSON.stringify(data))
    }
    console.log(JSON.stringify(report, null, 1))
})().catch(e => { console.error(e); process.exit(1) })
