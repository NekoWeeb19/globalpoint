// Builds assets/exchange.json (the Star Crumb and bond token exchanges) from the global client's own
// master tables (see scripts/cdn_master.cjs). The rules follow the Chinese fork
// (lib/star-crumb-exchange and lib/bond-token-exchange).
//
//   node scripts/gen_exchanges.cjs
//
// master/shop/star_crumb_exchange (exchange id -> 8 columns, global; the Chinese fork's rows have one
//   more): 0 kind (0 unit, 1 item, 2 armament), 1 the unit / item / armament id, 3/4 offered from/until
//   (UTC, like the other master dates), 7 rarity (4 or 5)
// master/shop/star_crumb_exchange_cost (kind -> 2 columns): the cost for 4-star, then 5-star
// master/shop/bond_token_exchange (armament id -> 4 columns): 0 cost, 1 how many can be exchanged,
//   2/3 offered from/until
// Items also carry their max count (master/item/item column 17): the client won't exchange one at it.

const path = require("path")
const fs = require("fs")
const { ROOT, readTable, parseCsvLine, str, int } = require("./cdn_master.cjs")

const OUT = path.join(ROOT, "assets", "exchange.json")
const KINDS = { 0: "character", 1: "item", 2: "equipment" }

const positive = (value, what) => {
    const n = int(value)
    if (!(n > 0)) throw new Error(`${what}: expected a positive number, got ${value}.`)
    return n
}

;(async () => {
    const costs = {}
    for (const [kind, line] of Object.entries(await readTable("master/shop/star_crumb_exchange_cost.orderedmap", false))) {
        const c = parseCsvLine(line)
        if (c.length !== 2) throw new Error(`star crumb cost ${kind}: expected 2 columns.`)
        costs[kind] = { 4: positive(c[0], `cost ${kind} 4-star`), 5: positive(c[1], `cost ${kind} 5-star`) }
    }

    const itemTable = await readTable("master/item/item.orderedmap", false)
    const starCrumb = {}
    for (const [id, line] of Object.entries(await readTable("master/shop/star_crumb_exchange.orderedmap", false))) {
        const c = parseCsvLine(line)
        if (c.length !== 8) throw new Error(`star crumb exchange ${id}: expected 8 columns, got ${c.length}.`)
        const kind = KINDS[c[0]]
        if (kind === undefined) throw new Error(`star crumb exchange ${id}: unknown kind ${c[0]}.`)
        const rarity = int(c[7])
        if (rarity !== 4 && rarity !== 5) throw new Error(`star crumb exchange ${id}: rarity ${c[7]}.`)
        const cost = costs[c[0]]?.[rarity]
        if (cost === undefined) throw new Error(`star crumb exchange ${id}: no cost for kind ${c[0]}.`)
        const start = str(c[3])
        if (start === null) throw new Error(`star crumb exchange ${id}: no start date.`)
        const targetId = positive(c[1], `star crumb exchange ${id} target`)
        starCrumb[id] = { kind, targetId, rarity, cost, start, end: str(c[4]) }
        if (kind === "item") {
            const row = itemTable[String(targetId)]
            if (row === undefined) throw new Error(`star crumb exchange ${id}: item ${targetId} isn't in the item table.`)
            starCrumb[id].maxCount = positive(parseCsvLine(row)[17], `item ${targetId} max count`)
        }
    }

    const bondToken = {}
    for (const [equipmentId, line] of Object.entries(await readTable("master/shop/bond_token_exchange.orderedmap", false))) {
        const c = parseCsvLine(line)
        if (c.length !== 4) throw new Error(`bond token exchange ${equipmentId}: expected 4 columns.`)
        const start = str(c[2])
        if (start === null) throw new Error(`bond token exchange ${equipmentId}: no start date.`)
        bondToken[equipmentId] = { cost: positive(c[0], `bond token ${equipmentId} cost`), stock: int(c[1]) ?? 0, start, end: str(c[3]) }
    }

    fs.writeFileSync(OUT, JSON.stringify({ starCrumb, bondToken }))
    const all = Object.values(starCrumb)
    console.log(`Wrote ${OUT}: ${all.length} Star Crumb exchanges (${["character", "item", "equipment"].map(k => `${all.filter(e => e.kind === k).length} ${k}`).join(", ")}), ${Object.keys(bondToken).length} bond token exchanges.`)
})()
