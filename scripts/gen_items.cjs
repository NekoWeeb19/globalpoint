// Builds assets/item_rules.json (what each item does when used, and its sale price) from the global
// client's own master/item/item table (see scripts/cdn_master.cjs).
//
//   node scripts/gen_items.cjs
//
// Columns (global client, 22 per row; the Chinese fork's rows have one more):
//   0 key, 1 name, 5 effect kind (2 = recovers a fixed amount of stamina), 6 effect value,
//   13 category (5 = ability souls, which the game always leaves 3 of), 15 sale price (mana each),
//   17 max count, 18/19 usable from/until (UTC, like the other master dates), 21 sellable

const path = require("path")
const fs = require("fs")
const { ROOT, readTable, parseCsvLine, str, int } = require("./cdn_master.cjs")

const OUT = path.join(ROOT, "assets", "item_rules.json")
const COLUMNS = 22

;(async () => {
    const table = await readTable("master/item/item.orderedmap", false)
    const items = {}
    for (const [id, line] of Object.entries(table)) {
        const c = parseCsvLine(line)
        if (c.length !== COLUMNS) throw new Error(`item ${id}: expected ${COLUMNS} columns, got ${c.length}.`)
        if (c[21] !== "true" && c[21] !== "false") throw new Error(`item ${id}: sellable is ${c[21]}.`)
        const start = str(c[18])
        if (start === null) throw new Error(`item ${id}: no start date.`)
        const item = {
            name: c[1].trim(),
            effectKind: int(c[5]),
            category: int(c[13]),
            salePrice: int(c[15]) ?? 0,
            sellable: c[21] === "true",
            start,
            end: str(c[19]),
        }
        if (item.effectKind === 2) {
            item.stamina = int(c[6])
            if (!(item.stamina > 0)) throw new Error(`item ${id}: stamina item recovers ${c[6]}.`)
        }
        items[id] = item
    }
    fs.writeFileSync(OUT, JSON.stringify({ items }, null, 1))
    const all = Object.values(items)
    console.log(`Wrote ${OUT}: ${all.length} items, ${all.filter(i => i.effectKind === 2).length} stamina items, ${all.filter(i => i.sellable).length} sellable.`)
})()
