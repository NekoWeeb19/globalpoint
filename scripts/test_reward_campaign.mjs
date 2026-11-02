// Tests the reward campaign rules (src/lib/rewardCampaign.ts) on the generated global data
// (assets/reward_campaign.json), without a database.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_reward_campaign.mjs

import { readFileSync } from "node:fs"
import { campaignRates, itemDropMultiplier, multipliedDrop } from "../out/lib/rewardCampaign.js"

const data = JSON.parse(readFileSync(new URL("../assets/reward_campaign.json", import.meta.url), "utf8"))
const stamina = JSON.parse(readFileSync(new URL("../assets/stamina_campaign.json", import.meta.url), "utf8"))
const list = data.campaigns
let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const at = s => Date.parse(s + "Z")
const r = (when, category, questId) => { const x = campaignRates(list, at(when), category, questId); return `${x.items}/${x.exp}/${x.mana}` }

// data
check("data: 156 reward campaigns, all one-time, rates 1.5 or 2", list.length === 156 && list.every(c => !c.weekly && (c.rate === 1.5 || c.rate === 2)))
check("data: 369 stamina campaigns, half (239) or quarter (130) stamina", stamina.campaigns.length === 369 && stamina.campaigns.filter(c => c.rate === 0.5).length === 239 && stamina.campaigns.filter(c => c.rate === 0.25).length === 130)

// 2022-10-07 14:00 - 10-14 20:59: items x1.5 in the Kaleidoscope elements (range 3) and Necropolis event 1 quests 2-19
check("Kaleidoscope element quest, 2022-10-08: items x1.5", r("2022-10-08T00:00:00", 6, 1001) === "1.5/1/1", r("2022-10-08T00:00:00", 6, 1001))
check("same quest the day before it starts: x1", r("2022-10-07T13:59:59", 6, 1001) === "1/1/1")
check("first second (start included)", r("2022-10-07T14:00:00", 6, 1001) === "1.5/1/1")
check("last second (end included), then gone", r("2022-10-14T20:59:59", 6, 1001) === "1.5/1/1" && r("2022-10-14T21:00:00", 6, 1001) === "1/1/1")
check("Necropolis event 1 quest 2: x1.5", r("2022-10-08T00:00:00", 13, 1002) === "1.5/1/1")
check("Necropolis event 1 quest 1 (not in the list): x1", r("2022-10-08T00:00:00", 13, 1001) === "1/1/1")
check("a boss battle at that time: x1", r("2022-10-08T00:00:00", 2, 1019002) === "1/1/1")
// 2023-04-09 - 04-27: items x2 (range 3) plus EXP x2 and mana x2 in the Kaleidoscope EXP & Mana (range 4)
check("Kaleidoscope EXP & Mana, 2023-04-10: EXP x2, mana x2", r("2023-04-10T00:00:00", 14, 1001) === "1/2/2", r("2023-04-10T00:00:00", 14, 1001))
check("Kaleidoscope element, 2023-04-10: items x2", r("2023-04-10T00:00:00", 6, 1001) === "2/1/1")
// 2023-07-25 - 08-13 has a main story campaign (range 0, every main quest)
check("main story quest, 2023-08-01: items x2", r("2023-08-01T00:00:00", 1, 1001002) === "2/1/1", r("2023-08-01T00:00:00", 1, 1001002))

// multipliers
check("boost alone doubles (1 + 1)", itemDropMultiplier(1, true) === 2)
check("x1.5 campaign + boost is 2.5x", itemDropMultiplier(1.5, true) === 2.5)
check("x2 campaign + boost is 3x", itemDropMultiplier(2, true) === 3)
check("60 boosted is 120 (as seen in game)", multipliedDrop(60, itemDropMultiplier(1, true)) === 120)
check("x1.5 rounds down: 5 -> 7", multipliedDrop(5, 1.5) === 7)
check("no campaign, no boost: unchanged", multipliedDrop(60, itemDropMultiplier(1, false)) === 60)

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
