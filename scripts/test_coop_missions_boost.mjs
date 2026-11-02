// Tests the Boss Boost rules (src/lib/bossBoost.ts) and how co-op clears count for missions
// (battleMissionEvents and counterMatches in src/lib/mission.ts), without a database.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_coop_missions_boost.mjs

import { BOSS_BOOST_MAX, refillBossBoost, spendBoostPoint } from "../out/lib/bossBoost.js"
import { battleMissionEvents, counterMatches, countedDefinition, dayNumber } from "../out/lib/mission.js"

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

// ---- Boss Boost ----
check("boost: max is 3", BOSS_BOOST_MAX === 3)
check("boost: never refilled -> 3", JSON.stringify(refillBossBoost(0, null, 100)) === JSON.stringify({ points: 3, changed: true }))
check("boost: same day -> unchanged", JSON.stringify(refillBossBoost(1, 100, 100)) === JSON.stringify({ points: 1, changed: false }))
check("boost: next day -> 3", JSON.stringify(refillBossBoost(0, 100, 101)) === JSON.stringify({ points: 3, changed: true }))
check("boost: a higher count isn't lowered", refillBossBoost(5, 100, 101).points === 5)
const reset = Date.parse("2026-10-30T05:00:00Z")
check("boost: the day turns at 05:00 UTC", dayNumber(reset - 1) + 1 === dayNumber(reset))
check("spend: 2 used -> 1, boosted", JSON.stringify(spendBoostPoint(2, true)) === JSON.stringify({ points: 1, used: true }))
check("spend: 0 used -> stays 0, no boost (used to go to -1)", JSON.stringify(spendBoostPoint(0, true)) === JSON.stringify({ points: 0, used: false }))
check("spend: not asked -> nothing spent", JSON.stringify(spendBoostPoint(2, false)) === JSON.stringify({ points: 2, used: false }))
check("spend: a negative count is fixed to 0", spendBoostPoint(-1, true).points === 0)

// ---- co-op mission events ----
const battle = { accomplished: true, questCategory: 2, questId: 1019002, clearRank: 3, score: 100, questMana: 10, fieldMana: 0, statistics: {} }
const solo = battleMissionEvents({ ...battle, isMulti: false })
const coop = battleMissionEvents({ ...battle, isMulti: true, isHost: true, guestStandIn: true })
const kinds = events => events.filter(e => [12, 14, 15, 16].includes(e.kind)).map(e => `${e.kind}${e.isMulti ? "m" : "s"}`).join(" ")
check("events: solo clear is 12 (solo) only", kinds(solo) === "12s", kinds(solo))
check("events: co-op clear is 12, 14, 15 and 16, all multiplayer", kinds(coop) === "12m 14m 15m 16m", kinds(coop))

const def = (kind, p2 = null, extra = {}) => {
    const params = Array(10).fill(null)
    params[2] = p2
    for (const [i, v] of Object.entries(extra)) params[i] = v
    return { kind, params }
}
const counts = (definition, events) => events.some(e => counterMatches(definition, e))
check("match: 'Clear N multiplayer battles' (14) counts co-op", counts(def(14), coop))
check("match: 'Clear N multiplayer battles' (14) doesn't count solo", !counts(def(14), solo))
check("match: 'Host N multiplayer battles' (15) counts co-op", counts(def(15), coop))
check("match: 'Join N battles as a guest' (16) counts co-op (stand-in)", counts(def(16), coop))
check("match: 'Clear N battles' solo-only (12, blank) doesn't count co-op", !counts(def(12), coop))
check("match: 'Clear N battles' solo-only (12, blank) counts solo", counts(def(12), solo))
check("match: 'Clear N battles, solo or multi' (12, mode 3) counts co-op", counts(def(12, "3"), coop))
// boss battles are category 2 here; the range filter picks Nether Fox (node 19) for "Clear Nether Fox (Multiplayer)"
const campaign = countedDefinition(4, def(14))
check("match: campaign multiplayer mission (stand-in 12 mode 3) counts co-op and solo", counts(campaign, coop) && counts(campaign, solo))
check("match: a lost co-op battle counts nothing", battleMissionEvents({ ...battle, accomplished: false, isMulti: true, isHost: true }).length === 0)

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
