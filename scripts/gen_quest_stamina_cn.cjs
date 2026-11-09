// Builds assets/quest_stamina_cn.json: each quest's battle stamina cost from the CN game's own quest tables, for
// the CN app (real stamina, src/nya/stamina.ts): CN-only events' quests aren't in global's assets/quest_stamina.json.
//
//   node --env-file=.env scripts/gen_quest_stamina_cn.cjs
//
// Columns are the Chinese fork's (src/content/converters/quest.ts, "battle_stamina_cost"), checked 2026-11-08
// against global's costs on the quests both games have: all agree except 5 advent quests CN priced differently.
// Character episodes (category 3) cost nothing in either game.

const path = require("path")
const fs = require("fs")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")

const OUT = path.join(__dirname, "..", "assets", "quest_stamina_cn.json")

// table: [stamina column, QuestCategory numbers it serves]
const TABLES = {
    "master/quest/main_quest.orderedmap": [69, [1]],
    "master/quest/boss_battle_quest.orderedmap": [69, [2]],
    "master/quest/ex_quest.orderedmap": [69, [4]],
    "master/quest/event/daily_week_event_quest.orderedmap": [64, [6]],
    "master/quest/event/advent_event_quest.orderedmap": [75, [7, 8]],
    "master/quest/event/story_event_single_quest.orderedmap": [71, [10]],
    "master/quest/event/ranking_event_single_quest.orderedmap": [66, [11]],
    "master/quest/event/challenge_dungeon_event_quest.orderedmap": [70, [13]],
    "master/quest/event/daily_exp_mana_event_quest.orderedmap": [65, [14]],
    "master/quest/event/world_story_event_quest.orderedmap": [70, [18]],
    "master/quest/event/world_story_event_boss_battle_quest.orderedmap": [69, [19]],
    "master/quest/event/tower_dungeon_event_quest.orderedmap": [68, [20]],
    "master/quest/event/expert_single_event_quest.orderedmap": [72, [21]],
    "master/quest/event/carnival_event_quest.orderedmap": [67, [22]],
    "master/quest/event/raid_event_quest.orderedmap": [68, [23]],
    "master/quest/event/rush_event_quest.orderedmap": [67, [24]],
    "master/quest/event/solo_time_attack_event_quest.orderedmap": [70, [25]],
    "master/quest/event/hard_multi_event_quest.orderedmap": [70, [26]],
    "master/quest/event/score_attack_event_quest.orderedmap": [71, [27]],
}

;(async () => {
    const out = {}
    for (const [table, [column, categories]] of Object.entries(TABLES)) {
        const rows = await readCnTable(table)
        if (!rows) throw new Error(`${table} isn't in the CN game files`)
        const costs = {}
        for (const text of Object.values(rows)) {
            const fields = R.splitCsv(text.split("\n")[0])
            const questId = Number(fields[0]), stamina = Number(fields[column])
            if (!Number.isSafeInteger(questId) || !Number.isSafeInteger(stamina) || stamina <= 0) continue
            if (stamina > 100) throw new Error(`${table} quest ${questId}: stamina ${stamina} looks like the wrong column.`)
            costs[questId] = stamina
        }
        for (const category of categories) out[category] = costs
        console.log(`${table}: ${Object.keys(costs).length} quests`)
    }
    fs.writeFileSync(OUT, JSON.stringify({
        _note: "Battle stamina cost per QuestCategory and quest id, from the CN game's quest tables (scripts/gen_quest_stamina_cn.cjs). Used for real stamina on the CN app.",
        ...out,
    }))
    console.log(`Wrote ${OUT}`)
})().catch(error => {
    console.error(error)
    process.exit(1)
})
