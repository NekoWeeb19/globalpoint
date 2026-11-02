// Builds assets/carnival_event.json (Hanifolk Carnival) from the global client's own master tables
// in the CDN archives (see scripts/cdn_master.cjs).
//
//   node scripts/gen_carnival.cjs
//
// Columns follow the Chinese StarPoint fork (src/content/converters/quest.ts and
// src/lib/carnival-reward-parser.ts), re-checked against the global tables.

const path = require("path")
const fs = require("fs")
const { ROOT, readTable, parseCsvLine, int } = require("./cdn_master.cjs")

const OUT = path.join(ROOT, "assets", "carnival_event.json")

;(async () => {
    // master/quest/event/carnival_event_quest: { event id: { quest number: csv } }
    // column 0 is the quest id this server uses, 1 the folder (one per element), 100 the time limit
    // in frames (60 per second), 104 the difficulty score.
    const questTable = await readTable("master/quest/event/carnival_event_quest.orderedmap", true)
    const quests = {}
    for (const [eventId, rows] of Object.entries(questTable)) {
        for (const line of Object.values(rows)) {
            const c = parseCsvLine(line)
            const questId = int(c[0]), folderId = int(c[1]), timeLimitFrames = int(c[100]), difficultyScore = int(c[104])
            if (questId === null || folderId === null || timeLimitFrames === null || difficultyScore === null) {
                throw new Error(`Carnival quest ${eventId}/${c[0]} is missing a folder, time limit or difficulty score.`)
            }
            quests[questId] = {
                eventId: Number(eventId),
                folderId,
                difficultyScore,
                timeLimitMs: Math.round(timeLimitFrames * 1000 / 60),
            }
        }
    }

    // master/quest/event/carnival_event_total_score_reward: { reward id: csv }
    // columns: 0 event id, 1 name, 2 total score needed, 3 reason id, then up to six slots of
    // (kind, id, amount) from column 4. Kinds: 0 item, 1 armament, 2 beads, 3 mana, 4 exp, 6 title.
    const rewardTable = await readTable("master/quest/event/carnival_event_total_score_reward.orderedmap", false)
    const rewards = {}
    for (const [rewardId, line] of Object.entries(rewardTable)) {
        const c = parseCsvLine(line)
        const slots = []
        for (let i = 4; i < 22; i += 3) {
            const kind = int(c[i])
            if (kind === null) continue
            const id = int(c[i + 1]), amount = int(c[i + 2])
            if (amount === null || amount <= 0) throw new Error(`Carnival reward ${rewardId} has a slot without an amount.`)
            slots.push(id === null ? { kind, amount } : { kind, id, amount })
        }
        rewards[rewardId] = { eventId: int(c[0]), name: c[1], score: int(c[2]), reasonId: int(c[3]), rewards: slots }
    }

    const data = {
        _note: "Hanifolk Carnival, from the global client's master tables (built by scripts/gen_carnival.cjs). "
            + "'quests' is keyed by this server's carnival quest id: the event, the folder (one per element), the "
            + "difficulty score and the time limit. A clear scores difficultyScore + max(0, timeLimitMs - clear time ms) "
            + "(the Chinese fork's rule). 'rewards' are the total-score rewards, paid once each when the sum of the best "
            + "score of every folder reaches 'score'. Reward kinds: 0 item, 1 armament, 2 beads, 3 mana, 4 exp, 6 title.",
        quests,
        rewards,
    }
    fs.writeFileSync(OUT, JSON.stringify(data, null, 1))
    console.log(`Wrote ${OUT}: ${Object.keys(quests).length} quests, ${Object.keys(rewards).length} rewards (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`)
})().catch(error => {
    console.error(error)
    process.exit(1)
})
