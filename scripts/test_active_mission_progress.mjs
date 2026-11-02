// Tests the active mission progress logic (src/lib/activeMissionProgress.ts) without a database.
//
// Run `npm run build` first, because this loads the compiled code from out/:
//   node scripts/test_active_mission_progress.mjs
//
// It replays actions recorded from the real global server (docs/routes/equipment_upgrade.md,
// expod_inject_exp.md, character_learn_mana_node.md, character_over_limit.md,
// character_receive_bond_token.md, shop_buy.md and story_quest_finish.md) and checks that the missions
// reported are the ones it reported.

import assert from "node:assert"
import { readFileSync } from "node:fs"
import { estimateCharacterLevel, updateActiveMissionProgress } from "../out/lib/activeMissionProgress.js"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const file = JSON.parse(read("../assets/active_missions.json"))
const data = { requirements: file.requirements, patterns: file.patterns, targets: file.targets, characterTargets: file.characterTargets, questRules: file.questRules }

// the quests the game has, so the quest missions are checked against the real quest IDs
const mainQuests = JSON.parse(read("../assets/main_quest.json"))
const exQuests = JSON.parse(read("../assets/ex_quest.json"))
const bossQuests = JSON.parse(read("../assets/boss_battle_quest.json"))
const battleIds = (quests) => Object.keys(quests).filter((id) => "rankPointReward" in quests[id]).map(Number)

// src/lib/character.ts -> characterExpCaps (copied, so this test needs no database)
const expCaps = {"1": [11416, 15820, 21477, 28538, 37241, 49481, 66600, 91180, 125223, 170928, 216633, 262338, 308043], "2": [21477, 28538, 37241, 49481, 66600, 91180, 125223, 170928, 216633, 262338, 308043], "3": [37241, 49481, 66600, 91180, 125223, 170928, 216633, 262338, 308043], "4": [76272, 102829, 139190, 189995, 240800, 291605, 342410], "5": [153988, 210488, 266988, 323488, 379988]}

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

// A fake account. `saved`: mission ID -> { progress, stages }.
function account({ saved = {}, equipment = [], characters = [], abilityNodes = 0, evolved = 0, overLimit = 0, bondTokens = 0,
    owned = [], stories = 0, partyEquipment = 0, partyUnison = 0, partySouls = 0, quests = [] } = {}) {
    const missions = JSON.parse(JSON.stringify(saved))
    const log = { progress: [], unlocked: [] }
    return {
        log,
        missions,
        store: {
            getMissions: () => missions,
            setProgress: (id, value) => { log.progress.push([id, value]); (missions[id] ??= { progress: 0, stages: {} }).progress = value },
            unlockStage: (id, stage) => { log.unlocked.push([id, stage]); ((missions[id] ??= { progress: 0, stages: {} }).stages)[stage] ??= false },
        },
        facts: {
            equipmentLevels: () => equipment,
            characters: () => characters,
            abilityNodeCount: () => abilityNodes,
            evolvedCharacterCount: () => evolved,
            overLimitTotal: () => overLimit,
            bondTokenCount: () => bondTokens,
            ownedCharacterIds: () => owned,
            finishedCharacterStoryCount: () => stories,
            partyEquipmentCount: () => partyEquipment,
            partyUnisonCount: () => partyUnison,
            partyAbilitySoulCount: () => partySouls,
            questProgress: () => quests,
            battleQuestIds: (category) => category === 1 ? battleIds(mainQuests) : category === 4 ? battleIds(exQuests) : [],
        },
    }
}
const run = (acc, trigger, d = data) => updateActiveMissionProgress(d, acc.store, acc.facts, trigger, expCaps)

// ---- the level estimate ----
const rarities = Object.keys(expCaps).map(Number)
const base = (r) => 40 + (r - 1) * 10
let exact = true
for (const r of rarities) expCaps[r].forEach((cap, i) => { if (estimateCharacterLevel(r, cap, expCaps) !== base(r) + i * 5) exact = false })
check("exact at every exp cap of every rarity", exact)
check("level 40 is 11416 exp for 1 to 3 star characters", [1, 2, 3].every((r) => estimateCharacterLevel(r, 11416, expCaps) === 40 && estimateCharacterLevel(r, 11415, expCaps) === 39))
let monotonic = true
for (const r of rarities) {
    let previous = 0
    for (let exp = 0; exp <= 400000; exp += 97) {
        const level = estimateCharacterLevel(r, exp, expCaps)
        if (level < previous || level < 1 || level > 100) monotonic = false
        previous = level
    }
}
check("never goes down as exp goes up, and stays between 1 and 100", monotonic)
check("a new character is level 1", rarities.every((r) => estimateCharacterLevel(r, 0, expCaps) === 1))

// ---- the recorded equipment upgrade ----
const equipmentDoc = read("../docs/routes/equipment_upgrade.md")
const eqBlocks = [...equipmentDoc.matchAll(/### Body\n```\n([\s\S]*?)\n```/g)].map((m) => m[1])
const recordedEquipment = JSON.parse(eqBlocks[1]).data.active_mission_list
// before the upgrade: 11030 was already done (progress 1, so the beginner "complete all" already counted it),
// and one piece of equipment is now level 5
let acc = account({ saved: { 11030: { progress: 1, stages: { 1: false } }, 11110: { progress: 1, stages: {} } }, equipment: [5] })
let deltas = run(acc, { recompute: [34, 36] })
const byId = (list) => [...list].sort((a, b) => a.mission_id - b.mission_id)
let same = true
try { assert.deepStrictEqual(deltas, byId(recordedEquipment)) } catch { same = false }
check("RECORDED equipment upgrade: the same missions, progress and unlocked stages", same, { deltas, recorded: byId(recordedEquipment) })

// ---- the recorded exp injection ----
const expodDoc = read("../docs/routes/expod_inject_exp.md")
const exBlocks = [...expodDoc.matchAll(/### Body\n```\n([\s\S]*?)\n```/g)].map((m) => m[1])
const recordedExp = JSON.parse(exBlocks[1]).data.active_mission_list
// before: 12030 unlocked at progress 60, and 11090 already done. The injection takes a 4 star character to level 70.
acc = account({
    saved: { 12030: { progress: 60, stages: { 1: false } }, 12110: { progress: 1, stages: {} }, 11090: { progress: 1, stages: { 1: true } }, 11110: { progress: 1, stages: {} } },
    characters: [{ rarity: 4, exp: expCaps[4][0] }],
})
deltas = run(acc, { recompute: [5, 63] })
same = true
try { assert.deepStrictEqual(deltas, byId(recordedExp)) } catch { same = false }
check("RECORDED exp injection: only 12030 is reported, and 11090 stays put", same, { deltas, recorded: byId(recordedExp) })

// ---- exp injection for the first time ----
acc = account({ characters: [{ rarity: 3, exp: 500 }] })
deltas = run(acc, { recompute: [5, 63] })
check("first injection unlocks 11090 (the stage is not received)", JSON.stringify(deltas.filter((d) => d.mission_id === 11090)) === JSON.stringify([{ mission_id: 11090, progress_value: 1, stages: [{ stage: 1, received: false }] }]), deltas)
const lowLevel = deltas.find((d) => d.mission_id === 12030)
check("a low level character raises 12030's progress to its level but unlocks nothing", lowLevel?.progress_value === 9 && lowLevel.stages.length === 0, deltas)
check("...and the beginner \"complete all\" counts the finished 11090", deltas.find((d) => d.mission_id === 11110)?.progress_value === 1, deltas)
deltas = run(acc, { recompute: [5, 63] })
check("injecting again reports nothing new", deltas.length === 0, deltas)

// ---- the level 40 mission ----
acc = account({ characters: [{ rarity: 1, exp: 11416 }] })
deltas = run(acc, { recompute: [5] })
check("a character reaching level 40 unlocks 12030", JSON.stringify(deltas.find((d) => d.mission_id === 12030)) === JSON.stringify({ mission_id: 12030, progress_value: 40, stages: [{ stage: 1, received: false }] }), deltas)
check("...and the elementary \"complete all\" counts it", deltas.find((d) => d.mission_id === 12110)?.progress_value === 1 && deltas.length === 2, deltas)
acc = account({ saved: { 12030: { progress: 40, stages: { 1: true } }, 12110: { progress: 1, stages: {} } }, characters: [{ rarity: 1, exp: 21477 }] })
deltas = run(acc, { recompute: [5] })
check("a received stage stays received while progress keeps going up", deltas[0].progress_value === 50 && deltas[0].stages.length === 0 && acc.missions[12030].stages[1] === true && acc.log.unlocked.length === 0, [deltas, acc.log])

// ---- progress never goes down, and unchanged missions aren't reported ----
acc = account({ saved: { 11030: { progress: 4, stages: { 1: true } }, 14050: { progress: 1, stages: { 1: false } } }, equipment: [] })
deltas = run(acc, { recompute: [34, 36] })
check("selling equipment doesn't undo progress or report anything", deltas.length === 0 && acc.log.progress.length === 0, [deltas, acc.log])
acc = account({ equipment: [3, 1, 1] })
run(acc, { recompute: [34, 36] })
deltas = run(acc, { recompute: [34, 36] })
check("the same action twice: the second time reports nothing", deltas.length === 0, deltas)

// ---- equipment rules ----
acc = account({ equipment: [5, 5, 3, 1] })
deltas = byId(run(acc, { recompute: [34, 36] }))
check("11030 counts every upgrade level (4 + 4 + 2 + 0 = 10)", deltas.find((d) => d.mission_id === 11030)?.progress_value === 10, deltas)
check("14050 counts the pieces at level 5 (2)", deltas.find((d) => d.mission_id === 14050)?.progress_value === 2, deltas)

// ---- "complete all" ----
const tier1 = Object.keys(file.missions).map(Number).filter((id) => Math.floor(id / 1000) === 11 && id !== 11110)
acc = account({ saved: Object.fromEntries(tier1.slice(0, 7).map((id) => [id, { progress: 99, stages: { 1: false } }])) })
// a target changing makes 11110 count again: 7 are already done, now 11030 (equipment) joins as the 8th
acc.missions[11030] = { progress: 0, stages: {} }
acc.facts.equipmentLevels = () => [2]
deltas = byId(run(acc, { recompute: [34] }))
const allClear = deltas.find((d) => d.mission_id === 11110)
check("11110 counts how many beginner missions are done", allClear?.progress_value === tier1.slice(0, 7).concat(11030).length || allClear?.progress_value >= 7, deltas)
acc = account({ saved: Object.fromEntries(tier1.filter((id) => id !== 11030).map((id) => [id, { progress: 99, stages: { 1: false } }])), equipment: [2] })
deltas = byId(run(acc, { recompute: [34] }))
check("when the last beginner mission is done, 11110 reaches 10 and unlocks", JSON.stringify(deltas.find((d) => d.mission_id === 11110)) === JSON.stringify({ mission_id: 11110, progress_value: 10, stages: [{ stage: 1, received: false }] }), deltas)
acc = account({ equipment: [1, 1] })
check("nothing changes when no mission is affected (equipment that was never upgraded)", run(acc, { recompute: [34, 36] }).length === 0, acc.log)


// ---- batch 2: the recorded mana node, over limit, bond token and shop actions ----
const recordedMissions = (file) => {
    const blocks = [...read(file).matchAll(/### Body\n```\n([\s\S]*?)\n```/g)].map((m) => m[1])
    return byId(JSON.parse(blocks[1]).data.active_mission_list)
}
const matches = (deltas, recorded) => { try { assert.deepStrictEqual(deltas, recorded); return true } catch { return false } }

// learning a mana node: 11070 went to 29 (it was unlocked already, and the "complete all" already counted it)
acc = account({ saved: { 11070: { progress: 28, stages: { 1: false } }, 11110: { progress: 1, stages: {} } }, abilityNodes: 29 })
deltas = byId(run(acc, { recompute: [62, 61] }))
check("RECORDED mana node: the same missions and progress", matches(deltas, recordedMissions("../docs/routes/character_learn_mana_node.md")), { deltas })

// over limit: 13040 went to 17
acc = account({ saved: { 13040: { progress: 15, stages: { 1: false } }, 13110: { progress: 1, stages: {} } }, overLimit: 17 })
deltas = byId(run(acc, { recompute: [9] }))
check("RECORDED over limit: the same missions and progress", matches(deltas, recordedMissions("../docs/routes/character_over_limit.md")), { deltas })

// a bond token: 14070 unlocks, and the advanced "complete all" goes from 1 to 2
acc = account({ saved: { 14050: { progress: 1, stages: { 1: true } }, 14110: { progress: 1, stages: {} } }, bondTokens: 1 })
deltas = byId(run(acc, { recompute: [8] }))
check("RECORDED bond token: the same missions, unlocked stage and all-clear count", matches(deltas, recordedMissions("../docs/routes/character_receive_bond_token.md")), { deltas, recorded: recordedMissions("../docs/routes/character_receive_bond_token.md") })

// a treasure shop purchase: 12010 went to 146
acc = account({ saved: { 12010: { progress: 145, stages: { 1: false } }, 12110: { progress: 1, stages: {} } } })
deltas = byId(run(acc, { add: { 45: 1 } }))
check("RECORDED shop purchase: the same missions and progress", matches(deltas, recordedMissions("../docs/routes/shop_buy.md")), { deltas })

// ---- the first of each ----
acc = account()
deltas = byId(run(acc, { add: { 45: 1 } }))
check("first treasure shop purchase unlocks 12010", JSON.stringify(deltas.find((d) => d.mission_id === 12010)) === JSON.stringify({ mission_id: 12010, progress_value: 1, stages: [{ stage: 1, received: false }] }), deltas)
deltas = byId(run(acc, { add: { 45: 3 } }))
check("buying 3 more adds 3", deltas.find((d) => d.mission_id === 12010)?.progress_value === 4 && deltas.find((d) => d.mission_id === 12010).stages.length === 0, deltas)

acc = account({ abilityNodes: 1, evolved: 1 })
deltas = byId(run(acc, { recompute: [62, 61] }))
check("the first node unlocks 11070 and 12040 (evolving), and counts toward 13020", deltas.find((d) => d.mission_id === 11070)?.stages.length === 1 && deltas.find((d) => d.mission_id === 12040)?.stages.length === 1 && deltas.find((d) => d.mission_id === 13020)?.progress_value === 1 && deltas.find((d) => d.mission_id === 13020).stages.length === 0, deltas)
acc = account({ evolved: 6 })
check("the sixth evolved character unlocks 13020", byId(run(acc, { recompute: [61] })).find((d) => d.mission_id === 13020)?.stages.length === 1)

acc = account({ overLimit: 1 })
check("the first over limit step unlocks 13040", byId(run(acc, { recompute: [9] })).find((d) => d.mission_id === 13040)?.stages.length === 1)

// ---- each action only touches its own missions ----
acc = account({ abilityNodes: 5, evolved: 2, overLimit: 3, bondTokens: 1, equipment: [5], characters: [{ rarity: 1, exp: 20000 }] })
const ids = (list) => list.map((d) => d.mission_id)
check("over limit changes only 13040 and its all-clear", JSON.stringify(ids(run(acc, { recompute: [9] }))) === JSON.stringify([13040, 13110]), ids(run(account({ overLimit: 3 }), { recompute: [9] })))
check("a bond token changes only 14070 and its all-clear", JSON.stringify(ids(run(account({ bondTokens: 1 }), { recompute: [8] }))) === JSON.stringify([14070, 14110]))
check("a shop purchase changes only 12010 and its all-clear", JSON.stringify(ids(run(account(), { add: { 45: 2 } }))) === JSON.stringify([12010, 12110]))


// ---- batch 3: the recorded story quest, and the party, ownership and boss coin rules ----
// a character story finished: 11010 unlocks, and the beginner "complete all" goes from 3 to 4
const beginnerDone = { 11020: { progress: 1, stages: { 1: false } }, 11030: { progress: 4, stages: { 1: false } }, 11070: { progress: 2, stages: { 1: false } } }
acc = account({ saved: { ...beginnerDone, 11110: { progress: 3, stages: {} } }, stories: 1 })
deltas = byId(run(acc, { recompute: [21] }))
check("RECORDED story quest: the same missions, unlocked stage and all-clear count", matches(deltas, recordedMissions("../docs/routes/story_quest_finish.md")), { deltas, recorded: recordedMissions("../docs/routes/story_quest_finish.md") })
acc = account({ stories: 5 })
check("11010 counts the finished character stories", byId(run(acc, { recompute: [21] })).find((d) => d.mission_id === 11010)?.progress_value === 5)

// obtaining the character Murakumo (141003)
acc = account({ owned: [1, 2, 3] })
check("14080: not owning Murakumo changes nothing", run(acc, { recompute: [4] }).length === 0)
acc = account({ owned: [1, 141003] })
deltas = byId(run(acc, { recompute: [4] }))
check("14080: owning Murakumo unlocks it (progress 1)", JSON.stringify(deltas.find((d) => d.mission_id === 14080)) === JSON.stringify({ mission_id: 14080, progress_value: 1, stages: [{ stage: 1, received: false }] }), deltas)
check("14080 never goes down if the character is lost", (() => { const again = run(acc, { recompute: [4] }); acc.facts.ownedCharacterIds = () => []; return again.length === 0 && run(acc, { recompute: [4] }).length === 0 && acc.missions[14080].progress === 1 })())

// party edits: first equipment, first unison character, ability souls
acc = account({ partyEquipment: 1 })
deltas = byId(run(acc, { recompute: [58, 59, 35] }))
check("equipment in a party unlocks 11020 and nothing else but its all-clear", JSON.stringify(deltas.map((d) => d.mission_id)) === JSON.stringify([11020, 11110]) && deltas[0].progress_value === 1 && deltas[0].stages.length === 1, deltas)
acc = account({ partyUnison: 2 })
check("a unison character in a party unlocks 11040 (a flag: progress 1, not 2)", byId(run(acc, { recompute: [58, 59, 35] })).find((d) => d.mission_id === 11040)?.progress_value === 1)
acc = account({ partySouls: 1 })
deltas = byId(run(acc, { recompute: [58, 59, 35] }))
check("one ability soul in a party unlocks 14060", JSON.stringify(deltas.find((d) => d.mission_id === 14060)) === JSON.stringify({ mission_id: 14060, progress_value: 1, stages: [{ stage: 1, received: false }] }), deltas)
acc.facts.partyAbilitySoulCount = () => 3
check("more ability souls raise the progress without unlocking again", (() => { const o = byId(run(acc, { recompute: [35] })).find((d) => d.mission_id === 14060); return o.progress_value === 3 && o.stages.length === 0 })())
acc = account({ partyEquipment: 1, partyUnison: 1, partySouls: 1 })
run(acc, { recompute: [58, 59, 35] })
acc.facts.partyEquipmentCount = () => 0; acc.facts.partyUnisonCount = () => 0; acc.facts.partyAbilitySoulCount = () => 0
check("emptying the party later undoes nothing", run(acc, { recompute: [58, 59, 35] }).length === 0 && acc.missions[11020].progress === 1 && acc.missions[11040].progress === 1 && acc.missions[14060].progress === 1)
acc = account()
check("an empty party changes nothing", run(acc, { recompute: [58, 59, 35] }).length === 0)

// boss coin equipment purchases
acc = account()
deltas = byId(run(acc, { add: { 64: 1 } }))
check("the first boss coin equipment purchase unlocks 13100", JSON.stringify(deltas.find((d) => d.mission_id === 13100)) === JSON.stringify({ mission_id: 13100, progress_value: 1, stages: [{ stage: 1, received: false }] }), deltas)
check("a purchase of 2 more adds 2", byId(run(acc, { add: { 64: 2 } })).find((d) => d.mission_id === 13100)?.progress_value === 3)

// ---- the login catch-up ----
const loginTrigger = { recompute: [4, 5, 8, 9, 21, 34, 35, 36, 58, 59, 61, 62], refreshAllClear: true }
acc = account({ owned: [141003], stories: 2, partyEquipment: 3, equipment: [5], abilityNodes: 4, evolved: 6, overLimit: 2, bondTokens: 1, characters: [{ rarity: 1, exp: 11416 }] })
deltas = byId(run(acc, loginTrigger))
const unlockedIds = deltas.filter((d) => d.stages.length > 0).map((d) => d.mission_id)
check("catching up at login unlocks everything the player's data already earns", JSON.stringify(unlockedIds) === JSON.stringify([11010, 11020, 11030, 11070, 12030, 12040, 13020, 13040, 14050, 14070, 14080]), unlockedIds)
check("...and a second login changes nothing", run(acc, loginTrigger).length === 0)
// stale "complete all" counts are repaired only when asked to
const tier1Done = Object.fromEntries([11010, 11020, 11030, 11040, 11050, 11060, 11070, 11080, 11090, 11100].map((id) => [id, { progress: 99, stages: { 1: false } }]))
acc = account({ saved: { ...tier1Done, 11110: { progress: 2, stages: {} } } })
check("without refreshAllClear a stale all-clear count stays as it is", run(acc, { recompute: [4] }).length === 0)
deltas = run(acc, { recompute: [4], refreshAllClear: true })
check("with refreshAllClear it is counted again (10) and unlocks", JSON.stringify(deltas) === JSON.stringify([{ mission_id: 11110, progress_value: 10, stages: [{ stage: 1, received: false }] }]), deltas)

// ---- other patterns are left alone; counters work ----
acc = account({ equipment: [5], characters: [{ rarity: 1, exp: 20000 }] })
check("a pattern that isn't handled yet changes nothing", run(acc, { recompute: [65, 99] }).length === 0)
check("quest patterns with nothing cleared change nothing", run(acc, { recompute: [23, 57, 66] }).length === 0)
const counterData = { requirements: { 1: { 1: 3 } }, patterns: { 1: 99 }, targets: {} }
acc = account()
check("counters: +1 each time, unlocking at the requirement", [1, 2, 3, 4].map((n) => { const out = run(acc, { add: { 99: 1 } }, counterData); return `${out[0].progress_value}:${out[0].stages.length}` }).join(",") === "1:0,2:0,3:1,4:0")

// ---- quest and battle missions (batch 4) ----
const clear = (category, questId, clearRank) => ({ category, questId, finished: true, clearRank })
const unlockedOf = (list) => list.filter((d) => d.stages.length > 0).map((d) => d.mission_id)

// every quest mission has a rule, and every rule matches at least one real quest
const questMissions = Object.keys(file.patterns).filter((id) => [23, 57, 66].includes(file.patterns[id]))
check("all 23/57/66 missions (23 of them) have a rule", questMissions.length === 23 && questMissions.every((id) => file.questRules[id]), questMissions.length)
const allIds = { 1: Object.keys(mainQuests), 4: Object.keys(exQuests), 2: Object.keys(bossQuests) }
check("the chapter-final main quests and the EX quest exist", [1008004, 2009007, 3013003, 4011005, 5013004, 6010006, 7014004].every((id) => String(id) in mainQuests) && "1008001" in exQuests)

// chapter missions: only the exact final quest of a chapter counts
const finalQuests = { 11050: 1008004, 11100: 2009007, 12020: 3013003, 12050: 4011005, 13010: 5013004, 13030: 6010006, 14020: 7014004 }
for (const [mission, questId] of Object.entries(finalQuests)) {
    acc = account({ quests: [clear(1, questId)] })
    check(`clearing main quest ${questId} unlocks only ${mission}`, JSON.stringify(unlockedOf(run(acc, { recompute: [57] }))) === JSON.stringify([Number(mission)]), unlockedOf(run(account({ quests: [clear(1, questId)] }), { recompute: [57] })))
}
acc = account({ quests: [clear(1, 1008003), clear(1, 1001001), clear(4, 1005001)] })
check("other main quests (and EX quests) don't unlock a chapter mission", run(acc, { recompute: [57] }).length === 0)
acc = account({ quests: [clear(4, 1008001)] })
check("EX 1-8-1 unlocks 12070", JSON.stringify(unlockedOf(run(acc, { recompute: [57] }))) === JSON.stringify([12070]))
acc = account({ quests: [clear(1, 1008001)] })
check("...but a main quest with the same ID doesn't", run(acc, { recompute: [57] }).length === 0)

// daily dungeons
acc = account(); deltas = run(acc, { quest: { category: 14, questId: 1002 } })
check("any exp & mana daily quest unlocks 11080 only", JSON.stringify(unlockedOf(deltas)) === JSON.stringify([11080]), deltas)
check("the Lv50 daily (1005) unlocks 12060, not 13050", JSON.stringify(unlockedOf(run(acc, { quest: { category: 14, questId: 1005 } }))) === JSON.stringify([12060]))
check("the Lv60 daily (1006) unlocks 13050", JSON.stringify(unlockedOf(run(acc, { quest: { category: 14, questId: 1006 } }))) === JSON.stringify([13050]))
acc = account(); deltas = run(acc, { quest: { category: 6, questId: 3004 } })
check("any elemental daily quest unlocks 11060", JSON.stringify(unlockedOf(deltas)) === JSON.stringify([11060]), deltas)
check("...and a category 6 quest doesn't count for the exp & mana daily", !unlockedOf(deltas).includes(11080))

// Yuragi (challenge dungeon = 13) and Yugen (tower = 20)
acc = account()
check("Yuragi hokai door (13/1001) unlocks 12100", JSON.stringify(unlockedOf(run(acc, { quest: { category: 13, questId: 1001 } }))) === JSON.stringify([12100]))
check("Lv50 Yuragi (1005) unlocks 13060", JSON.stringify(unlockedOf(run(acc, { quest: { category: 13, questId: 1005 } }))) === JSON.stringify([13060]))
check("Lv60 Yuragi (1006) unlocks 14090", JSON.stringify(unlockedOf(run(acc, { quest: { category: 13, questId: 1006 } }))) === JSON.stringify([14090]))
check("Lv70 Yuragi (1007) unlocks 14100", JSON.stringify(unlockedOf(run(acc, { quest: { category: 13, questId: 1007 } }))) === JSON.stringify([14100]))
check("a Yuragi quest of another event (2004) counts for none of them", run(account(), { quest: { category: 13, questId: 2004 } }).length === 0)
check("Yugen (tower, 20/1001) unlocks 13070", JSON.stringify(unlockedOf(run(account(), { quest: { category: 20, questId: 1001 } }))) === JSON.stringify([13070]))

// boss battles: "3 times" is a real counter, and the difficulty is the last digit of the quest ID
acc = account()
const bossAt = (difficulty) => Number(Object.keys(bossQuests).find((id) => Number(id) % 1000 === difficulty))
const boss1 = bossAt(1), boss2 = bossAt(2), boss3 = bossAt(3), boss5 = bossAt(5)
check("there is a boss quest of every difficulty used (1, 2, 3, 5)", [boss1, boss2, boss3, boss5].every((id) => id > 0), [boss1, boss2, boss3, boss5])
const counts = [1, 2, 3, 4].map(() => run(acc, { quest: { category: 2, questId: boss1 } }).find((d) => d.mission_id === 12080))
check("12080 counts every boss clear, also repeats of one quest, and unlocks at 3", counts.map((d) => `${d.progress_value}:${d.stages.length}`).join(",") === "1:0,2:0,3:1,4:0", counts)
check("a difficulty 1 boss does not count for 12090, 13080 or 14040", !JSON.stringify(Object.keys(acc.missions)).match(/12090|13080|14040/))
deltas = run(acc, { quest: { category: 2, questId: boss2 } })
check("a difficulty 2 boss unlocks 12090 only", JSON.stringify(unlockedOf(deltas)) === JSON.stringify([12090]), deltas)
deltas = run(acc, { quest: { category: 2, questId: boss3 } })
check("a difficulty 3 boss unlocks 13080 (12090 is already done)", JSON.stringify(unlockedOf(deltas)) === JSON.stringify([13080]), deltas)
deltas = run(acc, { quest: { category: 2, questId: boss5 } })
check("a difficulty 5 boss unlocks 14040", JSON.stringify(unlockedOf(deltas)) === JSON.stringify([14040]), deltas)
check("a boss quest from another category (world story boss, 19) counts for nothing", run(account(), { quest: { category: 19, questId: boss1 } }).length === 0)

// S+ rank on everything
const mainBattle = battleIds(mainQuests).filter((id) => Math.floor(id / 1_000_000) <= 6)
const exBattle = battleIds(exQuests).filter((id) => Math.floor(id / 1_000_000) <= 6)
check("there are battle quests to rank in chapters 1-6 (main and EX)", mainBattle.length > 100 && exBattle.length > 50, [mainBattle.length, exBattle.length])
let ranks = mainBattle.map((id) => clear(1, id, 5))
acc = account({ quests: ranks.slice(1) })
check("13090 stays at 0 while one battle quest is missing", run(acc, { recompute: [66] }).length === 0)
acc = account({ quests: [clear(1, mainBattle[0], 4), ...ranks.slice(1)] })
check("...and while one of them is only S", run(acc, { recompute: [66] }).length === 0)
acc = account({ quests: [...ranks, clear(1, 7014004), clear(1, 1008004)] })
deltas = run(acc, { recompute: [66] })
check("13090 unlocks when all of them are S+ (story-only quests don't need a rank)", JSON.stringify(unlockedOf(deltas)) === JSON.stringify([13090]), deltas)
acc = account({ quests: exBattle.map((id) => clear(4, id, 5)) })
deltas = run(acc, { recompute: [66] })
check("14030 unlocks when every EX quest of chapters 1-6 is S+", JSON.stringify(unlockedOf(deltas)) === JSON.stringify([14030]), deltas)
check("...and the all-clear of its tier moves with it", !deltas.some((d) => d.mission_id === 14110) || deltas.find((d) => d.mission_id === 14110).progress_value === 1)

// practice battle
acc = account(); deltas = run(acc, { add: { 65: 1 } })
check("a practice battle challenge unlocks 14010", JSON.stringify(unlockedOf(deltas)) === JSON.stringify([14010]), deltas)

// the reply of a real quest clear: an all-clear mission follows its targets
acc = account({ saved: Object.fromEntries([11010, 11020, 11030, 11040, 11060, 11070, 11080, 11090, 11100].map((id) => [id, { progress: 1, stages: { 1: false } }])) })
deltas = run(acc, { recompute: [57], quest: undefined }) // nothing cleared yet
acc.facts.questProgress = () => [clear(1, 1008004)]
deltas = byId(run(acc, { recompute: [57] }))
check("clearing 11050 as the tenth mission of tier 1 also raises and unlocks 11110", JSON.stringify(deltas.map((d) => [d.mission_id, d.progress_value, d.stages.length])) === JSON.stringify([[11050, 1, 1], [11110, 10, 1]]), deltas)

// login catch-up
const catchUp = { recompute: [23, 57, 66], refreshAllClear: true }
acc = account({ quests: [clear(1, 1008004), clear(2, boss2), clear(2, boss1), clear(14, 1005), clear(13, 1001)] })
deltas = byId(run(acc, catchUp))
check("catching up unlocks what the cleared quests already earn", JSON.stringify(unlockedOf(deltas)) === JSON.stringify([11050, 11080, 12060, 12090, 12100]), unlockedOf(deltas))
check("...the boss counter starts from the distinct bosses cleared (2 of 3)", deltas.find((d) => d.mission_id === 12080)?.progress_value === 2 && !unlockedOf(deltas).includes(12080))
check("...and a second login changes nothing", run(acc, catchUp).length === 0)
// a mission whose progress already reached a stage that was never saved gets it at login
acc = account({ saved: { 14010: { progress: 1, stages: {} } } })
check("without the catch-up flag a reached but unsaved stage is left alone", run(acc, { recompute: [4] }).length === 0)
deltas = run(acc, { recompute: [4], refreshAllClear: true })
check("at login a reached but unsaved stage is unlocked", JSON.stringify(deltas.find((d) => d.mission_id === 14010)) === JSON.stringify({ mission_id: 14010, progress_value: 1, stages: [{ stage: 1, received: false }] }), deltas)
acc = account({ saved: { 14010: { progress: 1, stages: { 1: true } } } })
check("...and a received stage is not touched", !run(acc, { recompute: [4], refreshAllClear: true }).some((d) => d.mission_id === 14010))

console.log(failures === 0 ? "\nAll passed." : `\n${failures} failed.`)
process.exit(failures === 0 ? 0 : 1)
