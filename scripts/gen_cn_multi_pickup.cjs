// CN's "Multi Boss Pick-up" promos (多人领主特选, the co-op boss events): while one runs, co-op clears of the day's
// featured boss pay boss coins, EXP and mana times the promo's rate (the game's own text,
// boss_battle_multi_pickup_description_message). The CN client shows the schedule and the rate from its own tables;
// the server applies the rate (src/lib/multiPickup.ts).
//
// Tables (on CN's calendar, scripts/cn_calendar.cjs, like the client's copy):
// - master/quest/boss_battle/boss_battle_multi_pickup_event: string_id, top background, rich text, reward_increase_rate,
//   flash frame, mission link, start, end
// - master/quest/boss_battle/boss_battle_multi_pickup_event_schedule (key "event/n"): chapter, stage node, background,
//   additional score reward (always (None) in CN's data), -, flash frame, pickup start, pickup end
// Dates: CN's master dates are China time (UTC+8); written here in UTC, like the other assets.
//
//   node --env-file=.env scripts/gen_cn_multi_pickup.cjs   -> assets/cn_multi_pickup.json
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")

const OUT = path.join(__dirname, "..", "assets", "cn_multi_pickup.json")
const toUtc = text => new Date(Date.parse(text.replace(" ", "T") + "+08:00")).toISOString().replace("T", " ").slice(0, 19)
const rows = async table => Object.entries(await readCnTable(table)).map(([k, v]) => [k, R.splitCsv(String(v).replace(/\n$/, ""))])

;(async () => {
    const events = {}
    for (const [id, c] of await rows("master/quest/boss_battle/boss_battle_multi_pickup_event.orderedmap")) {
        events[id] = { name: c[0], rate: Number(c[3]), start: toUtc(c[6]), end: toUtc(c[7]) }
    }
    const schedule = []
    for (const [key, c] of await rows("master/quest/boss_battle/boss_battle_multi_pickup_event_schedule.orderedmap")) {
        const event = key.split("/")[0]
        if (!events[event]) throw new Error(`schedule ${key}: no event ${event}`)
        schedule.push({ event: Number(event), chapter: Number(c[0]), node: Number(c[1]), start: toUtc(c[6]), end: toUtc(c[7]) })
    }
    schedule.sort((a, b) => a.start.localeCompare(b.start) || a.event - b.event)
    fs.writeFileSync(OUT, JSON.stringify({
        _note: "Built by scripts/gen_cn_multi_pickup.cjs: CN's Multi Boss Pick-up promos (co-op boss coins, EXP and mana x rate on the day's featured boss). Dates in UTC.",
        events, schedule,
    }, null, 1) + "\n")
    console.log(`${Object.keys(events).length} promos, ${schedule.length} featured days -> ${path.relative(process.cwd(), OUT)}`)
})()
