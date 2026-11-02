// The CN client's Star Sliver (star crumb) and Augment Armament (bond token) exchanges, in the shape of
// assets/exchange.json (scripts/gen_exchanges.cjs). CN numbers its exchange rows differently from
// global (CN row 1 is a unit, global's is an armament), so the server answers the CN client from
// this file (src/routes/api/exchange.ts).
//
// CN rows have one more column than global's: 6 comeback banner, 7 Star Cluster banner, 8 rarity
// (global: 6 one banner column, 7 rarity). CN ended its regular rows on 2025-08-14 (the end of the CN
// service); those are kept open like global's (2199-12-31), and the CN update does the same
// (scripts/gen_cn_event_schedule.cjs EOS_TABLES).
//
//   node --env-file=.env scripts/gen_cn_exchanges.cjs   -> assets/exchange_cn.json
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")

const OUT = path.join(__dirname, "..", "assets", "exchange_cn.json")
const KINDS = { 0: "character", 1: "item", 2: "equipment" }
const CN_END_OF_SERVICE = "2025-08-14 23:59:59"
const FOREVER = "2199-12-31 23:59:59"
const NONE = v => v === undefined || v === "" || v === "(None)"
const utc = v => {
    if (NONE(v)) return null
    if (v === CN_END_OF_SERVICE) v = FOREVER
    const ms = Date.parse(v.replace(" ", "T") + "Z")
    return isNaN(ms) ? v : new Date(ms - 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ")
}

;(async () => {
    const rows = async name => Object.entries(await readCnTable(`master/shop/${name}.orderedmap`)).map(([k, l]) => [k, R.splitCsv(l.replace(/\n$/, ""))])
    const costs = {}
    for (const [kind, c] of await rows("star_crumb_exchange_cost")) costs[kind] = { 4: Number(c[0]), 5: Number(c[1]) }
    const items = await readCnTable("master/item/item.orderedmap")

    const starCrumb = {}
    let skipped = 0
    for (const [id, c] of await rows("star_crumb_exchange")) {
        const kind = KINDS[c[0]], rarity = Number(c[8])
        const cost = costs[c[0]]?.[rarity]
        if (!kind || cost === undefined || NONE(c[3])) { skipped++; continue }
        const entry = { kind, targetId: Number(c[1]), rarity, cost, start: utc(c[3]), end: utc(c[4]) }
        if (kind === "item") {
            const row = items[c[1]]
            if (!row) { skipped++; continue }
            // CN item rows have the item id at column 1, so every later column is one further than
            // global's: the max count is column 18 here (17 is the rarity)
            entry.maxCount = Number(R.splitCsv(row)[18]) || 9999
        }
        starCrumb[id] = entry
    }
    const bondToken = {}
    for (const [equipmentId, c] of await rows("bond_token_exchange")) {
        if (NONE(c[2])) continue
        bondToken[equipmentId] = { cost: Number(c[0]), stock: Number(c[1]) || 0, start: utc(c[2]), end: utc(c[3]) }
    }
    fs.writeFileSync(OUT, JSON.stringify({ starCrumb, bondToken }))
    const open = Object.values(starCrumb).filter(e => e.end === null || e.end > "2026").length
    console.log(`Wrote ${OUT}: ${Object.keys(starCrumb).length} Star Sliver exchanges (${open} open past 2026, ${skipped} skipped), ${Object.keys(bondToken).length} bond token exchanges`)
})().catch(e => { console.error(e); process.exit(1) })
