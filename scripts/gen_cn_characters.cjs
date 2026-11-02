// Adds the units only the CN client has to assets/character.json (rarity, element, skill count), so
// they can be pulled from CN-only summon banners and kept in the save. The columns are learned from
// the units both clients have (each field must match on nearly all of them). skill_count isn't a
// column: the server only checks whether it is over 3 (a 2nd Mana Board), so it is 6 when CN's
// mana_node table has a board 2 for the unit, else 3.
//
//   node scripts/gen_cn_characters.cjs [--dry]
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("F:/WF client/tools/cn_read.cjs")

const ROOT = path.join(__dirname, "..")
const DRY = process.argv.includes("--dry")

;(async () => {
    const file = path.join(ROOT, "assets", "character.json")
    const chars = JSON.parse(fs.readFileSync(file, "utf8"))
    const t = await readCnTable("master/character/character.orderedmap")
    const rows = Object.entries(t).map(([id, l]) => [id, R.splitCsv(l.replace(/\n$/, ""))])
    const shared = rows.filter(([id]) => chars[id])
    const plan = {}
    for (const field of ["rarity", "element"]) {
        let best = null
        const width = Math.max(...shared.map(([, c]) => c.length))
        for (let col = 0; col < width; col++) {
            const ok = shared.filter(([id, c]) => Number(c[col]) === chars[id][field] && c[col] !== "").length / shared.length
            const distinct = new Set(shared.map(([, c]) => c[col])).size
            if (distinct > 1 && (!best || ok > best.ok)) best = { col, ok }
        }
        plan[field] = best
    }
    console.log("columns:", JSON.stringify(plan))
    if (Object.values(plan).some(p => !p || p.ok < 0.95)) throw new Error("a field has no reliable column")
    const nodes = await readCnTable("master/mana_board/mana_node.orderedmap")
    const boardTwo = new Set(Object.keys(nodes).filter(k => k.split("/")[1] === "2").map(k => k.split("/")[0]))
    const added = []
    for (const [id, c] of rows) {
        if (chars[id]) continue
        chars[id] = { name: "", rarity: Number(c[plan.rarity.col]), element: Number(c[plan.element.col]), skill_count: boardTwo.has(id) ? 6 : 3, cn: true }
        added.push(`${id}:${c[0]}`)
    }
    if (!DRY) fs.writeFileSync(file, JSON.stringify(chars))
    console.log(`added ${added.length} CN-only units: ${added.join(" ")}`)
})().catch(e => { console.error(e); process.exit(1) })
