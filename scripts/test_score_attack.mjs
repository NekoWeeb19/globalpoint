// Tests the Score Attack rules (src/lib/scoreAttack.ts) against the global data, without a database.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_score_attack.mjs

import { readFileSync } from "node:fs"
import { borderRewardItems, historyRecord, mainCharacterIds, newlyPassedBorders, scoreAttackCleared, scoreAttackGrade } from "../out/lib/scoreAttack.js"
import { getQuestFromCategorySync } from "../out/lib/assets.js"

const data = JSON.parse(readFileSync(new URL("../assets/score_attack.json", import.meta.url), "utf8"))
let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const q = data.quests["1001"], borders = data.borders["1001"]

// data
check("data: 30 quests (1001..1030, event 1), 60 borders each", Object.keys(data.quests).length === 30 && Object.values(data.borders).every(t => t.length === 60) && q.eventId === 1 && q.localId === 1)
check("quest 1001 grades: B 150M, A 340M, S 530M, SS 1171M", JSON.stringify(q.scores) === JSON.stringify([150000000, 340000000, 530000000, 1171000000]))
const quest = getQuestFromCategorySync(27, 1001)
check("quest 1001 now has its battle rewards (10 rank points, 15 mana)", quest?.rankPointReward === 10 && quest.manaReward === 15 && quest.characterExpReward === 15 && quest.poolExpReward === 15, quest)

// grades
check("grades: below B 1, B 2, A 3, S 4, SS 5", [100, 150000000, 340000000, 530000000, 1171000000, 2e9].map(s => scoreAttackGrade(q.scores, s)).join() === "1,2,3,4,5,5")
check("cleared from the first border (1.5M)", !scoreAttackCleared(borders, 1499999) && scoreAttackCleared(borders, 1500000))

// borders
const first = newlyPassedBorders(borders, 0, 20000000)
check("first battle at 20M: borders 1001 and 1002 -> 2x 40501", JSON.stringify(first.map(b => b.id)) === "[1001,1002]" && JSON.stringify([...borderRewardItems(first)]) === JSON.stringify([[40501, 2]]))
check("a lower score than the best pays nothing", newlyPassedBorders(borders, 20000000, 19000000).length === 0)
check("beating the best pays only the new borders", JSON.stringify(newlyPassedBorders(borders, 20000000, 40000000).map(b => b.id)) === "[1003]")
const all = newlyPassedBorders(borders, 0, 1e12)
check(`every border at once: 60 borders, items ${JSON.stringify([...borderRewardItems(all)])}`, all.length === 60)

// reply pieces
check("main_character_ids: slot -> leader", JSON.stringify(mainCharacterIds({ characters: [{ id: 111001 }, null, { id: 2 }] })) === JSON.stringify({ 0: 111001, 2: 2 }))
const rec = historyRecord({
    categoryId: 27, questId: 1001, createTime: "2024-06-02 12:00:00", elapsedTimeMs: 180000, score: 2e8, clearRank: 2,
    party: { characters: [{ id: 111001 }, null, null], unison_characters: [{ id: 5 }, null, null], equipments: [{ id: 4010010 }, null, null], ability_soul_ids: [7, null, null] },
    zones: [{ damage_deal_total: 1000, members: [{ origin_damage: 600 }, null, null] }, { damage_deal_total: 500, members: [{ origin_damage: 400 }] }],
    equipment: id => id === 4010010 ? { level: 5, enhancementLevel: 2 } : null,
})
check("history entry: client fields, damage summed per unit and in total", rec.total_damage === 1500 && rec.character_1_total_damage === 1000 && rec.character_2_total_damage === null && rec.character_id_1 === 111001 && rec.unison_character_id_1 === 5 && rec.equipment_level_1 === 5 && rec.enhancement_level_1 === 2 && rec.ability_soul_id_1 === 7 && rec.finish_kind === 0 && rec.category_id === 27, rec)
const client = ["ability_soul_id_1", "category_id", "character_1_total_damage", "character_id_1", "clear_rank", "create_time", "elapsed_time_ms", "enhancement_level_1", "equipment1_id", "equipment_level_1", "finish_kind", "quest_id", "score", "total_damage", "unison_character_id_1"]
check("history entry has every field the client reads", client.every(k => k in rec))

console.log(failures === 0 ? "\nAll Score Attack tests passed." : `\n${failures} Score Attack test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
