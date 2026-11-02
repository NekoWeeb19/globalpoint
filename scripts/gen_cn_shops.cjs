// The CN client's own shops (Trading Post, Trove, Star Speck, Boss Coin and event item exchanges),
// from its own shop tables, in the same shape as global's assets (scripts/converter.py's shop
// converters; CN's columns are the same). The server answers the CN client from these
// (src/lib/assets.ts), so it lists CN's own lineups and dates: CN replaced its Trove lineup and added
// shops for CN-only events, which global's data doesn't have.
//
// Tables are read from the newest copy the CN client has (the dashboard schedule's files first, so
// event shops follow moved events), dates converted from China time (UTC+8) to UTC.
//
//   node --env-file=.env scripts/gen_cn_shops.cjs
//   -> assets/cn_shops.json { general, treasure, starGrain, bossCoin, bossCoinMap, eventItem, eventItemMap }
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { hashed, readCn } = require("./cn_read.cjs")

const ROOT = path.join(__dirname, "..")
const OUT = path.join(ROOT, "assets", "cn_shops.json")
const SCHEDULED = path.join(ROOT, ".cdn", "cn_schedule_files")
const TRANSLATED = require("./cn_archives.cjs").cnTextDir()

const NONE = v => v === undefined || v === "" || v === "(None)"
const utc = v => {
    if (NONE(v)) return null
    const ms = Date.parse(v.replace(" ", "T") + "Z")
    return isNaN(ms) ? v : new Date(ms - 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ")
}

async function cnTable(logical) {
    const file = hashed(logical)
    const listFile = path.join(TRANSLATED, "files.json")
    const translatedFrom = new Map(fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, "utf8")).map(f => [f.path, f.from]) : [])
    let buf = null
    for (const p of [path.join(SCHEDULED, file), translatedFrom.get(file), path.join(TRANSLATED, file)]) {
        if (p && fs.existsSync(p)) { buf = fs.readFileSync(p); break }
    }
    buf ??= await readCn(logical)
    if (buf === null) throw new Error(`CN table not found: ${logical}`)
    const out = {}
    for (const { path: keys, leaf } of R.leaves(R.decodeFile(buf))) out[keys.join("/")] = R.splitCsv(leaf.text.replace(/\n$/, ""))
    return out
}

/** One shop row: costs (4 pairs from costAt), rewards (6 triples from rewardAt), dates, stock, user cost. */
function item(c, at) {
    const costs = []
    for (let i = 0, o = at.cost; i < 4; i++, o += 2) if (!NONE(c[o])) costs.push({ id: Number(c[o]), amount: Number(c[o + 1]) })
    const rewards = []
    for (let i = 0, o = at.reward; i < 6; i++, o += 3) {
        if (NONE(c[o])) continue
        const reward = { type: Number(c[o]) }
        if (c[o + 1] !== "") reward.id = Number(c[o + 1])
        if (c[o + 2] !== "") reward.count = Number(c[o + 2])
        rewards.push(reward)
    }
    const out = { costs, rewards, availableFrom: utc(c[at.from]) ?? "2000-01-01 00:00:00", availableUntil: utc(c[at.from + 1]), stock: Number(c[at.stock]) }
    if (at.user !== undefined && !NONE(c[at.user])) out.userCost = { type: Number(c[at.user]), amount: Number(c[at.user + 1]) }
    return out
}

;(async () => {
    const data = { general: {}, treasure: {}, starGrain: {}, bossCoin: {}, bossCoinMap: {}, eventItem: {}, eventItemMap: {} }
    for (const [id, c] of Object.entries(await cnTable("master/shop/general_shop.orderedmap"))) data.general[id] = item(c, { cost: 12, reward: 29, from: 20, stock: 23, user: 9 })
    for (const [id, c] of Object.entries(await cnTable("master/shop/treasure_shop.orderedmap"))) data.treasure[id] = item(c, { cost: 10, reward: 24, from: 18, stock: 21, user: 7 })
    for (const [id, c] of Object.entries(await cnTable("master/shop/star_grain_shop.orderedmap"))) data.starGrain[id] = item(c, { cost: 10, reward: 25, from: 18, stock: 21, user: 7 })
    for (const [id, c] of Object.entries(await cnTable("master/shop/boss_coin_shop.orderedmap"))) {
        const category = Number(c[0])
        ;(data.bossCoin[category] ??= {})[id] = item(c, { cost: 17, reward: 32, from: 25, stock: 28 })
        data.bossCoinMap[id] = category
    }
    for (const [id, c] of Object.entries(await cnTable("master/shop/event_item_shop.orderedmap"))) {
        const eventType = Number(c[2]), eventId = Number(c[1])
        ;((data.eventItem[eventType] ??= {})[eventId] ??= {})[id] = item(c, { cost: 18, reward: 32, from: 26, stock: 29 })
        data.eventItemMap[id] = { eventType, eventId }
    }

    // check the layout on items both clients have (rewards and costs should mostly agree; dates differ)
    const same = (a, b) => JSON.stringify([a.costs, a.rewards]) === JSON.stringify([b.costs, b.rewards])
    for (const [name, mine, globalFile] of [["general", data.general, "general_shop"], ["treasure", data.treasure, "treasure_shop"], ["starGrain", data.starGrain, "star_grain_shop"]]) {
        const g = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", `${globalFile}.json`), "utf8"))
        const shared = Object.keys(mine).filter(id => g[id])
        console.log(`${name}: ${Object.keys(mine).length} items, ${shared.length} shared with global, ${shared.filter(id => same(mine[id], g[id])).length} identical costs/rewards`)
    }
    console.log(`boss coin: ${Object.keys(data.bossCoinMap).length} items; event item: ${Object.keys(data.eventItemMap).length} items in ${Object.values(data.eventItem).reduce((n, t) => n + Object.keys(t).length, 0)} event shops`)
    fs.writeFileSync(OUT, JSON.stringify(data))
    console.log(`Wrote ${OUT}`)
})().catch(e => { console.error(e); process.exit(1) })
