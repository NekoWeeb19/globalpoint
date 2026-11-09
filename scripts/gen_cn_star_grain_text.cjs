// English text fixes for the Star Speck Exchange (CN master/shop/star_grain_shop): the English copy of the table
// (CN_TRANSLATED_DIR) was made from an older version of CN's rows, so products 100001-100022 showed other products'
// names and descriptions (a Staminade Flask called "Engagement Pendant"). Only the text was off: costs, rewards, stock
// and pictures match CN's rows. This works out each product's English text from what it gives and writes fixes for the
// rows whose English belongs to something else; scripts/gen_cn_event_schedule.cjs puts them in the table it ships.
//
// Columns: 1 name, 3 description, 4 second line; 25 reward type (0 item, 3 unit, 4 armament), 26 reward id, 27 count.
//
//   node --env-file=.env scripts/gen_cn_star_grain_text.cjs   -> assets/cn_star_grain_text.json
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")
const { uploadPath } = require("./cdn_hash.cjs")

const TRANSLATED = process.env.CN_TRANSLATED_DIR || "F:/WF client/globalize/text40"
const SHOP = "master/shop/star_grain_shop.orderedmap"
// the English unit text table (name, nickname, profile, ...), by unit id
const UNIT_TEXT = "production/upload/8b/035728b2151de044fb245988ec5f33ebb544ab"
// element training boxes (CN "<element>属性培育素材箱") hold the same as that element's Mini Upgrade Bundle
const BOX_ELEMENTS = { "火": ["Fire", "100038"], "水": ["Water", "100039"], "雷": ["Thunder", "100040"], "风": ["Wind", "100041"], "光": ["Light", "100042"], "暗": ["Dark", "100043"] }

const readEnglish = file => {
    const p = path.join(TRANSLATED, file.startsWith("production/") ? file : uploadPath(file))
    const out = {}
    for (const x of R.leaves(R.decodeFile(fs.readFileSync(p)))) out[x.path.join("/")] = R.splitCsv(x.leaf.text.replace(/\n$/, ""))
    return out
}
const stripNew = s => String(s ?? "").replace(/^\s*(【追加】|\[New\])\s*/, "").trim()

;(async () => {
    const cn = await readCnTable(SHOP)
    const cnItems = await readCnTable("master/item/item.orderedmap")
    const en = readEnglish(SHOP), items = readEnglish("master/item/item.orderedmap"), gear = readEnglish("master/item/equipment.orderedmap"), units = readEnglish(UNIT_TEXT)
    const enByName = {}
    for (const [k, c] of Object.entries(en)) enByName[stripNew(c[1])] ??= c
    const fixes = {}
    for (const [key, text] of Object.entries(cn)) {
        const c = R.splitCsv(text), type = c[25], id = c[26], count = Number(c[27]) || 1
        const cnName = stripNew(c[1])
        let name = null, desc = null, second = null
        if (type === "3" && units[id]) {
            name = units[id][0].trim(); desc = units[id][2]
        } else if (type === "4" && gear[id]) {
            // an armament: its own English row text unless that belongs to another product (the name is the official one)
            name = gear[id][1].trim(); desc = enByName[name]?.[3] || en[key]?.[3] || gear[id][5]
        } else if (type === "0") {
            const cnItem = cnItems[id] ? R.splitCsv(cnItems[id])[2].trim() : null
            const box = /^(.)属性培育素材箱$/.exec(cnName)
            if (box && BOX_ELEMENTS[box[1]]) {
                const [element, bundle] = BOX_ELEMENTS[box[1]]
                name = `${element} Unit Upgrade Box`; desc = en[bundle][3]; second = en[bundle][4]
            } else if (cnItem && items[id] && (cnName === cnItem || cnName.replace(/\s*[×x]\s*\d+$/, "") === cnItem)) {
                name = items[id][2].trim() + (count > 1 ? ` x${count}` : ""); desc = items[id][5]
                const rarity = /^★(\d)/.exec(cnItem)
                second = c[4] === "(None)" ? "(None)" : c[4] === c[3] ? desc : rarity ? `Usable on units of ${rarity[1]}★ or lower.` : null
            }
        }
        if (name === null || desc === null) continue
        if (stripNew(en[key]?.[1]) === name) continue // the English row is already this product's
        fixes[key] = { 1: (c[1].startsWith("【追加】") ? "[New]" : "") + name, 3: desc, 4: second ?? c[4] }
    }
    const out = path.join(__dirname, "..", "assets", "cn_star_grain_text.json")
    fs.writeFileSync(out, JSON.stringify({ _note: "Built by scripts/gen_cn_star_grain_text.cjs: English text for Star Speck Exchange rows whose English copy belonged to other products.", table: SHOP, rows: fixes }, null, 1))
    for (const [k, f] of Object.entries(fixes)) console.log(k, "|", f[1], "|", String(f[3]).replace(/\n/g, " / ").slice(0, 70), "|", String(f[4]).replace(/\n/g, " ").slice(0, 40))
    console.log(`wrote ${out}: ${Object.keys(fixes).length} row(s)`)
})().catch(e => { console.error(e); process.exit(1) })
