// Builds assets/practice_quest_cn.json: the CN client's practice battles (training dummies, master/quest/
// practice/practice_quest, quest category 15), as reward-free battle quests so single_battle_quest/start
// and finish accept them (src/lib/assets.ts getQuestFromCategorySync).
//
//   node scripts/gen_cn_practice_quests.cjs
const fs = require("fs")
const path = require("path")
const { readCnTable } = require("F:/WF client/tools/cn_read.cjs")

;(async () => {
    const rows = await readCnTable("master/quest/practice/practice_quest.orderedmap")
    const out = {}
    for (const key of Object.keys(rows)) {
        const id = key.split("/")[0]
        // no rewards; the rank times only decide the rank shown on the result screen
        out[id] = { name: "", bRankTime: 600000, aRankTime: 300000, sRankTime: 180000, sPlusRankTime: 120000, rankPointReward: 0, characterExpReward: 0, manaReward: 0, poolExpReward: 0 }
    }
    const file = path.join(__dirname, "..", "assets", "practice_quest_cn.json")
    fs.writeFileSync(file, JSON.stringify(out))
    console.log(`${Object.keys(out).length} practice quests -> ${file}`)
})()
