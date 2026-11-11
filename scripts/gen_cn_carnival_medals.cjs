// The Hanifolk Carnival medals the CN app pays: CN's runs pay other medals than global's for the same total-score
// rewards (runs 2-9 pay the first set, 90010-90030, which CN's shops for them take; global's pay 90040-90090).
// For each reward of assets/carnival_event.json whose items differ in CN's own table:
// { reward id: { global item: CN item } } -> assets/carnival_medals_cn.json, used by src/nya/carnival.ts for the CN
// app. Items are paired by amount (CN lists the slots in another order).
//
//   node --env-file=.env scripts/gen_cn_carnival_medals.cjs
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")

const ROOT = path.join(__dirname, "..")
const int = v => (v === undefined || v === "" || v === "(None)" ? null : Math.trunc(Number(v)))

;(async () => {
    const { rewards } = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "carnival_event.json"), "utf8"))
    const cnTable = await readCnTable("master/quest/event/carnival_event_total_score_reward.orderedmap")
    const medals = {}
    let unmatched = 0
    for (const [rewardId, line] of Object.entries(cnTable)) {
        const ours = rewards[rewardId]
        if (!ours) continue
        const c = R.splitCsv(line.replace(/\n$/, ""))
        const cnItems = []
        for (let i = 4; i < 22; i += 3) if (int(c[i]) === 0 && int(c[i + 1]) !== null) cnItems.push({ id: int(c[i + 1]), amount: int(c[i + 2]) })
        const ourItems = ours.rewards.filter(r => r.kind === 0 && r.id !== undefined)
        const onlyOurs = ourItems.filter(o => !cnItems.some(x => x.id === o.id))
        const onlyCn = cnItems.filter(x => !ourItems.some(o => o.id === x.id))
        for (const o of onlyOurs) {
            const match = onlyCn.find(x => x.amount === o.amount) ?? (onlyOurs.length === 1 && onlyCn.length === 1 ? onlyCn[0] : undefined)
            if (match) (medals[rewardId] ??= {})[o.id] = match.id
            else { unmatched++; console.log(`reward ${rewardId}: item ${o.id} x${o.amount} has no CN match (CN: ${JSON.stringify(onlyCn)})`) }
        }
    }
    const out = path.join(ROOT, "assets", "carnival_medals_cn.json")
    fs.writeFileSync(out, JSON.stringify(medals))
    console.log(`Wrote ${out}: ${Object.keys(medals).length} rewards pay other items in CN (${unmatched} unmatched)`)
})().catch(e => { console.error(e); process.exit(1) })
