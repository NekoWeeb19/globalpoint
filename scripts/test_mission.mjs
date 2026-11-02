// Tests the Mission screen logic (src/lib/mission.ts) without a database.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_mission.mjs
//
// The main check replays the list recorded from the real global server
// (docs/routes/mission_get_mission_progress.md): with the recorded progress saved and the clock at
// the recorded server time, the same missions must come back with the same progress and stage.

import assert from "node:assert"
import { readFileSync } from "node:fs"
import {
    applyMissionCounters,
    countedDefinition,
    battleMissionEvents,
    buildMissionProgressList,
    counterMatches,
    currentStage,
    dailyPeriodKey,
    dayNumber,
    loginDayKey,
    ownedItemId,
    payMissionRewards,
    questClearCandidates,
    questClearRule,
    raidMissionEvents,
    settleMissionRewards,
    withClearedBaseline,
} from "../out/lib/mission.js"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const data = JSON.parse(read("../assets/missions.json"))

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

const noFacts = { stateValue: () => null }
const factsOf = (values) => ({ stateValue: (kind) => values[kind] ?? null })

/** A saved-mission store backed by a plain object { "category:id": SavedMission }. */
function store(rows = {}) {
    return {
        rows,
        get: (category, id) => rows[`${category}:${id}`] ?? null,
        apply(updates) {
            for (const u of updates) rows[`${u.category}:${u.missionId}`] = { progress: u.progress, rewardedStage: u.rewardedStage, period: u.period }
        },
    }
}

// --- 1. replay the recorded reply -------------------------------------------------------------

const recordedDoc = read("../docs/routes/mission_get_mission_progress.md")
const bodies = [...recordedDoc.matchAll(/### Body\n```\n([\s\S]*?)\n```/g)].map(m => JSON.parse(m[1]))
const recordedRequest = bodies[0]
const recordedReply = bodies[1]
const recordedList = recordedReply.data.mission_progress_list
const recordedTime = recordedReply.data_headers.servertime * 1000
const clock = { serverMs: recordedTime, realMs: recordedTime }

const replay = store()
for (const entry of recordedList) {
    replay.rows[`${entry.mission_category}:${entry.mission_id}`] = {
        progress: entry.progress_value,
        rewardedStage: 0,
        period: entry.mission_category === 2 ? dailyPeriodKey(clock) : null,
    }
}
const categories = recordedRequest.category_list.map(c => c.category)
const built = buildMissionProgressList(data, categories, clock, replay.get, noFacts)

const asKey = (e) => `${e.mission_category}:${e.mission_id}`
const builtByKey = new Map(built.map(e => [asKey(e), e]))
const recordedByKey = new Map(recordedList.map(e => [asKey(e), e]))
const missing = recordedList.filter(e => !builtByKey.has(asKey(e))).map(asKey)
const extra = built.filter(e => !recordedByKey.has(asKey(e))).map(asKey)
check(`replay: every recorded mission is listed (${recordedList.length})`, missing.length === 0, missing)
check("replay: no mission is listed that the global server left out", extra.length === 0, extra)
const different = recordedList.filter(e => {
    const b = builtByKey.get(asKey(e))
    return b && (b.progress_value !== e.progress_value || b.stage !== e.stage)
}).map(e => ({ key: asKey(e), recorded: [e.progress_value, e.stage], built: [builtByKey.get(asKey(e)).progress_value, builtByKey.get(asKey(e)).stage] }))
check("replay: same progress_value and stage for every mission", different.length === 0, different)
const recordedCategoryOrder = [...new Set(recordedList.map(e => e.mission_category))]
const builtCategoryOrder = [...new Set(built.map(e => e.mission_category))]
check("replay: categories come back in the order they were asked for", JSON.stringify(recordedCategoryOrder) === JSON.stringify(builtCategoryOrder), { recordedCategoryOrder, builtCategoryOrder })
check("replay: every entry has exactly the recorded fields", built.every(e => JSON.stringify(Object.keys(e)) === JSON.stringify(Object.keys(recordedList[0]))), Object.keys(built[0] ?? {}))

// --- 2. a new player ---------------------------------------------------------------------------

const fresh = buildMissionProgressList(data, [1], clock, store().get, noFacts)
const freshIds = fresh.map(e => e.mission_id)
check("new player: chapter 1 mission (10) is listed", freshIds.includes(10), freshIds)
check("new player: chapter 2 mission (11) waits for chapter 1", !freshIds.includes(11), freshIds)
check("new player: missions that need 42 cleared (25 to 29) are hidden", [25, 26, 27, 28, 29].every(id => !freshIds.includes(id)), freshIds)
check("new player: expired missions (16 to 21) are hidden", [16, 17, 18, 19, 20, 21].every(id => !freshIds.includes(id)), freshIds)
check("new player: everything starts at progress 0 and stage 1", fresh.every(e => e.progress_value === 0 && e.stage === 1), fresh.filter(e => e.progress_value !== 0 || e.stage !== 1))

// --- 3. stages -----------------------------------------------------------------------------------

const login = data.missions["1"]["24"] // targets 2,3,4,5,10,...
check("stage: 0 progress is stage 1", currentStage(login, 0) === 1)
check("stage: progress 9 of targets 2,3,4,5,10 is stage 5", currentStage(login, 9) === 5)
check("stage: everything cleared stays on the last stage", currentStage(login, 1e9) === login.stages.length)

// --- 4. state facts ------------------------------------------------------------------------------

const withFacts = buildMissionProgressList(data, [1], clock, store().get, factsOf({ 1: 12, 4: 25, 5: 41 }))
const byId = new Map(withFacts.map(e => [e.mission_id, e]))
check("facts: user rank 12 shows on mission 22", byId.get(22)?.progress_value === 12, byId.get(22))
check("facts: 25 characters shows on mission 32", byId.get(32)?.progress_value === 25, byId.get(32))
check("facts: highest level 41 shows on mission 9 (stage 5)", byId.get(9)?.progress_value === 41 && byId.get(9)?.stage === 5, byId.get(9))
const lowerFact = store({ "1:32": { progress: 30, rewardedStage: 0, period: null } })
const kept = buildMissionProgressList(data, [1], clock, lowerFact.get, factsOf({ 4: 10 })).find(e => e.mission_id === 32)
check("facts: a lower value never lowers saved progress", kept?.progress_value === 30, kept)

// --- 5. counters ---------------------------------------------------------------------------------

const counters = store()
counters.apply(applyMissionCounters(data, clock, counters.get, noFacts, [{ kind: 12, amount: 1 }]))
counters.apply(applyMissionCounters(data, clock, counters.get, noFacts, [{ kind: 12, amount: 1 }]))
check("counter: two solo clears count on regular mission 6", counters.rows["1:6"]?.progress === 2, counters.rows["1:6"])
check("counter: two solo clears count on daily mission 6", counters.rows["2:6"]?.progress === 2, counters.rows["2:6"])
check("counter: Kaleidoscope daily mission 7 ignores a battle with no quest category", counters.rows["2:7"] === undefined, counters.rows["2:7"])
const kaleido = store()
kaleido.apply(applyMissionCounters(data, clock, kaleido.get, noFacts, [{ kind: 12, amount: 1, questCategory: 6 }]))
check("counter: a Kaleidoscope clear (QuestCategory 6) counts on daily mission 7", kaleido.rows["2:7"]?.progress === 1, kaleido.rows["2:7"])
check("counter: ...and on 'clear N solo battles' too", kaleido.rows["2:6"]?.progress === 1 && kaleido.rows["1:6"]?.progress === 1, [kaleido.rows["2:6"], kaleido.rows["1:6"]])
const mainClear = store()
mainClear.apply(applyMissionCounters(data, clock, mainClear.get, noFacts, [{ kind: 12, amount: 1, questCategory: 1 }]))
check("counter: a main quest clear doesn't count on the Kaleidoscope mission", mainClear.rows["2:7"] === undefined && mainClear.rows["2:6"]?.progress === 1, [mainClear.rows["2:7"], mainClear.rows["2:6"]])
for (const [name, questCategory] of [["EXP & Mana (14)", 14], ["Necropolis (13)", 13], ["elemental (6)", 6]]) {
    check(`counter: a Kaleidoscope ${name} clear counts on daily mission 7`, counterMatches(data.missions["2"]["7"], { kind: 12, amount: 1, questCategory }) === true)
}
check("counter: an advent quest (7) doesn't count as Kaleidoscope", counterMatches(data.missions["2"]["7"], { kind: 12, amount: 1, questCategory: 7 }) === false)
check("counter: a quest category with no master number doesn't count on filtered missions", counterMatches(data.missions["2"]["7"], { kind: 12, amount: 1, questCategory: 99 }) === false)
check("counter: boss missions with a chapter filter (42) aren't counted yet", counterMatches(data.missions["1"]["42"], { kind: 12, amount: 1, questCategory: 1 }) === false)
check("counter: zero or negative amounts are ignored", applyMissionCounters(data, clock, counters.get, noFacts, [{ kind: 12, amount: 0 }, { kind: 12, amount: -3 }]).length === 0)

const nextDay = { serverMs: recordedTime + 24 * 3600 * 1000, realMs: recordedTime + 24 * 3600 * 1000 }
const nextDayList = buildMissionProgressList(data, [2], nextDay, counters.get, noFacts)
check("daily reset: daily mission 6 is back to 0 the next day", nextDayList.find(e => e.mission_id === 6)?.progress_value === 0, nextDayList.find(e => e.mission_id === 6))
const regularNextDay = buildMissionProgressList(data, [1], nextDay, counters.get, noFacts).find(e => e.mission_id === 6)
check("daily reset: regular mission 6 keeps its progress", regularNextDay?.progress_value === 2, regularNextDay)
const pinnedNextDay = { serverMs: recordedTime, realMs: recordedTime + 24 * 3600 * 1000 }
check("daily reset: a pinned server date still resets every real day", dailyPeriodKey(pinnedNextDay) !== dailyPeriodKey(clock))
check("daily reset: the day starts at 05:00 UTC", dayNumber(Date.UTC(2024, 5, 21, 4, 59)) === dayNumber(Date.UTC(2024, 5, 20, 12)) && dayNumber(Date.UTC(2024, 5, 21, 5, 0)) !== dayNumber(Date.UTC(2024, 5, 21, 4, 59)))

const logins = store()
logins.apply(applyMissionCounters(data, clock, logins.get, noFacts, [{ kind: 0, amount: 1 }]))
logins.apply(applyMissionCounters(data, clock, logins.get, noFacts, [{ kind: 0, amount: 1 }]))
check("login: two logins on one day count once (mission 24)", logins.rows["1:24"]?.progress === 1 && logins.rows["1:24"]?.period === loginDayKey(clock), logins.rows["1:24"])
logins.apply(applyMissionCounters(data, nextDay, logins.get, noFacts, [{ kind: 0, amount: 1 }]))
check("login: a login the next day counts again", logins.rows["1:24"]?.progress === 2, logins.rows["1:24"])

// --- 6. "clear all daily missions" ---------------------------------------------------------------

const daily = store()
const period = dailyPeriodKey(clock)
for (const id of [6, 8, 7]) daily.rows[`2:${id}`] = { progress: 999, rewardedStage: 0, period }
let all = buildMissionProgressList(data, [2], clock, daily.get, noFacts).find(e => e.mission_id === 10)
check("all clear: 3 of 4 daily missions done shows 3", all?.progress_value === 3 && all?.stage === 1, all)
daily.rows["2:9"] = { progress: 999, rewardedStage: 0, period }
all = buildMissionProgressList(data, [2], clock, daily.get, noFacts).find(e => e.mission_id === 10)
check("all clear: 4 of 4 shows 4", all?.progress_value === 4, all)
daily.rows["2:9"] = { progress: 999, rewardedStage: 0, period: "old" }
all = buildMissionProgressList(data, [2], clock, daily.get, noFacts).find(e => e.mission_id === 10)
check("all clear: a mission done on an earlier day doesn't count", all?.progress_value === 3, all)

// --- 7. requests -----------------------------------------------------------------------------------

check("request: unknown categories are ignored (5 is titles now)", buildMissionProgressList(data, [99, 6], clock, store().get, noFacts).length === 0)
const twice = buildMissionProgressList(data, [1, 1], clock, store().get, noFacts)
check("request: a category asked for twice is listed once", twice.length === new Set(twice.map(asKey)).size)

// --- 8. rewards ------------------------------------------------------------------------------------

/** A fake account the payout talks to. */
function wallet() {
    const state = { beads: 100, mana: 1000, exp: 0, items: {}, equipment: [], characters: [] }
    state.wallet = {
        addFreeVmoney: (n) => (state.beads += n),
        addFreeMana: (n) => (state.mana += n),
        addExpPool: (n) => (state.exp += n),
        addItem: (id, n) => (state.items[id] = (state.items[id] ?? 0) + n),
        addEquipment: (id, n) => { state.equipment.push([id, n]); return { equipment_id: id } },
        addCharacter: (id) => { state.characters.push(id); return { character: { character_id: id } } },
    }
    return state
}

const pay = store()
for (let i = 0; i < 3; i++) pay.apply(applyMissionCounters(data, clock, pay.get, noFacts, [{ kind: 12, amount: 1 }]))
let settled = settleMissionRewards(data, clock, pay.get, noFacts)
const dailySix = settled.payouts.find(p => p.category === 2 && p.missionId === 6)
check("rewards: 3 solo clears pays daily mission 6 (beads x15, as the game shows)", dailySix?.rewards[0]?.kind === 0 && dailySix?.rewards[0]?.amount === 15, dailySix)
check("rewards: regular mission 6 isn't paid at 3 (its first target is 10)", !settled.payouts.some(p => p.category === 1 && p.missionId === 6), settled.payouts)
const account = wallet()
const paid = payMissionRewards(settled.payouts, account.wallet)
pay.apply(settled.updates)
check("rewards: the beads land in the account", account.beads === 115 && paid.user_info.free_vmoney === 115 && paid.added.free_vmoney === 15, { beads: account.beads, paid })
check("rewards: mission_info has the recorded shape", JSON.stringify(paid.mission_info[0]) === JSON.stringify({ mission_category_id: 2, mission_id: 6, mission_reward_id: 6001 }), paid.mission_info)
check("rewards: settling again pays nothing", settleMissionRewards(data, clock, pay.get, noFacts).payouts.length === 0)
check("rewards: the next day the daily mission can be paid again", (() => {
    const s = store()
    for (const [k, v] of Object.entries(pay.rows)) s.rows[k] = { ...v }
    for (let i = 0; i < 3; i++) s.apply(applyMissionCounters(data, nextDay, s.get, noFacts, [{ kind: 12, amount: 1 }]))
    return settleMissionRewards(data, nextDay, s.get, noFacts).payouts.some(p => p.category === 2 && p.missionId === 6)
})())

// the Kaleidoscope reward (blue flame x500 in the game) is the exp pool, and "clear all daily missions" pays once all 4 are done
const allDone = store()
for (const id of [6, 7, 8, 9]) allDone.rows[`2:${id}`] = { progress: 999, rewardedStage: 0, period }
settled = settleMissionRewards(data, clock, allDone.get, noFacts)
const kaleidoReward = settled.payouts.find(p => p.category === 2 && p.missionId === 7)
check("rewards: Kaleidoscope mission 7 pays exp pool x500", kaleidoReward?.rewards[0]?.kind === 5 && kaleidoReward?.rewards[0]?.amount === 500, kaleidoReward)
check("rewards: 'clear all daily missions' (10) is paid in the same settle", settled.payouts.some(p => p.category === 2 && p.missionId === 10), settled.payouts.map(p => p.missionId))
const many = wallet()
const manyPaid = payMissionRewards(settled.payouts, many.wallet)
check("rewards: mana, exp and beads all add up", many.mana === 1000 + 1500 && many.exp === 500 && many.beads === 100 + 15 + 30, { mana: many.mana, exp: many.exp, beads: many.beads, added: manyPaid.added })

// several stages at once: a state value jumps past three targets
const multi = settleMissionRewards(data, clock, store().get, factsOf({ 1: 31 })) // user rank 31: targets 10, 20, 30
check("rewards: rank 31 pays user rank stages 1 to 3 in order", JSON.stringify(multi.payouts.filter(p => p.missionId === 22).map(p => p.stage)) === "[1,2,3]", multi.payouts.filter(p => p.missionId === 22))
check("rewards: the saved row records 3 paid stages", multi.updates.find(u => u.missionId === 22)?.rewardedStage === 3, multi.updates.find(u => u.missionId === 22))

// the global cleared list: stages global already paid aren't paid again, and finished missions show as finished
const baseline = withClearedBaseline(data, store().get, { "22": 2, "1": 5 })
const baselineSettle = settleMissionRewards(data, clock, baseline, factsOf({ 1: 31 }))
check("baseline: with 2 stages paid on global, rank 31 pays only stage 3", JSON.stringify(baselineSettle.payouts.filter(p => p.missionId === 22).map(p => p.stage)) === "[3]", baselineSettle.payouts.filter(p => p.missionId === 22))
const maxCombo = buildMissionProgressList(data, [1], clock, baseline, noFacts).find(e => e.mission_id === 1)
check("baseline: max combo (not tracked here) shows global's 5 of 5 stages done", maxCombo?.progress_value === 100 && maxCombo?.stage === 5, maxCombo)
check("baseline: and it isn't paid again", !baselineSettle.payouts.some(p => p.missionId === 1))

const odd = payMissionRewards([{ category: 1, missionId: 1, stage: 1, rewardId: 1, rewards: [{ kind: 6, amount: 1, degreeId: 5 }, { kind: 1, amount: 2 }] }], wallet().wallet)
check("rewards: unsupported kinds and broken rows are skipped and reported, not thrown", odd.skipped.length === 2, odd.skipped)

// --- 9. in-battle actions ----------------------------------------------------------------------------

const finishDoc = read("../docs/routes/single_battle_quest_finish.md")
const finishBody = JSON.parse([...finishDoc.matchAll(/### Body\n```\n([\s\S]*?)\n```/g)][0][1])
const battle = (overrides = {}) => ({
    accomplished: finishBody.is_accomplished,
    isMulti: false,
    questCategory: 1,
    clearRank: 5,
    score: finishBody.score,
    questMana: 40,
    fieldMana: finishBody.add_mana,
    statistics: finishBody.statistics,
    ...overrides,
})
const events = battleMissionEvents(battle())
const eventOf = (kind, selector) => events.find(e => e.kind === kind && (selector === undefined || e.selector === selector))?.amount
check("battle: the recorded request gives dash 9, power flips 3, skills 3, enemies 27", eventOf(26, 2) === 9 && eventOf(26, 1) === 3 && eventOf(26, 4) === 3 && eventOf(26, 7) === 27, events)
check("battle: ...combo 71, power 600, score 241107, a solo clear and an SS clear", eventOf(28) === 71 && eventOf(25) === 600 && eventOf(23) === 241107 && eventOf(12) === 1 && eventOf(24) === 1, events)
check("battle: mana is the quest's mana plus field mana", eventOf(30) === 40 + finishBody.add_mana, eventOf(30))
check("battle: actions with 0 (soft spots, fever) make no event", eventOf(26, 0) === undefined && eventOf(26, 5) === undefined)
check("battle: a battle that wasn't cleared counts nothing", battleMissionEvents(battle({ accomplished: false })).length === 0)
check("battle: a clear below SS isn't an SS clear", battleMissionEvents(battle({ clearRank: 4 })).every(e => e.kind !== 24))
check("battle: junk values are ignored", (() => {
    const junk = battleMissionEvents(battle({ score: "9999", questMana: -5, fieldMana: 1.5, statistics: { max_combo_count: NaN, zones: [null, { use_dash_count: -3 }, { use_dash_count: 2 }] } }))
    return junk.find(e => e.kind === 23) === undefined && junk.find(e => e.kind === 30) === undefined && junk.find(e => e.kind === 28) === undefined && junk.find(e => e.kind === 26 && e.selector === 2)?.amount === 2
})())

const actions = store()
actions.apply(applyMissionCounters(data, clock, actions.get, noFacts, events))
const progressOf = (category, id) => actions.rows[`${category}:${id}`]?.progress
check("regular: max combo (1) is 71", progressOf(1, 1) === 71, progressOf(1, 1))
check("regular: dash (3) is 9, power flips (7) 3, skills (8) 3, enemies (35) 27", progressOf(1, 3) === 9 && progressOf(1, 7) === 3 && progressOf(1, 8) === 3 && progressOf(1, 35) === 27, [progressOf(1, 3), progressOf(1, 7), progressOf(1, 8), progressOf(1, 35)])
check("regular: max power (30) is 600, max score (34) 241107", progressOf(1, 30) === 600 && progressOf(1, 34) === 241107, [progressOf(1, 30), progressOf(1, 34)])
check("regular: SS clears (2) is 1, battle mana (4) is 40, solo clears (6) is 1", progressOf(1, 2) === 1 && progressOf(1, 4) === 40 && progressOf(1, 6) === 1, [progressOf(1, 2), progressOf(1, 4), progressOf(1, 6)])
check("daily: 'Dash x 10 times' (9) is 9", progressOf(2, 9) === 9, progressOf(2, 9))

actions.apply(applyMissionCounters(data, clock, actions.get, noFacts, battleMissionEvents(battle({ statistics: { ...finishBody.statistics, max_combo_count: 30 } }))))
check("best values: a lower combo later doesn't lower it", progressOf(1, 1) === 71, progressOf(1, 1))
check("counts: a second battle adds up (dash 18)", progressOf(1, 3) === 18, progressOf(1, 3))
actions.apply(applyMissionCounters(data, clock, actions.get, noFacts, battleMissionEvents(battle({ statistics: { ...finishBody.statistics, max_combo_count: 120 } }))))
check("best values: a higher combo replaces it", progressOf(1, 1) === 120, progressOf(1, 1))

const comboDefinition = data.missions["1"]["1"]
const soloOnly = { ...comboDefinition, params: comboDefinition.params.map((p, i) => i === 2 ? "1" : p) }
const multiOnly = { ...comboDefinition, params: comboDefinition.params.map((p, i) => i === 2 ? "2" : p) }
check("battle kind: a solo-only mission ignores multiplayer", counterMatches(soloOnly, { kind: 28, amount: 5, isMulti: true }) === false && counterMatches(soloOnly, { kind: 28, amount: 5, isMulti: false }) === true)
check("battle kind: a multiplayer-only mission ignores solo", counterMatches(multiOnly, { kind: 28, amount: 5, isMulti: false }) === false && counterMatches(multiOnly, { kind: 28, amount: 5, isMulti: true }) === true)
check("battle kind: a battle-kind mission ignores events that aren't battles", counterMatches(comboDefinition, { kind: 28, amount: 5 }) === false)
check("actions: a dash doesn't count on the skill mission", counterMatches(data.missions["1"]["8"], { kind: 26, amount: 1, selector: 2, isMulti: false }) === false)
check("actions: event-only action missions (Holiday Festival skills) aren't counted", counterMatches(data.missions["2"]["110002"], { kind: 26, amount: 1, selector: 4, isMulti: false, questCategory: 10 }) === false)

const comboSettle = settleMissionRewards(data, clock, actions.get, noFacts)
check("rewards: combo 120 pays max combo stages 1 to 5 (targets 10..100)", JSON.stringify(comboSettle.payouts.filter(p => p.category === 1 && p.missionId === 1).map(p => p.stage)) === "[1,2,3,4,5]", comboSettle.payouts.filter(p => p.missionId === 1))

// --- 10. chapter, EX and quest clears ----------------------------------------------------------------

const mainIds = Object.keys(JSON.parse(read("../assets/main_quest.json"))).map(Number)
const exIds = Object.keys(JSON.parse(read("../assets/ex_quest.json"))).map(Number)
/** Facts with these finished quests: { 1: [main ids], 4: [EX ids], 15: [practice ids] }. */
const questFacts = (finished) => ({
    stateValue: () => null,
    finishedQuestIds: (category) => new Set(finished[category] ?? []),
    questIds: (category) => category === 1 ? mainIds : category === 4 ? exIds : null,
})
const chapterIds = (ids, chapter) => ids.filter(id => Math.floor(id / 1e6) === chapter)

const rule10 = questClearRule(data.missions["1"]["10"])
check("rule: Clear Chapter 1 (10) is every main quest of chapter 1", rule10?.questCategory === 1 && questClearCandidates(rule10, mainIds).length === chapterIds(mainIds, 1).length && chapterIds(mainIds, 1).length === 21, rule10)
check("rule: Clear Chapter 1 EX (69) is every EX quest of chapter 1", JSON.stringify(questClearCandidates(questClearRule(data.missions["1"]["69"]), exIds).sort()) === JSON.stringify(chapterIds(exIds, 1).sort()))
check("rule: chapter 1 boss 1 (42) is main quest 1004002", JSON.stringify(questClearCandidates(questClearRule(data.missions["1"]["42"]), mainIds)) === "[1004002]")
check("rule: Clear 7-14-2 (93) is main quest 7014002", JSON.stringify(questClearCandidates(questClearRule(data.missions["1"]["93"]), mainIds)) === "[7014002]")
check("rule: practice Lignoid (56) is any of its listed quests", JSON.stringify(questClearRule(data.missions["1"]["56"])?.questIdList) === "[1,11,21,31,41,51]" && questClearRule(data.missions["1"]["56"])?.mode === "any")
check("rule: plain counters (solo clears, Kaleidoscope) aren't quest sets", questClearRule(data.missions["1"]["6"]) === null && questClearRule(data.missions["2"]["7"]) === null)
check("rule: every main chapter (1 to 12) and EX chapter mission finds quests", Object.entries(data.missions["1"]).filter(([_, m]) => m.kind === 20).every(([id, m]) => {
    const r = questClearRule(m)
    return r !== null && questClearCandidates(r, r.questCategory === 1 ? mainIds : exIds).length > 0
}), Object.entries(data.missions["1"]).filter(([_, m]) => m.kind === 20 && (!questClearRule(m) || questClearCandidates(questClearRule(m), questClearRule(m).questCategory === 1 ? mainIds : exIds).length === 0)).map(([id]) => id))

const chapter1 = chapterIds(mainIds, 1)
const partial = buildMissionProgressList(data, [1], clock, store().get, questFacts({ 1: chapter1.slice(0, 20) })).find(e => e.mission_id === 10)
check("chapter: 20 of chapter 1's 21 quests is not cleared", partial?.progress_value === 0, partial)
const full = buildMissionProgressList(data, [1], clock, store().get, questFacts({ 1: chapter1 }))
check("chapter: all 21 clears chapter 1 (10) and lists chapter 2 (11)", full.find(e => e.mission_id === 10)?.progress_value === 1 && full.some(e => e.mission_id === 11), full.filter(e => [10, 11].includes(e.mission_id)))

// sweep: chapters 1 to 3 and chapter 1 EX all done at once -> the whole chain pays in one settle
const sweepFacts = questFacts({ 1: [...chapterIds(mainIds, 1), ...chapterIds(mainIds, 2), ...chapterIds(mainIds, 3)], 4: chapterIds(exIds, 1) })
const sweep = settleMissionRewards(data, clock, store().get, sweepFacts)
const sweptIds = sweep.payouts.map(p => p.missionId)
check("sweep: chapters 1, 2 and 3 (10, 11, 12) pay together", [10, 11, 12].every(id => sweptIds.includes(id)), sweptIds)
check("sweep: chapter 4 (13) isn't paid without its quests", !sweptIds.includes(13), sweptIds)
check("sweep: all three 'Clear Chapter 1 EX' missions (69, 70, 71) pay", [69, 70, 71].every(id => sweptIds.includes(id)), sweptIds)
check("sweep: chapter 2 EX (72) waits for chapter 2's EX quests", !sweptIds.includes(72), sweptIds)
check("sweep: chapter 1's boss missions (42, 43, 44) pay", [42, 43, 44].every(id => sweptIds.includes(id)), sweptIds)
const afterSweep = store(); afterSweep.apply(sweep.updates)
check("sweep: settling again pays nothing", settleMissionRewards(data, clock, afterSweep.get, sweepFacts).payouts.length === 0)
check("sweep: no facts (an error reading quests) changes nothing", settleMissionRewards(data, clock, store().get, { stateValue: () => null }).payouts.every(p => !questClearRule(data.missions[String(p.category)][String(p.missionId)])))

// --- 11. account actions ------------------------------------------------------------------------------

const accountFacts = (state, items = {}) => ({ stateValue: (kind) => state[kind] ?? null, itemCount: (id) => items[id] ?? 0 })
const account1 = buildMissionProgressList(data, [1], clock, store().get, accountFacts({ 10: 10, 32: 4, 33: 6, 34: 1, 44: 2, 45: 1 }, { 100000: 1150 }))
const acc = (id) => account1.find(e => e.mission_id === id)
check("account: 10 different armaments shows on 'Obtain N new armaments' (33)", acc(33)?.progress_value === 10 && acc(33)?.stage === 4, acc(33))
check("account: 4 awakenings (67) is stage 3, as the recorded upgrade (stage 2 paid at 4)", acc(67)?.progress_value === 4 && acc(67)?.stage === 3, acc(67))
check("account: 6 Ability Cores (65), 1 Lv. 5 armament (68)", acc(65)?.progress_value === 6 && acc(68)?.progress_value === 1, [acc(65), acc(68)])
check("account: 2 open and 1 complete 2nd mana boards (95, 96)", acc(95)?.progress_value === 2 && acc(96)?.progress_value === 1, [acc(95), acc(96)])
check("account: 1150 Wrightpieces owned (66, item 100000)", acc(66)?.progress_value === 1150 && ownedItemId(data.missions["1"]["66"]) === 100000, acc(66))
const upgradeSettle = settleMissionRewards(data, clock, store().get, accountFacts({ 32: 4, 34: 1 }))
check("account: the recorded upgrade (4 awakenings, 1 Lv. 5) pays 67 stages 1-2 and 68 stage 1", JSON.stringify(upgradeSettle.payouts.filter(p => [67, 68].includes(p.missionId)).map(p => p.rewardId)) === "[67001,67002,68001]", upgradeSettle.payouts.map(p => p.rewardId))
const boardSettle = settleMissionRewards(data, clock, store().get, accountFacts({ 44: 1 }))
check("account: one 2nd board open pays 95001, as the recorded reply", boardSettle.payouts.some(p => p.rewardId === 95001), boardSettle.payouts.map(p => p.rewardId))
const amity = settleMissionRewards(data, clock, store().get, accountFacts({ 8: 1 }))
check("account: one Amity Scroll pays 39001, as the recorded reply", amity.payouts.some(p => p.rewardId === 39001), amity.payouts.map(p => p.rewardId))

const mana = store({ "1:11": { progress: 1, rewardedStage: 1, period: null } }) // chapter 2 done, so The Trove mission (41) is listed
mana.apply(applyMissionCounters(data, clock, mana.get, noFacts, [{ kind: 3, amount: 1200 }, { kind: 2, amount: 300 }]))
check("counter: 1200 mana spent at The Trove (41)", mana.rows["1:41"]?.progress === 1200, mana.rows["1:41"])
check("counter: 300 mana obtained (40)", mana.rows["1:40"]?.progress === 300, mana.rows["1:40"])
check("battle: a battle's mana also counts for total mana (40)", battleMissionEvents(battle()).some(e => e.kind === 2 && e.amount === 40))
check("counter: The Trove mission (41) waits for chapter 2", applyMissionCounters(data, clock, store().get, noFacts, [{ kind: 3, amount: 5 }]).every(u => u.missionId !== 41))

// --- 12. event missions: quest ranges -----------------------------------------------------------------

const ev = (kind, questCategory, questId, extra = {}) => ({ kind, amount: 1, questCategory, questId, isMulti: false, ...extra })
const raidDaily = data.missions["2"]["203004"] // raid 2: clear event battles, solo, quests 1-4 of event 2
check("range: raid 2's daily counts a solo clear of raid stage 2004", counterMatches(raidDaily, ev(21, 23, 2004)))
check("range: ...but not raid 1's stage 1004", !counterMatches(raidDaily, ev(21, 23, 1004)))
check("range: ...nor a multiplayer clear (it says solo)", !counterMatches(raidDaily, ev(21, 23, 2004, { isMulti: true })))
check("range: ...nor a different category with the same id", !counterMatches(raidDaily, ev(21, 22, 2004)))
const kaleidoscopeAll = { ...data.missions["2"]["7"] }
check("range: Kaleidoscope (12) counts the elemental, EXP & Mana, Necropolis and The Haunt categories", [6, 14, 13, 20].every(c => counterMatches(kaleidoscopeAll, ev(12, c, 1001))) && !counterMatches(kaleidoscopeAll, ev(12, 7, 1001)))
const storyEvent = Object.values(data.missions["2"]).find(m => m.kind === 12 && m.params[4] === "6" && m.params[5] !== null)
const storyQuestNumber = Number((storyEvent?.params[7] ?? "1").split(",")[0])
check(`range: a story event solo mission counts its own event's listed quests (${storyEvent?.params[5]}, quests ${storyEvent?.params[7]})`, storyEvent && counterMatches(storyEvent, ev(12, 10, Number(storyEvent.params[5]) * 1000 + storyQuestNumber)) && !counterMatches(storyEvent, ev(12, 10, (Number(storyEvent.params[5]) + 1) * 1000 + storyQuestNumber)))
check("range: ...and not a quest number outside its list", storyEvent.params[7] === null || !counterMatches(storyEvent, ev(12, 10, Number(storyEvent.params[5]) * 1000 + 999)))
const phase2 = Object.values(data.missions["2"]).find(m => m.kind === 47)
const phased = battleMissionEvents({ accomplished: true, isMulti: false, questCategory: 11, questId: Number(phase2.params[5]) * 1000 + 1, clearRank: 1, score: 1, questMana: 0, fieldMana: 0, statistics: { clear_phase: 2, zones: [] } })
check("phases: clearing phase 2 makes phase 1 and 2 events, not 3", phased.some(e => e.kind === 46) && phased.some(e => e.kind === 47) && !phased.some(e => e.kind === 48), phased.map(e => e.kind))
check("phases: a Trial's 'Clear Phase 2' mission counts it", phased.some(e => counterMatches(phase2, e)), phase2.params)
const multiplayerMission = data.missions["1"]["25"] // Clear N multiplayer battles
check("mode: a multiplayer mission never counts a solo clear", !counterMatches(multiplayerMission, ev(14, 1, 1001001)))
check("rule: chapter boss missions stay worked out from the save, not counted", !counterMatches(data.missions["1"]["42"], ev(12, 1, 1004002)))
check("events: a login doesn't count for battle missions with a battle filter", !counterMatches(raidDaily, { kind: 21, amount: 1 }))

// --- 13. data ---------------------------------------------------------------------------------------

for (const [category, missions] of Object.entries(data.missions)) {
    const problems = []
    for (const [id, m] of Object.entries(missions)) {
        if (m.stages.length === 0) problems.push(`${id}: no stages`)
        m.stages.forEach((s, i) => { if (!(s.target >= 0)) problems.push(`${id}/${i + 1}: target ${s.target}`) })
        if (m.prerequisite && !missions[String(m.prerequisite[0])]) problems.push(`${id}: prerequisite ${m.prerequisite[0]} missing`)
    }
    check(`data: category ${category} missions all have stages, targets and known prerequisites`, problems.length === 0, problems.slice(0, 10))
}
assert.ok(data.missions["1"]["6"].stages[0].rewards.length > 0)

// --- campaign missions (category 4: the Summer Vacation "Promo Missions", group 10002) ------------

const summer = { serverMs: Date.parse("2022-04-15T00:00:00Z"), realMs: Date.parse("2022-04-15T00:00:00Z") }
const summerIds = Object.entries(data.missions["4"]).filter(([_, m]) => m.group === 10002).map(([id]) => Number(id))
const summerList = buildMissionProgressList(data, [4], summer, store().get, noFacts).filter(e => summerIds.includes(e.mission_id))
check("campaign: all 22 Summer Vacation missions are listed on 2022-04-15 (category 4)", summerList.length === 22 && summerList.every(e => e.mission_category === 4), summerList.length)
check("campaign: round 3 isn't listed before it opens (2022-04-01)", !buildMissionProgressList(data, [4], { serverMs: Date.parse("2022-04-01T00:00:00Z"), realMs: Date.parse("2022-04-01T00:00:00Z") }, store().get, noFacts).some(e => e.mission_id === 1752))

const camp = store()
camp.apply(applyMissionCounters(data, summer, camp.get, noFacts, [{ kind: 12, amount: 1, isMulti: false, questCategory: 1, questId: 1001001 }]))
for (const [id, name] of [[1740, "multiplayer battles"], [1748, "host and clear"], [1753, "clear as a guest"], [1755, "multiplayer battles (round 3)"], [1746, "solo battles"]]) {
    check(`campaign: a solo clear counts for "${name}" (${id})`, camp.rows[`4:${id}`]?.progress === 1, camp.rows[`4:${id}`])
}
check("campaign: the stand-in is campaign-only (an event-tab multiplayer mission keeps its kind)", Object.values(data.missions["3"]).filter(m => m.kind === 14).every(m => countedDefinition(3, m) === m))
camp.apply(applyMissionCounters(data, summer, camp.get, noFacts, [{ kind: 12, amount: 1, isMulti: false, questCategory: 6, questId: 6001001 }]))
check("campaign: a Kaleidoscope clear counts for 'Clear N Kaleidoscope quests' (1743)", camp.rows["4:1743"]?.progress === 1, camp.rows["4:1743"])
camp.apply(applyMissionCounters(data, summer, camp.get, noFacts, [{ kind: 43, amount: 30000 }, { kind: 43, amount: 25000 }]))
check("campaign: spending 30,000 + 25,000 mana counts for 'Spend 50,000 mana' (1742)", camp.rows["4:1742"]?.progress === 55000, camp.rows["4:1742"])

const done = store(Object.fromEntries(summerIds.filter(id => data.missions["4"][id].kind !== 11).map(id => [`4:${id}`, { progress: data.missions["4"][id].stages.at(-1).target, rewardedStage: 1, period: null }])))
const after = new Map(buildMissionProgressList(data, [4], summer, done.get, noFacts).map(e => [e.mission_id, e]))
check("campaign: with every round mission done, 'Clear all Round 1/2/3' reach 6/6", [1744, 1751, 1758].every(id => after.get(id)?.progress_value === 6), [1744, 1751, 1758].map(id => after.get(id)?.progress_value))
check("campaign: and 'Clear all missions' (1,500 beads) reaches 18/18", after.get(1759)?.progress_value === 18 && data.missions["4"]["1759"].stages[0].rewards[0].amount === 1500, after.get(1759))

// --- post-EoS event missions: time clears (13), stamina (36), raid setup (75-78), Steambot conditions (82)

const ev3 = id => data.missions["3"][String(id)]
const finish = extra => ({ accomplished: true, isMulti: false, questCategory: 24, questId: 700005001, clearRank: 3, score: 0, questMana: 0, fieldMana: 0, statistics: {}, ...extra })
const gauntlet = ev3(700051) // Grand Gauntlet 5: Intermediate battle 1 in 120 seconds
check("time clear: Grand Gauntlet missions keep their time limit (700051: 120 s)", gauntlet.stages[0].timeLimitSeconds === 120, gauntlet.stages[0])
const timeEvent = battleMissionEvents(finish({ clearTimeMs: 95_000 })).find(e => e.kind === 13)
check("time clear: a 95 s clear of battle 700005001 counts for 700051", timeEvent !== undefined && counterMatches(gauntlet, timeEvent), timeEvent)
check("time clear: a 130 s clear doesn't", !counterMatches(gauntlet, battleMissionEvents(finish({ clearTimeMs: 130_000 })).find(e => e.kind === 13)))
check("time clear: a 95 s clear of another battle (700005002) doesn't count for battle 1", !counterMatches(gauntlet, battleMissionEvents(finish({ clearTimeMs: 95_000, questId: 700005002 })).find(e => e.kind === 13)))
check("time clear: a failed battle sends nothing", battleMissionEvents(finish({ accomplished: false, clearTimeMs: 1 })).length === 0)
check("time clear: the 'solo battle in under 60 seconds' title counts a 59 s solo clear", counterMatches(data.missions["5"]["15000"], battleMissionEvents(finish({ clearTimeMs: 59_000, questCategory: 1, questId: 1001002 })).find(e => e.kind === 13)))
check("time clear: but not a 59 s co-op clear", !counterMatches(data.missions["5"]["15000"], battleMissionEvents(finish({ clearTimeMs: 59_000, isMulti: true })).find(e => e.kind === 13)))

const staminaMission = data.missions["4"]["2243"] // "Use up a total of 100 stamina" (2024-10-01)
const staminaEvent = battleMissionEvents(finish({ staminaCost: 30 })).find(e => e.kind === 36)
check("stamina: a cleared battle sends its stamina cost", staminaEvent?.amount === 30, staminaEvent)
check("stamina: it counts for 'Use up a total of 100 stamina' (4/2243)", counterMatches(staminaMission, staminaEvent))
const staminaClock = { serverMs: Date.parse("2024-10-05T00:00:00Z"), realMs: Date.parse("2024-10-05T00:00:00Z") }
const stam = store()
for (let i = 0; i < 4; i++) stam.apply(applyMissionCounters(data, staminaClock, stam.get, noFacts, battleMissionEvents(finish({ staminaCost: 30 }))))
check("stamina: four 30-stamina clears make 120 on 4/2243", stam.rows["4:2243"]?.progress === 120, stam.rows["4:2243"])

const raidClock = { serverMs: Date.parse("2025-05-14T00:00:00Z"), realMs: Date.parse("2025-05-14T00:00:00Z") }
check("raid: opening raid 4 counts for 'Join the event' (400053)", counterMatches(ev3(400053), raidMissionEvents(4, "join")[0]))
check("raid: opening raid 5 doesn't count for raid 4's mission", !counterMatches(ev3(400053), raidMissionEvents(5, "join")[0]))
check("raid: editing party slot 1/2/3 counts for Main/Sub 1/Sub 2 (400054-400056)",
    [1, 2, 3].every(slot => counterMatches(ev3(400053 + slot), raidMissionEvents(4, { partySlot: slot })[0]))
    && !counterMatches(ev3(400054), raidMissionEvents(4, { partySlot: 2 })[0]))
check("raid: a fourth party slot sends nothing", raidMissionEvents(4, { partySlot: 4 }).length === 0)
const raid = store()
raid.apply(applyMissionCounters(data, raidClock, raid.get, noFacts, [...raidMissionEvents(4, "join"), ...raidMissionEvents(4, { partySlot: 3 })]))
check("raid: during raid 4 the join and Sub 2 missions reach 1/1", raid.rows["3:400053"]?.progress === 1 && raid.rows["3:400056"]?.progress === 1 && raid.rows["3:400054"] === undefined, raid.rows)

const zone = (coffins, leaderBad) => ({ encoffinment_count: coffins, members: [{ conditions: Array.from({ length: 15 }, (_, i) => ({ max_acc_bad: leaderBad.includes(i) ? 1 : 0 })) }, null, null] })
const steam = (stats, extra = {}) => battleMissionEvents({ ...finish({ isMulti: true, questCategory: 26, clearRank: 5, statistics: stats, ...extra }) }).find(e => e.kind === 82)
check("condition: a co-op SS clear of Steambot Krag (2001) in 150 s with no coffins counts for 600002",
    counterMatches(ev3(600002), steam({ zones: [zone(0, []), zone(0, [])] }, { questId: 2001, clearTimeMs: 150_000 })))
check("condition: one coffin doesn't", !counterMatches(ev3(600002), steam({ zones: [zone(0, []), zone(1, [])] }, { questId: 2001, clearTimeMs: 150_000 }) ?? { kind: 82, amount: 1 }))
check("condition: taking 200 s doesn't (no coffins within 180 s of the start)", !counterMatches(ev3(600002), steam({ zones: [zone(0, [])] }, { questId: 2001, clearTimeMs: 200_000 }) ?? { kind: 82, amount: 1 }))
check("condition: Vernus (3001) with the Leader never attack-downed counts for 600003", counterMatches(ev3(600003), steam({ zones: [zone(2, [7])] }, { questId: 3001, clearTimeMs: 300_000 })))
check("condition: Vernus with the Leader attack-downed doesn't", !counterMatches(ev3(600003), steam({ zones: [zone(0, [0])] }, { questId: 3001, clearTimeMs: 300_000 }) ?? { kind: 82, amount: 1 }))
check("condition: Eisen (100000001) without Light resistance down counts for 900653", counterMatches(ev3(900653), steam({ zones: [zone(0, [0])] }, { questId: 100000001, clearTimeMs: 300_000 })))
check("condition: an S (not SS) clear sends nothing", battleMissionEvents(finish({ isMulti: true, questCategory: 26, questId: 3001, clearRank: 4, statistics: { zones: [zone(0, [])] }, clearTimeMs: 100_000 })).every(e => e.kind !== 82))
check("condition: a solo SS clear doesn't count (these missions are co-op)", !counterMatches(ev3(600003), steam({ zones: [zone(0, [])] }, { questId: 3001, clearTimeMs: 100_000, isMulti: false })))

console.log(failures === 0 ? "\nAll mission tests passed." : `\n${failures} mission test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
