// Tests the Hard Multi data and its "Daily Reward Count" bonus (src/lib/periodicReward.ts), without a database.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_hard_multi.mjs

import { readFileSync } from "node:fs"
import { pickPeriodicDrop, questPointId, refillPeriodicPoints } from "../out/lib/periodicReward.js"
import { getQuestFromCategorySync } from "../out/lib/assets.js"

const data = JSON.parse(readFileSync(new URL("../assets/periodic_reward.json", import.meta.url), "utf8"))
let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const HARD_MULTI = 26

// quests
const fire = getQuestFromCategorySync(HARD_MULTI, 1001)
check("quest 1001 (fire Steambot) is a battle quest: 2790 mana, score group 800001, 30-bead clear reward",
    fire !== null && fire.manaReward === 2790 && fire.scoreRewardGroupId === 800001 && fire.scoreRewardGroup.length > 0 && fire.clearReward?.count === 30, fire)
check("all 4 Hard Multi quests load", [1001, 2001, 3001, 100000001].every(id => getQuestFromCategorySync(HARD_MULTI, id)?.rankPointReward === 1590))
check("rank times are milliseconds (S+ 360 s)", fire.sPlusRankTime === 360000 && fire.bRankTime === 738000)
check("an unknown Hard Multi quest -> null", getQuestFromCategorySync(HARD_MULTI, 9999) === null)

// points
check("quest -> point: 1001 -> 1, 100000001 -> 10000000", questPointId(data, 1001) === 1 && questPointId(data, 100000001) === 10000000 && questPointId(data, 42) === null)
const first = refillPeriodicPoints(data, [], null, 100)
check("first load: every point kind at 2", JSON.stringify(first) === JSON.stringify([{ id: 1, point: 2 }, { id: 2, point: 2 }, { id: 3, point: 2 }, { id: 10000000, point: 2 }]), first)
const saved = [{ id: 2, point: 2 }, { id: 3, point: 0 }, { id: 10000000, point: 98 }]
check("same day: nothing added, the missing kind (1) starts at 2", JSON.stringify(refillPeriodicPoints(data, saved, 100, 100)) === JSON.stringify([{ id: 1, point: 2 }, { id: 2, point: 2 }, { id: 3, point: 0 }, { id: 10000000, point: 98 }]))
check("next day: +2 each, capped at 99", JSON.stringify(refillPeriodicPoints(data, saved, 100, 101)) === JSON.stringify([{ id: 1, point: 2 }, { id: 2, point: 4 }, { id: 3, point: 2 }, { id: 10000000, point: 99 }]))
check("several days later: still +2 once (as in the Chinese fork)", refillPeriodicPoints(data, saved, 100, 110).find(p => p.id === 2).point === 4)
check("a clock turned back adds nothing", refillPeriodicPoints(data, saved, 100, 99).find(p => p.id === 2).point === 2)
check("points above the max aren't lowered", refillPeriodicPoints(data, [{ id: 2, point: 150 }], 100, 101).find(p => p.id === 2).point === 150)

// bonus drop
const drop = pickPeriodicDrop(data, 1001, () => 0.5)
check("fire bonus: 9x item 40402 (group 1, index 1)", drop !== null && drop.itemId === 40402 && JSON.stringify(drop.drop) === JSON.stringify({ group_id: 1, index: 1, number: 9 }), drop)
check("probability 1 always passes", pickPeriodicDrop(data, 2001, () => 0.999999)?.itemId === 40401)
check("a quest without a group: nothing", pickPeriodicDrop(data, 42, () => 0) === null)

console.log(failures === 0 ? "\nAll Hard Multi tests passed." : `\n${failures} Hard Multi test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
