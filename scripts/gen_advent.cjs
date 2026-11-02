// Builds assets/advent_event_rules.json (boss event battle rules) from the global client's own master
// table master/quest/event/advent_event_quest (see scripts/cdn_master.cjs).
//
//   node scripts/gen_advent.cjs
//
// Columns (global client; the Chinese fork's docs/systems/boss-epuration-unlock.md describes the same
// fields two columns later, in its own client):
//   0 quest id, 5/6 open from/until, 52 battle (1), 53 who can play (0 solo only, 1 solo or
//   multiplayer, 2 multiplayer only), 59/60/61 entry ticket (1 = spent on every attempt, item id, count).

const path = require("path")
const fs = require("fs")
const { ROOT, readTable, parseCsvLine, str, int } = require("./cdn_master.cjs")

const OUT = path.join(ROOT, "assets", "advent_event_rules.json")

;(async () => {
    const table = await readTable("master/quest/event/advent_event_quest.orderedmap", true)
    const quests = {}
    for (const [eventId, rows] of Object.entries(table)) {
        for (const line of Object.values(rows)) {
            const c = parseCsvLine(line)
            if (c[52] !== "1") continue // story stages
            const questId = int(c[0])
            const playMode = int(c[53])
            if (questId === null || playMode === null) throw new Error(`Advent quest ${eventId}/${c[0]} has no play mode.`)
            const quest = { eventId: Number(eventId), playMode, start: str(c[5]), end: str(c[6]) }
            if (c[59] === "1") {
                const itemId = int(c[60]), count = int(c[61])
                if (itemId === null || count === null) throw new Error(`Advent quest ${questId} has a ticket without an item or count.`)
                quest.entryItem = { id: itemId, count }
            }
            quests[questId] = quest
        }
    }
    const data = {
        _note: "Boss event (advent) battles, from the global client's master table (built by scripts/gen_advent.cjs). "
            + "playMode: 0 solo only, 1 solo or multiplayer, 2 multiplayer only. entryItem: the ticket each attempt "
            + "spends. Dates are UTC. Used for The Purge: its multiplayer-only Purgers are cleared as host automatically "
            + "while the event is open, and the solo-only Empress needs a ticket (src/lib/soloAdvent.ts).",
        quests,
    }
    fs.writeFileSync(OUT, JSON.stringify(data, null, 1))
    const count = mode => Object.values(quests).filter(q => q.playMode === mode).length
    console.log(`Wrote ${OUT}: ${Object.keys(quests).length} battles (${count(1)} solo or multi, ${count(2)} multi only, ${count(0)} solo only), ${Object.values(quests).filter(q => q.entryItem).length} with a ticket`)
})().catch(error => {
    console.error(error)
    process.exit(1)
})
