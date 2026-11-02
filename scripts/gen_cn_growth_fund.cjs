// The CN client's Growth Fund rewards (see src/nya/growthFund.ts), from its own table
// master/growth_fund/growth_fund. Beads ("Stone") rewards pay the row's free beads plus its paid
// beads, both as free beads (there's no paid currency here); item rewards pay the item.
//
//   node --env-file=.env scripts/gen_cn_growth_fund.cjs   -> assets/growth_fund_cn.json
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")

const OUT = path.join(__dirname, "..", "assets", "growth_fund_cn.json")
const NONE = v => v === undefined || v === "" || v === "(None)"

;(async () => {
    const out = {}
    for (const [id, line] of Object.entries(await readCnTable("master/growth_fund/growth_fund.orderedmap"))) {
        const c = R.splitCsv(line.replace(/\n$/, ""))
        const kind = Number(c[4])
        const goal = Number(c[5 + kind])
        const beads = (Number(c[14]) || 0) + (Number(c[15]) || 0)
        const rewards = []
        for (const at of [8, 11]) {
            if (NONE(c[at])) continue
            if (c[at] === "0") { if (beads > 0) rewards.push({ kind: 0, amount: beads }) }
            else rewards.push({ kind: 1, amount: Number(c[at + 2]) || 1, itemId: Number(c[at + 1]) })
        }
        out[c[0] || id] = { kind, goal, rewards }
    }
    fs.writeFileSync(OUT, JSON.stringify(out))
    console.log(`Wrote ${OUT}: ${Object.keys(out).length} rewards`, JSON.stringify(Object.values(out).find(b => b.kind === 1)))
})().catch(e => { console.error(e); process.exit(1) })
