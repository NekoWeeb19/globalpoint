// Lists each CN summon banner's own tickets (CN master/gacha/gacha: column 27 = single-pull ticket,
// 28 = 10-pull ticket, 45 = "crazy" 10-pull ticket) for gacha/exec: the CN client pulls with those
// tickets using draw kinds 3, 4 and 14, which global doesn't have.
//
//   node scripts/gen_cn_gacha_tickets.cjs     -> assets/cn_gacha_tickets.json { gachaId: { once, ten, crazy } }
const fs = require("fs")
const path = require("path")
const { readCnTable } = require("F:/WF client/tools/cn_read.cjs")
const { recordsOf } = require("./gen_cn_text.cjs")

;(async () => {
    const rows = await readCnTable("master/gacha/gacha.orderedmap")
    if (!rows) throw new Error("master/gacha/gacha is not in the CN game files")
    const id = v => v === undefined || v === "" || v === "(None)" ? undefined : Number(v)
    const out = {}
    for (const [key, text] of Object.entries(rows)) {
        const cells = recordsOf(String(text))[0] ?? []
        const tickets = { once: id(cells[27]), ten: id(cells[28]), crazy: id(cells[45]) }
        if (tickets.once || tickets.ten || tickets.crazy) out[key.split("/")[0]] = tickets
    }
    const file = path.join(__dirname, "..", "assets", "cn_gacha_tickets.json")
    fs.writeFileSync(file, JSON.stringify(out, null, 1))
    console.log(`${Object.keys(out).length} banners with their own tickets -> ${file}`)
})()
