// The Haunt's floors for the CN client, from CN's own table (master/quest/event/tower_dungeon_event_quest):
// global's table (assets/tower_dungeon_event_quest.json, from converter.py) has different reward groups for
// 220 of the 480 floors (sets 8 and 28-48), so a CN clear paid another month's rewards. The rewards in the groups
// themselves are the same in both (score_reward / rare_score_reward). Columns: 69 reward group, 82 rank points,
// 83 character EXP, 84 mana, 85 pooled EXP. A floor's quest id is 1000 + its key (its first column says the same).
// The copied months (src/lib/towerRotation.ts) use these through the floor they copy.
//
//   node scripts/gen_cn_tower_quests.cjs   -> assets/tower_dungeon_event_quest_cn.json
const fs = require("fs")
const path = require("path")
const { readCnTable } = require("./cn_read.cjs")
const { splitCsv } = require("./cdn_rows.cjs")

const OUT = path.join(__dirname, "..", "assets", "tower_dungeon_event_quest_cn.json")

;(async () => {
    const table = await readCnTable("master/quest/event/tower_dungeon_event_quest.orderedmap")
    if (!table) throw new Error("CN's tower_dungeon_event_quest table wasn't found (CN_CDN_DIR).")
    const global = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets", "tower_dungeon_event_quest.json"), "utf8"))
    const out = {}
    let changed = 0
    for (const [key, text] of Object.entries(table)) {
        const c = splitCsv(text.replace(/\n$/, "").split("\n")[0])
        const id = 1000 + Number(key.split("/").pop())
        if (Number(c[0]) !== id) throw new Error(`row ${key}: quest id ${c[0]}, expected ${id}`)
        const quest = {
            ...(global[String(id)] ?? { name: "", bRankTime: 0, aRankTime: 0, sRankTime: 0, sPlusRankTime: 0 }),
            scoreRewardGroup: Number(c[69]),
            rankPointReward: Number(c[82]),
            characterExpReward: Number(c[83]),
            manaReward: Number(c[84]),
            poolExpReward: Number(c[85]),
        }
        if (JSON.stringify(quest) !== JSON.stringify(global[String(id)])) changed++
        out[String(id)] = quest
    }
    fs.writeFileSync(OUT, JSON.stringify(out, null, 4))
    console.log(`Wrote ${OUT}: ${Object.keys(out).length} floors, ${changed} differ from global's`)
})().catch(e => { console.error(e.message); process.exit(1) })
