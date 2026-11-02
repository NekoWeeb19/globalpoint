// Mana boards the CN game has and global's data (assets/mana_node.json) doesn't: the CN-only units'
// boards and the 2nd boards CN added after global's end of service. Same shape as mana_node.json;
// src/lib/assets.ts getCharacterManaNodesSync falls back to it.
//
// CN columns (master/mana_board/mana_node, key "<unit>/<board>/<index>"):
//   0 node id, 1 field1, 2 item ids, 3 item counts, 4 mana, 5 field5, 6 field6 (slot)
//
//   node --env-file=.env scripts/gen_cn_mana_nodes.cjs   -> assets/mana_node_cn.json
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("F:/WF client/tools/cn_read.cjs")
const globalNodes = require("../assets/mana_node.json")

const OUT = path.join(__dirname, "..", "assets", "mana_node_cn.json")
const list = v => (v === undefined || v === "" || v === "(None)" ? [] : String(v).split(",").map(x => x.trim()).filter(Boolean))

;(async () => {
    const out = {}
    let boards = 0, nodes = 0
    for (const [key, raw] of Object.entries(await readCnTable("master/mana_board/mana_node.orderedmap"))) {
        const [unit, board] = key.split("/")
        if (globalNodes[unit]?.[board]) continue // global has this board
        const c = R.splitCsv(raw.replace(/\n$/, ""))
        const ids = list(c[2]), counts = list(c[3])
        const items = {}
        ids.forEach((id, i) => { items[id] = Number(counts[i]) })
        const target = (out[unit] ??= {})[board] ??= (boards++, {})
        target[c[0]] = { items, manaCost: Number(c[4]), field1: c[1], field5: c[5], field6: c[6] }
        nodes++
    }
    fs.writeFileSync(OUT, JSON.stringify(out))
    console.log(`Wrote ${OUT}: ${Object.keys(out).length} units, ${boards} boards, ${nodes} nodes`)
})().catch(e => { console.error(e); process.exit(1) })
