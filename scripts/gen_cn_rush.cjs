// Adds the Grand Gauntlet events only the CN client has to assets/rush_event_quest_folder.json (each
// folder's clear rewards), like scripts/converter.py's convert_rush_event_quest_folder: up to 10
// reward slots of (type, id, count) from column 7. Checked against global's event 700001 first.
// The battles themselves come from scripts/gen_cn_quests.cjs (rush_event_quest.json).
//
//   node scripts/gen_cn_rush.cjs
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")

const file = path.join(__dirname, "..", "assets", "rush_event_quest_folder.json")
;(async () => {
    const data = JSON.parse(fs.readFileSync(file, "utf8"))
    const t = await readCnTable("master/quest/event/rush_event_quest_folder.orderedmap")
    const cn = {}
    for (const [key, line] of Object.entries(t)) {
        const [eventId, folderId] = key.split("/")
        const c = R.splitCsv(line.replace(/\n$/, ""))
        const rewards = []
        for (let at = 7, n = 0; n < 10; n++, at += 3) {
            if (c[at] === undefined || c[at] === "(None)" || c[at] === "") continue
            const reward = { type: Number(c[at]) }
            if (c[at + 1] !== "") reward.id = Number(c[at + 1])
            if (c[at + 2] !== "") reward.count = Number(c[at + 2])
            rewards.push(reward)
        }
        ;(cn[eventId] ??= {})[folderId] = rewards
    }
    console.log(`check 700001: ${JSON.stringify(cn["700001"]) === JSON.stringify(data["700001"]) ? "same as global" : "DIFFERENT"}`)
    let added = 0
    for (const [id, folders] of Object.entries(cn)) if (data[id] === undefined) { data[id] = folders; added++ }
    fs.writeFileSync(file, JSON.stringify(data))
    console.log(`added ${added} CN-only Grand Gauntlet events`)
})().catch(e => { console.error(e); process.exit(1) })
