// Grand Gauntlet (Rush) folder clear rewards: up to 10 reward slots of (type, id, count) from column 7 of
// each folder row, like scripts/converter.py's convert_rush_event_quest_folder.
//
// - assets/rush_event_quest_folder_cn.json: CN's own rewards for every CN event; the CN app is paid from these
//   (src/lib/assets.ts getRushEventFolderClearRewards). CN pays its runs' own coins (2370001-2370007), which its
//   Gauntlet shops are priced in; global's coins 70001-70005 are other items in CN's tables (a holiday box token,
//   the Isabadika boss coins, a Golden Week 10-pull ticket), so the CN app must not get global's rewards.
// - assets/rush_event_quest_folder.json (global's): the events only the CN client has are added, as before.
// The battles themselves come from scripts/gen_cn_quests.cjs (rush_event_quest.json).
//
//   node --env-file=.env scripts/gen_cn_rush.cjs
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")

const file = path.join(__dirname, "..", "assets", "rush_event_quest_folder.json")
const cnFile = path.join(__dirname, "..", "assets", "rush_event_quest_folder_cn.json")
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
    fs.writeFileSync(cnFile, JSON.stringify(cn))
    console.log(`wrote ${cnFile}: ${Object.keys(cn).length} CN Grand Gauntlet events`)
    let added = 0
    for (const [id, folders] of Object.entries(cn)) if (data[id] === undefined) { data[id] = folders; added++ }
    fs.writeFileSync(file, JSON.stringify(data))
    console.log(`added ${added} CN-only Grand Gauntlet events to global's file`)
})().catch(e => { console.error(e); process.exit(1) })
