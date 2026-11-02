// Tests the raid logic (src/lib/raid.ts) without a database.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_raid.mjs

import { readFileSync } from "node:fs"
import { advanceRaidBoss, raidBossHpPercentage, raidRewardListEntry, selectRaidRewards, soloRequiredKillCount } from "../out/lib/raid.js"

const data = JSON.parse(readFileSync(new URL("../assets/raid_event.json", import.meta.url), "utf8"))
const serverQuests = JSON.parse(readFileSync(new URL("../assets/raid_event_quest.json", import.meta.url), "utf8"))
let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

// data
check("data: every raid stage on the server has a kill weight", Object.keys(serverQuests).every(id => data.quests[id]?.killWeight > 0))
check("data: raid 2's stages weigh 1, 5, 28 and 190", JSON.stringify([2001, 2002, 2003, 2004].map(id => data.quests[id].killWeight)) === "[1,5,28,190]")
check("data: raid 2 needs 100,000,000 on the live server", data.events["2"].requiredKillCount === 100000000)

// solo rule
check("solo: one hardest clear kills raid 2's boss (190)", soloRequiredKillCount(data, 2, 1) === 190)
check("solo: RAID_SOLO_CLEARS_PER_KILL=5 makes it 950", soloRequiredKillCount(data, 2, 5) === 950)
check("solo: a bad setting falls back to 1", soloRequiredKillCount(data, 2, -3) === 190 && soloRequiredKillCount(data, 2, NaN) === 190)
check("solo: an unknown raid has none", soloRequiredKillCount(data, 99, 1) === null)

// boss
let state = { weightedKillCount: 0, totalKillCount: 0 }
state = advanceRaidBoss(state, 1, 190)
check("boss: an easy clear takes 1/190 (HP 99.5%)", state.totalKillCount === 0 && raidBossHpPercentage(state, 190) === 99.5, state)
state = advanceRaidBoss(state, 190, 190)
check("boss: a hardest clear on top kills it once and carries 1 over", state.totalKillCount === 1 && state.weightedKillCount === 1, state)
check("boss: a big weight can kill it more than once", advanceRaidBoss({ weightedKillCount: 0, totalKillCount: 0 }, 400, 190).totalKillCount === 2)
check("boss: full HP is 100%", raidBossHpPercentage({ weightedKillCount: 0, totalKillCount: 3 }, 190) === 100)

// rewards
const first = selectRaidRewards(data, 2, 0, 1)
check("rewards: the first kill pays raid 2's first tier (5 medals + 500 beads)", first.length === 2 && first.some(g => g.kind === 0 && g.itemId === 49100 && g.amount === 5) && first.some(g => g.kind === 2 && g.amount === 500), first)
const all = selectRaidRewards(data, 2, 0, 10)
check("rewards: 10 kills pays every raid 2 tier", new Set(all.map(g => g.rewardId)).size === Object.values(data.rewards).filter(r => r.eventId === 2).length, all.length)
check("rewards: nothing twice (5 -> 10 doesn't repeat 1..5)", selectRaidRewards(data, 2, 5, 10).every(g => data.rewards[g.rewardId].requirement.threshold > 5))
check("rewards: no new kills, no rewards", selectRaidRewards(data, 2, 3, 3).length === 0)
const repeating = Object.entries(data.rewards).find(([_, r]) => r.requirement.type === "each")
if (repeating) {
    const [rid, r] = repeating
    const gotten = selectRaidRewards(data, r.eventId, 0, 1000).filter(g => g.rewardId === Number(rid))
    check(`rewards: a repeating reward (${rid}) is paid once per interval`, gotten.length > 0, gotten.length)
}
check("reward list: item 1, beads 3, mana 8", JSON.stringify([raidRewardListEntry({ kind: 0, itemId: 49100, amount: 5 }), raidRewardListEntry({ kind: 2, amount: 500 }), raidRewardListEntry({ kind: 3, amount: 9 })]) === JSON.stringify([{ kind: 1, kind_id: 49100, number: 5 }, { kind: 3, kind_id: 0, number: 500 }, { kind: 8, kind_id: 0, number: 9 }]))

console.log(failures === 0 ? "\nAll raid tests passed." : `\n${failures} raid test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
