// The Infinite Arena (Score Attack) for the CN client, from CN's own tables. Global's (scripts/gen_score_attack.cjs)
// has only quests 1001-1030, and different score borders on them (quest 1001's first border is 1,500,000 on
// global, 1,050,000 in CN). CN adds 1031-1060 and the permanent arena 1101-1163 (one list per element, column 1),
// so a CN player starting one of those got an error.
//
// score_attack_event_quest: CN's columns sit one after global's: 0 quest id (event * 1000 + local), 52..55 the
// B / A / S / SS scores, 86..89 rank points / unit EXP / mana / pool EXP.
// score_attack_border_reward: the same layout in both: 1 event, 2 local quest, 4 score, then 6 slots of
// (kind, id, amount) from column 6; kind 0 is an item.
//
//   node --env-file=.env scripts/gen_cn_score_attack.cjs
//     -> assets/score_attack_event_quest_cn.json, assets/score_attack_cn.json

const path = require("path")
const fs = require("fs")
const { readCnTable } = require("./cn_read.cjs")
const { parseCsvLine, int } = require("./cdn_master.cjs")

const QUESTS_OUT = path.join(__dirname, "..", "assets", "score_attack_event_quest_cn.json")
const DATA_OUT = path.join(__dirname, "..", "assets", "score_attack_cn.json")

const number = (value, what) => {
    const n = Number(value)
    if (value === "" || !Number.isFinite(n) || n < 0) throw new Error(`${what}: expected a number, got ${value}.`)
    return n
}

;(async () => {
    const questTable = await readCnTable("master/quest/event/score_attack_event_quest.orderedmap")
    const borderTable = await readCnTable("master/quest/event/score_attack_border_reward.orderedmap")
    if (!questTable || !borderTable) throw new Error("CN's score attack tables weren't found (CN_CDN_DIR).")

    const quests = {}
    const grades = {}
    for (const [key, text] of Object.entries(questTable)) {
        const c = parseCsvLine(text.replace(/\n$/, ""))
        if (c.length !== 113) throw new Error(`quest ${c[0]}: expected 113 columns, got ${c.length}.`)
        const [eventId, localId] = key.split("/").map(Number)
        const id = Number(c[0])
        if (id !== eventId * 1000 + localId) throw new Error(`quest ${c[0]} isn't event ${eventId} * 1000 + ${localId}.`)
        const scores = [52, 53, 54, 55].map(col => number(c[col], `quest ${id} grade score ${col}`))
        if (scores.some((s, i) => i > 0 && s < scores[i - 1])) throw new Error(`quest ${id}: grade scores go down.`)
        quests[id] = {
            name: "",
            bRankTime: 0,
            aRankTime: 0,
            sRankTime: 0,
            sPlusRankTime: 0,
            rankPointReward: number(c[86], `quest ${id} rank points`),
            characterExpReward: number(c[87], `quest ${id} unit EXP`),
            manaReward: number(c[88], `quest ${id} mana`),
            poolExpReward: number(c[89], `quest ${id} pool EXP`),
        }
        grades[id] = { eventId, localId, scores }
    }

    const borders = {}
    for (const [borderId, text] of Object.entries(borderTable)) {
        const c = parseCsvLine(text.replace(/\n$/, ""))
        if (c.length !== 24) throw new Error(`border ${borderId}: expected 24 columns, got ${c.length}.`)
        const questId = int(c[1]) * 1000 + int(c[2])
        if (grades[questId] === undefined) throw new Error(`border ${borderId}: no quest ${questId}.`)
        const rewards = []
        for (let slot = 0; slot < 6; slot++) {
            const kind = int(c[6 + slot * 3])
            if (kind === null) continue
            if (kind !== 0) throw new Error(`border ${borderId}: reward kind ${kind} isn't an item.`)
            rewards.push({ itemId: int(c[7 + slot * 3]), amount: int(c[8 + slot * 3]) })
        }
        if (rewards.length === 0 || rewards.some(r => !(r.itemId > 0) || !(r.amount > 0))) throw new Error(`border ${borderId}: bad rewards.`)
        ;(borders[questId] = borders[questId] ?? []).push({ id: Number(borderId), score: number(c[4], `border ${borderId} score`), rewards })
    }
    for (const tiers of Object.values(borders)) tiers.sort((a, b) => a.score - b.score || a.id - b.id)
    for (const id of Object.keys(grades)) if (borders[id] === undefined) throw new Error(`quest ${id} has no score borders.`)

    fs.writeFileSync(QUESTS_OUT, JSON.stringify(quests, null, 4))
    fs.writeFileSync(DATA_OUT, JSON.stringify({ quests: grades, borders }))
    console.log(`Wrote ${QUESTS_OUT}: ${Object.keys(quests).length} quests.`)
    console.log(`Wrote ${DATA_OUT}: grades for ${Object.keys(grades).length} quests, ${Object.values(borders).reduce((n, t) => n + t.length, 0)} score borders.`)
})().catch(error => { console.error(error.message); process.exit(1) })
