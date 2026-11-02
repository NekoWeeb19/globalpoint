// Adds the box summons ("Portal Box", event reward boxes) only the CN client has to
// assets/box_gacha.json and assets/box_reward.json, like global's. Columns (same as global's data):
//   box_gacha: 1 kind, 2 ticket item id, 3 tickets per draw
//   box_reward (box gacha / box / reward): 0 id, 2 type, 3 item id, 4 count, 5 how many in the box, 6 tier
// Reward type 6 on CN is global's 5 (the other types are the same); an empty item id is left out.
// A box's size (availableCounts) is the sum of its rewards. Checked against global's box 1.
//
//   node scripts/gen_cn_box_gacha.cjs
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("F:/WF client/tools/cn_read.cjs")

const ROOT = path.join(__dirname, "..")
;(async () => {
    const gFile = path.join(ROOT, "assets", "box_gacha.json"), rFile = path.join(ROOT, "assets", "box_reward.json")
    const gachas = JSON.parse(fs.readFileSync(gFile, "utf8")), rewards = JSON.parse(fs.readFileSync(rFile, "utf8"))
    const g = await readCnTable("master/box_gacha/box_gacha.orderedmap")
    const r = await readCnTable("master/box_gacha/box_reward.orderedmap")
    const byGacha = {}
    for (const [key, line] of Object.entries(r)) {
        const [gid, box] = key.split("/")
        const c = R.splitCsv(line.replace(/\n$/, ""))
        const reward = { type: c[2] === "6" ? 5 : Number(c[2]), count: Number(c[4]), available: Number(c[5]), tier: Number(c[6]) }
        if (c[3] !== "" && c[3] !== "(None)") reward.id = Number(c[3])
        ;((byGacha[gid] ??= {})[box] ??= {})[c[0]] = reward
    }
    // check on a box both have
    const same = JSON.stringify(byGacha["1"]) === JSON.stringify(rewards["1"])
    console.log(`check box gacha 1: ${same ? "same as global" : "DIFFERENT"}`)
    // entries this script added before are made again
    for (const [id, gacha] of Object.entries(gachas)) if (gacha.cn) { delete gachas[id]; delete rewards[id] }
    let added = 0
    for (const [id, line] of Object.entries(g)) {
        if (gachas[id] !== undefined || !byGacha[id]) continue
        const c = R.splitCsv(line.replace(/\n$/, ""))
        const availableCounts = Object.fromEntries(Object.entries(byGacha[id]).map(([box, list]) => [box, Object.values(list).reduce((s, x) => s + x.available, 0)]))
        gachas[id] = { itemId: Number(c[2]), count: Number(c[3]), availableCounts, cn: true }
        rewards[id] = byGacha[id]
        added++
    }
    fs.writeFileSync(gFile, JSON.stringify(gachas))
    fs.writeFileSync(rFile, JSON.stringify(rewards))
    console.log(`added ${added} CN-only box summons`)
})().catch(e => { console.error(e); process.exit(1) })
