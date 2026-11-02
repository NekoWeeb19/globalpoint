// Adds the boss event (advent) battles only the CN client has to assets/advent_event_rules.json, so
// CN-only Purge-style events work like global's (src/lib/soloAdvent.ts: multiplayer-only battles count
// as cleared as host while the event is open; solo-only battles that need a ticket get one a day).
//
// CN columns (checked against the 215 battles both clients have: 212 agree, 3 changed by CN):
//   0 quest id, 5/6 open from/until (China time, stored as UTC), 52 battle (1), 53 who can play
//   (0 solo only, 1 solo or multiplayer, 2 multiplayer only), 61/62/63 entry ticket (global: 59-61).
//
//   node scripts/gen_cn_advent_rules.cjs
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("F:/WF client/tools/cn_read.cjs")

const file = path.join(__dirname, "..", "assets", "advent_event_rules.json")
const utc = v => {
    const ms = Date.parse(String(v).replace(" ", "T") + "Z")
    return isNaN(ms) ? null : new Date(ms - 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ")
}

;(async () => {
    const data = JSON.parse(fs.readFileSync(file, "utf8"))
    const t = await readCnTable("master/quest/event/advent_event_quest.orderedmap")
    let added = 0
    for (const [key, line] of Object.entries(t)) {
        const c = R.splitCsv(line.replace(/\n$/, ""))
        if (c[52] !== "1" || data.quests[c[0]] !== undefined) continue
        const quest = { eventId: Number(key.split("/")[0]), playMode: Number(c[53]), start: utc(c[5]), end: utc(c[6]), cn: true }
        if (c[61] === "1") quest.entryItem = { id: Number(c[62]), count: Number(c[63]) }
        data.quests[c[0]] = quest
        added++
    }
    fs.writeFileSync(file, JSON.stringify(data, null, 1))
    const cn = Object.values(data.quests).filter(q => q.cn)
    console.log(`added ${added} CN-only boss battles: ${cn.filter(q => q.playMode === 2).length} multiplayer only, ${cn.filter(q => q.entryItem).length} with a ticket`)
})().catch(e => { console.error(e); process.exit(1) })
