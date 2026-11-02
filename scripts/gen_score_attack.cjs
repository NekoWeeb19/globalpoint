// Builds the Score Attack data from the global client's own master tables (see scripts/cdn_master.cjs):
//   assets/score_attack_event_quest.json  the quests' battle rewards (the old converter.py left zeros)
//   assets/score_attack.json              grade scores and score border rewards per quest
//
//   node scripts/gen_score_attack.cjs
//
// score_attack_event_quest (event -> local quest, 112 columns on global; after column 2 they sit one
// column before the Chinese fork's, content/converters/quest.ts): 0 quest id (event * 1000 + local),
// 51..54 the B / A / S / SS scores, 85..88 rank points / unit EXP / mana / pool EXP (no clear reward or
// drop group on global)
// score_attack_border_reward (id -> 24 columns, the Chinese fork's layout): 1 event, 2 local quest,
// 4 score, 5 reason, then 6 slots of (kind, id, amount) from column 6; kind 0 is an item.

const path = require("path")
const fs = require("fs")
const { ROOT, readTable, readRows, parseCsvLine, int } = require("./cdn_master.cjs")

const QUESTS_OUT = path.join(ROOT, "assets", "score_attack_event_quest.json")
const DATA_OUT = path.join(ROOT, "assets", "score_attack.json")

const number = (value, what) => {
    const n = Number(value)
    if (value === "" || !Number.isFinite(n) || n < 0) throw new Error(`${what}: expected a number, got ${value}.`)
    return n
}

;(async () => {
    const quests = {}
    const grades = {}
    for (const row of await readRows("master/quest/event/score_attack_event_quest.orderedmap", 2)) {
        const c = parseCsvLine(row.text)
        if (c.length !== 112) throw new Error(`quest ${c[0]}: expected 112 columns, got ${c.length}.`)
        const [eventId, localId] = row.path.map(Number)
        const id = Number(c[0])
        if (id !== eventId * 1000 + localId) throw new Error(`quest ${c[0]} isn't event ${eventId} * 1000 + ${localId}.`)
        const scores = [51, 52, 53, 54].map(col => number(c[col], `quest ${id} grade score ${col}`))
        if (scores.some((s, i) => i > 0 && s < scores[i - 1])) throw new Error(`quest ${id}: grade scores go down.`)
        quests[id] = {
            name: "",
            bRankTime: 0,
            aRankTime: 0,
            sRankTime: 0,
            sPlusRankTime: 0,
            rankPointReward: number(c[85], `quest ${id} rank points`),
            characterExpReward: number(c[86], `quest ${id} unit EXP`),
            manaReward: number(c[87], `quest ${id} mana`),
            poolExpReward: number(c[88], `quest ${id} pool EXP`),
        }
        grades[id] = { eventId, localId, scores }
    }

    const borders = {}
    for (const [borderId, line] of Object.entries(await readTable("master/quest/event/score_attack_border_reward.orderedmap", false))) {
        const c = parseCsvLine(line)
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
})()
