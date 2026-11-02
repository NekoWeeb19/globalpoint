// Builds assets/ranking_event.json (Time Attack: the "Speed Run: Trial by ..." ranking events) from
// the global client's own master tables (see scripts/cdn_master.cjs).
//
//   node scripts/gen_ranking.cjs
//
// Columns (global client; the Chinese fork's converter reads the same layout):
//   ranking_event: 2 name.
//   ranking_event_single_quest (nested by event): 0 quest id.
//   ranking_event_ranking_reward (nested by event, one row per tier, best first): 0 tier id,
//               1 rank border (share of players, 0.03 = top 3%), 2 reason id, from 3 up to 10 slots
//               of (kind, id, amount) with kind 0 item, 1 equipment, 2 beads, 3 mana, 4 EXP, 6 title.

const path = require("path")
const fs = require("fs")
const { ROOT, readTable, parseCsvLine, str, int } = require("./cdn_master.cjs")

const OUT = path.join(ROOT, "assets", "ranking_event.json")

;(async () => {
    const eventTable = await readTable("master/quest/event/ranking_event.orderedmap", false)
    const questTable = await readTable("master/quest/event/ranking_event_single_quest.orderedmap", true)
    const rewardTable = await readTable("master/quest/event/ranking_event_ranking_reward.orderedmap", true)

    const events = {}
    for (const [id, line] of Object.entries(eventTable)) {
        const c = parseCsvLine(line)
        const questIds = Object.values(questTable[id] ?? {}).map(row => int(parseCsvLine(row)[0]))
        if (questIds.length !== 1 || questIds[0] === null) throw new Error(`Ranking event ${id} should have exactly one quest.`)

        const tiers = Object.entries(rewardTable[id] ?? {})
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([, row]) => {
                const r = parseCsvLine(row)
                const border = Number(r[1])
                if (!(border > 0 && border <= 1)) throw new Error(`Ranking event ${id} tier ${r[0]} has a bad border ${r[1]}.`)
                const rewards = []
                for (let i = 3; i + 2 < r.length && rewards.length < 10; i += 3) {
                    const kind = int(r[i])
                    if (kind === null) continue
                    const slot = { kind, amount: int(r[i + 2]) ?? 0 }
                    const itemId = int(r[i + 1])
                    if (itemId !== null) slot.id = itemId
                    rewards.push(slot)
                }
                return { id: int(r[0]), border, rewards }
            })
        if (tiers.length === 0) throw new Error(`Ranking event ${id} has no reward tiers.`)
        for (let i = 1; i < tiers.length; i++) if (tiers[i].border <= tiers[i - 1].border) throw new Error(`Ranking event ${id}: tier borders aren't increasing.`)
        if (tiers[tiers.length - 1].border !== 1) throw new Error(`Ranking event ${id}: the last tier should cover everyone.`)

        events[id] = { code: c[0], name: str(c[2]), questId: questIds[0], tiers }
    }

    fs.writeFileSync(OUT, JSON.stringify({ events }, null, 2) + "\n")
    console.log(`Wrote ${Object.keys(events).length} ranking events to ${path.relative(ROOT, OUT)}.`)
})().catch(e => { console.error(e); process.exit(1) })
