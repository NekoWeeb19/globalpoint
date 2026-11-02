// Adds the raids only the CN client has (Sagas of Conquest 6 and 7, from the CN game files) to the
// server's raid data, next to global's (scripts/gen_raid.cjs): assets/raid_event.json (event, stages'
// kill weights, kill-count rewards) and assets/raid_event_quest.json (the stages' battle data).
// Global raids are left as they are.
//
// CN columns (one more than global in places; from the Chinese fork's converters):
//   raid_event: 0 code, 17 required kill count, 22/23/24 open, battles until, rewards until
//   raid_event_quest (by event): 0 quest id, 4 name, 6 clear reward, 52 kill weight, 69 drop group,
//                    70 element, 83-86 rank points, unit EXP, mana, pool EXP
//   raid_event_overall_reward: 0 event, 2 type, 3 threshold/start, 4 interval, slots of
//                    (kind, item, amount) from 7
//
//   node scripts/gen_cn_raid.cjs
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("F:/WF client/tools/cn_read.cjs")

const ROOT = path.join(__dirname, "..")
const int = v => (v === undefined || v === "" || v === "(None)" ? null : Number.parseInt(v))
const str = v => (v === undefined || v === "" || v === "(None)" ? null : v)

;(async () => {
    const raidFile = path.join(ROOT, "assets", "raid_event.json")
    const questFile = path.join(ROOT, "assets", "raid_event_quest.json")
    const raid = JSON.parse(fs.readFileSync(raidFile, "utf8"))
    const quests = JSON.parse(fs.readFileSync(questFile, "utf8"))
    const cn = s => readCnTable(`master/quest/event/${s}.orderedmap`)
    const [events, stages, rewards] = await Promise.all([cn("raid_event"), cn("raid_event_quest"), cn("raid_event_overall_reward")])

    const added = []
    for (const [id, line] of Object.entries(events)) {
        if (raid.events[id]) continue
        const c = R.splitCsv(line)
        raid.events[id] = { code: c[0], requiredKillCount: int(c[17]), start: str(c[22]), battleEnd: str(c[23]), end: str(c[24]), cn: true }
        added.push(id)
    }
    let stageCount = 0
    for (const [key, line] of Object.entries(stages)) {
        const [eventId] = key.split("/")
        if (!added.includes(eventId)) continue
        const c = R.splitCsv(line)
        const questId = int(c[0])
        raid.quests[questId] = { eventId: Number(eventId), killWeight: int(c[52]) }
        quests[questId] = {
            name: c[4],
            clearRewardId: int(c[6]) ?? 1,
            scoreRewardGroup: int(c[69]),
            bRankTime: 0, aRankTime: 0, sRankTime: 0, sPlusRankTime: 0,
            rankPointReward: int(c[83]) ?? 0, characterExpReward: int(c[84]) ?? 0,
            manaReward: int(c[85]) ?? 0, poolExpReward: int(c[86]) ?? 0,
        }
        stageCount++
    }
    let rewardCount = 0
    for (const [id, line] of Object.entries(rewards)) {
        const c = R.splitCsv(line)
        if (!added.includes(c[0])) continue
        const slots = []
        for (let i = 7; i + 2 < c.length && slots.length < 10; i += 3) {
            const kind = int(c[i]), amount = int(c[i + 2])
            if (kind === null || amount === null) continue
            slots.push(kind === 0 ? { kind, itemId: int(c[i + 1]), amount } : { kind, amount })
        }
        const type = int(c[2])
        // CN ids overlap global ones: shifted by 100000 (the raid code reads them as numbers)
        raid.rewards[String(100000 + Number(id))] = {
            eventId: int(c[0]),
            requirement: type === 0 ? { type: "total", threshold: int(c[3]) } : { type: "each", ...(int(c[3]) === null ? {} : { start: int(c[3]) }), interval: int(c[4]) },
            rewards: slots,
        }
        rewardCount++
    }
    fs.writeFileSync(raidFile, JSON.stringify(raid, null, 1))
    fs.writeFileSync(questFile, JSON.stringify(quests))
    console.log(`added CN raids ${added.join(", ") || "(none)"}: ${stageCount} stages, ${rewardCount} rewards`)
})().catch(e => { console.error(e); process.exit(1) })
