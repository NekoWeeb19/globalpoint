// Builds assets/item_rules.json (what each item does when used, and its sale price) from the global
// client's own master/item/item table (see scripts/cdn_master.cjs).
//
//   node scripts/gen_items.cjs
//
// CN-only items (e.g. 10000069, a limited-time Staminade Swig) are added with
//   node scripts/gen_cn_merge.cjs scripts/gen_items.cjs assets/item_rules.json
//
// Columns (global client, 22 per row; CN's layout is in LAYOUT below):
//   0 key, 1 name, 5 effect kind (2 = recovers a fixed amount of stamina), 6 effect value,
//   13 category (5 = ability souls, which the game always leaves 3 of), 15 sale price (mana each),
//   17 max count, 18/19 usable from/until (UTC, like the other master dates), 21 sellable

const path = require("path")
const fs = require("fs")
const { ROOT, readTable, parseCsvLine, str, int } = require("./cdn_master.cjs")

const OUT = path.join(ROOT, "assets", "item_rules.json")

// The CN client's rows (MASTER_SOURCE=cn, run through scripts/gen_cn_merge.cjs) have 23 columns: the id is
// added as column 1, so columns 1-19 move up by one; then 20 = until, 21 = sellable, 22 = an extra CN field.
// CN dates are China time (UTC+8) and are turned into UTC here.
const fromCn = process.env.MASTER_SOURCE === "cn"
const LAYOUT = fromCn
    ? { columns: 23, name: 2, effectKind: 6, effectValue: 7, category: 14, salePrice: 16, start: 19, end: 20, sellable: 21 }
    : { columns: 22, name: 1, effectKind: 5, effectValue: 6, category: 13, salePrice: 15, start: 18, end: 19, sellable: 21 }

/** A CN date (UTC+8) as UTC text; dates from 2049 on (CN's "never") are kept as they are. */
function cnDateToUtc(text) {
    if (text === null || text.slice(0, 4) >= "2049") return text
    const ms = Date.parse(text.replace(" ", "T") + "+08:00")
    if (isNaN(ms)) throw new Error(`bad CN date ${text}`)
    return new Date(ms).toISOString().slice(0, 19).replace("T", " ")
}
const date = value => fromCn ? cnDateToUtc(str(value)) : str(value)

;(async () => {
    const table = await readTable("master/item/item.orderedmap", false)
    const L = LAYOUT
    const items = {}
    for (const [id, line] of Object.entries(table)) {
        const c = parseCsvLine(line)
        if (c.length !== L.columns) throw new Error(`item ${id}: expected ${L.columns} columns, got ${c.length}.`)
        if (c[L.sellable] !== "true" && c[L.sellable] !== "false") throw new Error(`item ${id}: sellable is ${c[L.sellable]}.`)
        const start = date(c[L.start])
        if (start === null) throw new Error(`item ${id}: no start date.`)
        const item = {
            name: c[L.name].trim(),
            effectKind: int(c[L.effectKind]),
            category: int(c[L.category]),
            salePrice: int(c[L.salePrice]) ?? 0,
            sellable: c[L.sellable] === "true",
            start,
            end: date(c[L.end]),
        }
        if (item.effectKind === 2) {
            item.stamina = int(c[L.effectValue])
            if (!(item.stamina > 0)) throw new Error(`item ${id}: stamina item recovers ${c[L.effectValue]}.`)
        }
        items[id] = item
    }
    fs.writeFileSync(OUT, JSON.stringify({ items }, null, 1))
    const all = Object.values(items)
    console.log(`Wrote ${OUT}: ${all.length} items, ${all.filter(i => i.effectKind === 2).length} stamina items, ${all.filter(i => i.sellable).length} sellable.`)
})()
