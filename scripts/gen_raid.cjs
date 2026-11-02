// Builds assets/raid_event.json (Raid Event: Sagas of Conquest) from the global client's own master
// tables (see scripts/cdn_master.cjs).
//
//   node scripts/gen_raid.cjs
//
// Columns (global client; the Chinese fork reads the same fields, some one column later):
//   raid_event: 17 required kill count (weight per boss kill, for the whole server), 24/25/26 open,
//               battles until, rewards until.
//   raid_event_quest (nested by event): 0 quest id, 51 kill weight a clear adds.
//   raid_event_overall_reward: 0 event, 1 text, 2 type (0 at a total kill count, 1 every N kills),
//               3 threshold (or first count), 4 interval, from 6 up to 10 slots of (kind, item, amount)
//               with kind 0 item, 2 beads, 3 mana.

const path = require("path")
const fs = require("fs")
const { ROOT, readTable, parseCsvLine, str, int } = require("./cdn_master.cjs")

const OUT = path.join(ROOT, "assets", "raid_event.json")

;(async () => {
    const eventTable = await readTable("master/quest/event/raid_event.orderedmap", false)
    const events = {}
    for (const [id, line] of Object.entries(eventTable)) {
        const c = parseCsvLine(line)
        const requiredKillCount = int(c[17])
        if (requiredKillCount === null || requiredKillCount <= 0) throw new Error(`Raid event ${id} has no required kill count.`)
        events[id] = { code: c[0], requiredKillCount, start: str(c[24]), battleEnd: str(c[25]), end: str(c[26]) }
    }

    const questTable = await readTable("master/quest/event/raid_event_quest.orderedmap", true)
    const quests = {}
    for (const [eventId, rows] of Object.entries(questTable)) {
        for (const line of Object.values(rows)) {
            const c = parseCsvLine(line)
            const questId = int(c[0]), killWeight = int(c[51])
            if (questId === null || killWeight === null || killWeight <= 0) throw new Error(`Raid quest ${eventId}/${c[0]} has no kill weight.`)
            quests[questId] = { eventId: Number(eventId), killWeight }
        }
    }

    const rewardTable = await readTable("master/quest/event/raid_event_overall_reward.orderedmap", false)
    const rewards = {}
    for (const [id, line] of Object.entries(rewardTable)) {
        const c = parseCsvLine(line)
        const type = int(c[2])
        const slots = []
        for (let i = 6; i + 2 < c.length && slots.length < 10; i += 3) {
            const kind = int(c[i])
            if (kind === null) continue
            const itemId = int(c[i + 1]), amount = int(c[i + 2])
            if (amount === null || amount <= 0) throw new Error(`Raid reward ${id} has a slot without an amount.`)
            if (kind === 0 && itemId === null) throw new Error(`Raid reward ${id} has an item without an id.`)
            if (![0, 2, 3].includes(kind)) throw new Error(`Raid reward ${id} has an unknown kind ${kind}.`)
            slots.push(kind === 0 ? { kind, itemId, amount } : { kind, amount })
        }
        if (slots.length === 0) throw new Error(`Raid reward ${id} has no rewards.`)
        const requirement = type === 0
            ? { type: "total", threshold: int(c[3]) }
            : { type: "each", ...(int(c[3]) === null ? {} : { start: int(c[3]) }), interval: int(c[4]) }
        if (type !== 0 && type !== 1) throw new Error(`Raid reward ${id} has an unknown type ${c[2]}.`)
        rewards[id] = { eventId: int(c[0]), requirement, rewards: slots }
    }

    const data = {
        _note: "Raid Event: Sagas of Conquest, from the global client's master tables (built by scripts/gen_raid.cjs). "
            + "Each cleared raid stage adds its killWeight to the boss; reaching the event's required kill count is one "
            + "boss kill (the HP refills). requiredKillCount is the global, whole-server value; this single-player server "
            + "uses the hardest stage's weight times RAID_SOLO_CLEARS_PER_KILL instead (src/lib/raid.ts). Rewards are paid "
            + "as the total boss kills pass their thresholds. Reward kinds: 0 item, 2 beads, 3 mana.",
        events,
        quests,
        rewards,
    }
    fs.writeFileSync(OUT, JSON.stringify(data, null, 1))
    console.log(`Wrote ${OUT}: ${Object.keys(events).length} raids, ${Object.keys(quests).length} stages, ${Object.keys(rewards).length} rewards`)
})().catch(error => {
    console.error(error)
    process.exit(1)
})
