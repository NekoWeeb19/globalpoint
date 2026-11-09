// Items global's game has and CN's doesn't (e.g. 50107 Polar Bear Cookies, global's People's Choice Tickets
// 980006-980008), as rows for CN's item table: a save holding one (from global data, a global save brought over, or
// an edited save) stopped the CN game with C8601 ("key does not exist") on every screen that lists items. The CN
// update builder (scripts/gen_cn_event_schedule.cjs) adds these rows to CN's item table when it lacks them.
//
// CN's item row is global's with the id after the string id and global's column 20 left out, plus an empty last
// column (checked on 980005 and 50106, which both games have). Item icons are cells of one sprite sheet
// (item_icon/sprite_sheet), so an icon CN's sheet lacks is swapped for a CN one (ICON_SWAPS).
//
//   node --env-file=.env scripts/gen_cn_global_items.cjs   -> assets/cn_global_items.json
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")
const { readTable } = require("./cdn_master.cjs")

const TABLE = "master/item/item.orderedmap"
// global icon -> a CN item's icon of the same kind (CN's sheet has no White Day 2023 cell)
const ICON_SWAPS = {
    "item/materials/event/whiteday_23/white_day_2023": "item/materials/event/whiteday_22/white_day_2022",
}

;(async () => {
    const global = await readTable(TABLE, false)
    const cn = await readCnTable(TABLE)
    const cnIcons = new Set(Object.values(cn).map(line => R.splitCsv(line.replace(/\n$/, ""))[3]))
    const rows = {}
    for (const [key, line] of Object.entries(global)) {
        const id = key.split("/")[0]
        if (cn[id] !== undefined || key.includes("/")) continue
        const g = R.splitCsv(line.replace(/\n$/, ""))
        const icon = ICON_SWAPS[g[2]] ?? g[2]
        if (!cnIcons.has(icon)) { console.log(`${id} ${g[1]}: icon ${g[2]} isn't on CN's sheet, left out (add an ICON_SWAPS entry)`); continue }
        const c = [g[0], id, g[1], icon, ...g.slice(3, 20), g[21], ""]
        rows[id] = c.map(R.csvField).join(",")
        console.log(`${id} ${g[1]}${icon !== g[2] ? ` (icon ${icon})` : ""}`)
    }
    const out = path.join(__dirname, "..", "assets", "cn_global_items.json")
    fs.writeFileSync(out, JSON.stringify({ _note: "Built by scripts/gen_cn_global_items.cjs: global-only items as CN item table rows.", table: TABLE, rows }, null, 1))
    console.log(`wrote ${out}: ${Object.keys(rows).length} item(s)`)
})().catch(e => { console.error(e); process.exit(1) })
