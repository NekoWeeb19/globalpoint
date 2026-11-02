// Builds the Hard Multi event data from the global client's own master tables (see scripts/cdn_master.cjs):
//   assets/hard_multi_event_quest.json  the quests, in the RawQuests shape the other quest files use
//   assets/periodic_reward.json         the "Daily Reward Count" points and the bonus drop they pay
//
//   node scripts/gen_hard_multi.cjs
//
// Layouts (the Chinese fork's, content/converters/quest.ts and periodic-reward.ts; the global rows match):
//   hard_multi_event_quest (event -> quest): 0 quest id, 2 name, 4 clear reward, 71 score reward group,
//     72 S+ reward, 85..88 B/A/S/S+ rank times (seconds), 94..97 rank points / unit EXP / mana / pool EXP,
//     107 enemy level, 123 periodic reward group, 124 periodic reward slots
//   hard_multi_event (26 columns): 14 periodic reward point id
//   periodic_reward_point (9 columns): 1 max points, 2 points added per daily reset, 3 recovery cycle
//     (0 = each daily reset), 7/8 open from/until
//   periodic_reward (group -> index, 5 columns): 1 kind (0 item), 2 item id, 3 count, 4 probability

const path = require("path")
const fs = require("fs")
const { ROOT, readTable, readRows, parseCsvLine, str, int } = require("./cdn_master.cjs")

const QUESTS_OUT = path.join(ROOT, "assets", "hard_multi_event_quest.json")
const PERIODIC_OUT = path.join(ROOT, "assets", "periodic_reward.json")

const need = (value, what) => {
    const n = int(value)
    if (n === null || n < 0) throw new Error(`${what}: expected a number, got ${value}.`)
    return n
}
const seconds = (value, what) => {
    const n = Number(value)
    if (!(n > 0)) throw new Error(`${what}: expected seconds, got ${value}.`)
    return Math.floor(n * 1000)
}

;(async () => {
    const scoreRewards = require(path.join(ROOT, "assets", "score_reward.json"))
    const clearRewards = require(path.join(ROOT, "assets", "clear_reward.json"))

    const quests = {}
    const questPeriodic = {}
    for (const row of await readRows("master/quest/event/hard_multi_event_quest.orderedmap", 2)) {
        const c = parseCsvLine(row.text)
        if (c.length < 125) throw new Error(`quest ${c[0]}: expected at least 125 columns, got ${c.length}.`)
        const id = c[0]
        const quest = {
            name: "",
            clearRewardId: need(c[4], `quest ${id} clear reward`),
            sPlusRewardId: need(c[72], `quest ${id} S+ reward`),
            scoreRewardGroup: need(c[71], `quest ${id} score group`),
            bRankTime: seconds(c[85], `quest ${id} B time`),
            aRankTime: seconds(c[86], `quest ${id} A time`),
            sRankTime: seconds(c[87], `quest ${id} S time`),
            sPlusRankTime: seconds(c[88], `quest ${id} S+ time`),
            rankPointReward: need(c[94], `quest ${id} rank points`),
            characterExpReward: need(c[95], `quest ${id} unit EXP`),
            manaReward: need(c[96], `quest ${id} mana`),
            poolExpReward: need(c[97], `quest ${id} pool EXP`),
        }
        for (const [what, ok] of [["clear reward", clearRewards[quest.clearRewardId]], ["S+ reward", clearRewards[quest.sPlusRewardId]], ["score group", scoreRewards[quest.scoreRewardGroup]]]) {
            if (ok === undefined) throw new Error(`quest ${id}: ${what} is missing from the server's data.`)
        }
        quests[id] = quest
        const group = int(c[123]), slots = int(c[124])
        if (group !== null && slots !== null && slots > 0) questPeriodic[id] = { groupId: group, slots }
    }

    const events = {}
    for (const [eventId, line] of Object.entries(await readTable("master/quest/event/hard_multi_event.orderedmap", false))) {
        const c = parseCsvLine(line)
        if (c.length !== 26) throw new Error(`event ${eventId}: expected 26 columns, got ${c.length}.`)
        const pointId = int(c[14])
        if (pointId !== null) events[eventId] = { pointId }
    }

    const points = {}
    for (const [pointId, line] of Object.entries(await readTable("master/reward/periodic_reward_point.orderedmap", false))) {
        const c = parseCsvLine(line)
        if (c.length !== 9) throw new Error(`point ${pointId}: expected 9 columns, got ${c.length}.`)
        points[pointId] = { maxPoint: need(c[1], `point ${pointId} max`), recoveryPoint: need(c[2], `point ${pointId} recovery`), recoveryCycle: need(c[3], `point ${pointId} cycle`), start: str(c[7]), end: str(c[8]) }
    }

    const groups = {}
    for (const [groupId, rows] of Object.entries(await readTable("master/reward/periodic_reward.orderedmap", true))) {
        groups[groupId] = {}
        for (const [index, line] of Object.entries(rows)) {
            const c = parseCsvLine(line)
            if (c.length !== 5 || c[1] !== "0") throw new Error(`periodic reward ${groupId}/${index}: not an item row: ${line}`)
            const probability = Number(c[4])
            if (!(probability >= 0 && probability <= 1)) throw new Error(`periodic reward ${groupId}/${index}: probability ${c[4]}.`)
            groups[groupId][index] = { itemId: need(c[2], "item"), count: need(c[3], "count"), probability }
        }
    }

    for (const [questId, p] of Object.entries(questPeriodic)) {
        const point = events[String(Math.floor(Number(questId) / 1000))]?.pointId
        if (point === undefined || points[point] === undefined) throw new Error(`quest ${questId}: no point for its event.`)
        if (groups[p.groupId] === undefined) throw new Error(`quest ${questId}: missing periodic reward group ${p.groupId}.`)
    }

    fs.writeFileSync(QUESTS_OUT, JSON.stringify(quests, null, 4))
    fs.writeFileSync(PERIODIC_OUT, JSON.stringify({ events, points, groups, quests: questPeriodic }, null, 1))
    console.log(`Wrote ${QUESTS_OUT}: ${Object.keys(quests).length} quests (${Object.keys(quests).join(", ")}).`)
    console.log(`Wrote ${PERIODIC_OUT}: ${Object.keys(events).length} events, ${Object.keys(points).length} point kinds, ${Object.keys(groups).length} reward groups.`)
})()
