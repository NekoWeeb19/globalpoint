// Armament augmentation ("Augment Armament" in the shop; shop type 10): each offer raises one armament's
// augment level, in stages. Built for both clients from their own tables
// (master/equipment_enhancement/equipment_enhancement_shop, 50 columns, same layout in both):
//   0 category (the section: 1 Nostalgia/boss coin, 2 Purger, 3 Steambot, 4 Pur Lilie), 2 group,
//   3 stage, 4 kind (1 = augmentation), 14..21 cost item pairs, 22/23 offered from/until,
//   29 armament id, 30 the augment level this stage goes up to, 31 the awakening level it needs.
// The rules follow the Chinese fork (lib/shop-sales-list.ts, lib/equipment-enhancement.ts): only the
// armament's current stage is offered; buying adds levels up to that stage's maximum.
//
//   node --env-file=.env scripts/gen_equipment_enhancement.cjs
//   -> assets/equipment_enhancement_shop.json (global) and assets/equipment_enhancement_shop_cn.json
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readTable, parseCsvLine } = require("./cdn_master.cjs")
const { readCnTable } = require("F:/WF client/tools/cn_read.cjs")

const ROOT = path.join(__dirname, "..")
const TABLE = "master/equipment_enhancement/equipment_enhancement_shop.orderedmap"
const NONE = v => v === undefined || v === "" || v === "(None)"

function convert(rows, toUtc) {
    const out = {}
    for (const [id, c] of rows) {
        if (c[4] !== "1") continue
        const costs = []
        for (let o = 14; o <= 20; o += 2) if (!NONE(c[o])) costs.push({ id: Number(c[o]), amount: Number(c[o + 1]) })
        out[id] = {
            costs, rewards: [],
            availableFrom: toUtc(c[22]) ?? "2000-01-01 00:00:00", availableUntil: toUtc(c[23]),
            stock: -1,
            category: Number(c[0]), groupId: Number(c[2]), stage: Number(c[3]),
            equipmentId: Number(c[29]), maxLevel: Number(c[30]), requireAwakening: Number(c[31]) || 0,
        }
    }
    return out
}

;(async () => {
    const global = Object.entries(await readTable(TABLE, false)).map(([id, l]) => [id, parseCsvLine(l)])
    const g = convert(global, v => (NONE(v) ? null : v))
    fs.writeFileSync(path.join(ROOT, "assets", "equipment_enhancement_shop.json"), JSON.stringify(g))
    const cnRows = Object.entries(await readCnTable(TABLE)).map(([id, l]) => [id, R.splitCsv(l.replace(/\n$/, ""))])
    const cnUtc = v => {
        if (NONE(v)) return null
        const ms = Date.parse(v.replace(" ", "T") + "Z")
        return isNaN(ms) ? v : new Date(ms - 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ")
    }
    const cn = convert(cnRows, cnUtc)
    fs.writeFileSync(path.join(ROOT, "assets", "equipment_enhancement_shop_cn.json"), JSON.stringify(cn))
    const armaments = o => new Set(Object.values(o).map(x => x.equipmentId)).size
    console.log(`global: ${Object.keys(g).length} offers for ${armaments(g)} armaments; CN: ${Object.keys(cn).length} offers for ${armaments(cn)} armaments`)
})().catch(e => { console.error(e); process.exit(1) })
