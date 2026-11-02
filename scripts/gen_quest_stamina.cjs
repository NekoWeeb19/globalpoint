// Builds assets/quest_stamina.json: each quest's battle stamina cost, for the "Use up a total of N
// stamina" missions (mission kind 36). The server doesn't charge battle stamina itself, so this is
// what a cleared battle counts.
//
//   node scripts/gen_quest_stamina.cjs
//
// Columns are the global client's quest tables. The Chinese fork's layouts (src/content/converters/
// quest.ts, "battle_stamina_cost") match global for most tables; advent (CN 75), raid (CN 68) and
// score attack (CN 71) sit earlier on global, like their other shifted columns. Each column was checked
// by its values (small stamina costs next to the score reward group id).

const path = require("path")
const fs = require("fs")
const { ROOT, readRows, parseCsvLine, int } = require("./cdn_master.cjs")

const OUT = path.join(ROOT, "assets", "quest_stamina.json")

// table: [nesting depth, stamina column, QuestCategory numbers it serves]
const TABLES = {
    "master/quest/main_quest.orderedmap": [3, 69, [1]],
    "master/quest/boss_battle_quest.orderedmap": [3, 69, [2]],
    "master/quest/ex_quest.orderedmap": [3, 69, [4]],
    "master/quest/event/daily_week_event_quest.orderedmap": [2, 64, [6]],
    "master/quest/event/advent_event_quest.orderedmap": [2, 73, [7, 8]],
    "master/quest/event/story_event_single_quest.orderedmap": [2, 71, [10]],
    "master/quest/event/ranking_event_single_quest.orderedmap": [2, 66, [11]],
    "master/quest/event/challenge_dungeon_event_quest.orderedmap": [2, 70, [13]],
    "master/quest/event/daily_exp_mana_event_quest.orderedmap": [2, 65, [14]],
    "master/quest/event/world_story_event_quest.orderedmap": [2, 70, [18]],
    "master/quest/event/world_story_event_boss_battle_quest.orderedmap": [2, 69, [19]],
    "master/quest/event/tower_dungeon_event_quest.orderedmap": [2, 68, [20]],
    "master/quest/event/expert_single_event_quest.orderedmap": [2, 72, [21]],
    "master/quest/event/carnival_event_quest.orderedmap": [2, 67, [22]],
    "master/quest/event/raid_event_quest.orderedmap": [2, 67, [23]],
    "master/quest/event/rush_event_quest.orderedmap": [2, 67, [24]],
    "master/quest/event/solo_time_attack_event_quest.orderedmap": [2, 70, [25]],
    "master/quest/event/hard_multi_event_quest.orderedmap": [2, 70, [26]],
    "master/quest/event/score_attack_event_quest.orderedmap": [2, 70, [27]],
}

;(async () => {
    const out = {}
    for (const [table, [depth, column, categories]] of Object.entries(TABLES)) {
        const costs = {}
        for (const row of await readRows(table, depth)) {
            const fields = parseCsvLine(row.text)
            const questId = int(fields[0]), stamina = int(fields[column])
            if (questId === null || stamina === null || stamina <= 0) continue
            if (stamina > 100) throw new Error(`${table} quest ${questId}: stamina ${stamina} looks like the wrong column.`)
            costs[questId] = stamina
        }
        for (const category of categories) out[category] = costs
        console.log(`${table}: ${Object.keys(costs).length} quests`)
    }
    fs.writeFileSync(OUT, JSON.stringify({
        _note: "Battle stamina cost per QuestCategory and quest id, from the global client's quest tables (scripts/gen_quest_stamina.cjs). Used for the \"Use up N stamina\" missions.",
        ...out,
    }))
    console.log(`Wrote ${OUT}`)
})().catch(error => {
    console.error(error)
    process.exit(1)
})
