// Tests the active mission claim logic (src/lib/activeMission.ts) without a database.
//
// Run `npm run build` first, because this loads the compiled code from out/:
//   node scripts/test_active_mission.mjs
//
// It also checks assets/active_missions.json, and replays the claim recorded from the real global
// server (docs/global/routes/active_mission_receive.md) to make sure the response is identical.

import assert from "node:assert"
import { readFileSync } from "node:fs"
import { claimActiveMissions } from "../out/lib/activeMission.js"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const file = JSON.parse(read("../assets/active_missions.json"))
const data = { missions: file.missions }

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

// A fake account: the store and wallet the claim logic talks to.
function account({ progress = {}, items = {}, mana = 0, exp = 0, beads = 0 } = {}) {
    const missions = {}
    for (const [id, value] of Object.entries(progress)) missions[id] = { progress: value, stages: { 1: false } }
    const state = { items: { ...items }, mana, exp, beads }
    state.store = {
        getMission: (id) => missions[String(id)] ?? null,
        markStageReceived: (id, stage, value) => {
            missions[String(id)] = { progress: value, stages: { ...missions[String(id)]?.stages, [stage]: true } }
        }
    }
    state.wallet = {
        addItem: (id, amount) => (state.items[id] = (state.items[id] ?? 0) + amount),
        addFreeVmoney: (amount) => (state.beads += amount),
        addFreeMana: (amount) => (state.mana += amount),
        addExpPool: (amount) => (state.exp += amount)
    }
    return state
}

// ---- the data file ----
const missionIds = Object.keys(data.missions)
check("44 missions", missionIds.length === 44, missionIds.length)
const kinds = new Set(["item", "free_vmoney", "free_mana", "exp_pool"])
const badRewards = []
const badRequirements = []
for (const [id, mission] of Object.entries(data.missions)) {
    for (const [stage, rewards] of Object.entries(mission.stages)) {
        if (!Array.isArray(rewards) || rewards.length === 0) badRewards.push(`${id}/${stage}: no rewards`)
        for (const reward of rewards) {
            if (!kinds.has(reward.type)) badRewards.push(`${id}/${stage}: unknown type ${reward.type}`)
            if (!Number.isInteger(reward.amount) || reward.amount <= 0) badRewards.push(`${id}/${stage}: bad amount`)
            if (reward.type === "item" && !Number.isInteger(reward.id)) badRewards.push(`${id}/${stage}: item without an id`)
        }
        const required = file.requirements?.[id]?.[stage]
        if (!Number.isInteger(required) || required < 1) badRequirements.push(`${id}/${stage}`)
    }
}
check("every reward is a known kind with a positive amount (items have an id)", badRewards.length === 0, badRewards)
check("every stage has a required progress (used by the unlock tool)", badRequirements.length === 0, badRequirements)

// ---- replay the recorded global claim ----
const doc = read("../docs/global/routes/active_mission_receive.md")
const blocks = [...doc.matchAll(/```\n([\s\S]*?)\n```/g)].map((match) => match[1])
const recordedRequest = JSON.parse(blocks.find((b) => b.includes('"active_mission_list"') && !b.includes("data_headers")))
const recorded = JSON.parse(blocks.find((b) => b.includes("data_headers"))).data

// Start values chosen so the totals end where the recording does.
let acc = account({ progress: { 11010: 1, 11020: 1, 11070: 2, 11090: 1 }, items: { 100000: 300 }, mana: 2528 })
let result = claimActiveMissions(data, acc.store, acc.wallet, recordedRequest.active_mission_list)
const produced = {
    active_mission_list: result.active_mission_list,
    user_info: { ...result.user_info, exp_pooled_time: recorded.user_info.exp_pooled_time }, // the route adds this one
    item_list: result.item_list,
    mail_arrived: false
}
let identical = true
try { assert.deepStrictEqual(JSON.parse(JSON.stringify(produced)), recorded) } catch { identical = false }
check("the recorded claim gives the recorded response", identical, { produced, recorded })

// ---- claiming again, odd input, duplicates ----
const totals = JSON.stringify([acc.items, acc.mana, acc.exp])
result = claimActiveMissions(data, acc.store, acc.wallet, recordedRequest.active_mission_list)
check("claiming again pays nothing", JSON.stringify([acc.items, acc.mana, acc.exp]) === totals && result.active_mission_list.length === 4, result)

acc = account({ progress: { 11010: 1 } })
result = claimActiveMissions(data, acc.store, acc.wallet, [
    { mission_id: 99999, stages: [1] }, { mission_id: 11010, stages: [7] }, { mission_id: "x", stages: [1] }, { mission_id: 11010 }, null
])
check("unknown missions and stages, and junk, are skipped and pay nothing", result.active_mission_list.length === 0 && Object.keys(acc.items).length === 0, result)

acc = account({ progress: { 11010: 1 } })
claimActiveMissions(data, acc.store, acc.wallet, [{ mission_id: 11010, stages: [1, 1, "1"] }])
check("a stage listed twice in one entry pays once", acc.items[101] === 5, acc.items)

// a store that keeps a snapshot and never updates it, like the real adapter's
acc = account({ progress: { 11010: 1 } })
const snapshot = { 11010: { progress: 1, stages: { 1: false } } }
const staleStore = { getMission: (id) => snapshot[id] ?? null, markStageReceived: () => { } }
claimActiveMissions(data, staleStore, acc.wallet, [{ mission_id: 11010, stages: [1] }, { mission_id: 11010, stages: [1] }])
check("the same mission listed in two entries pays once", acc.items[101] === 5, acc.items)

acc = account()
claimActiveMissions(data, acc.store, acc.wallet, [{ mission_id: 11110, stages: [1] }, { mission_id: 12010, stages: [1] }, { mission_id: 13090, stages: [1] }])
check("beads, mana and items are all paid", acc.beads === 300 && acc.mana === 5000 && acc.items[3] === 5 && acc.items[7] === 5 && acc.items[11] === 5, acc)

console.log(failures === 0 ? "\nAll passed." : `\n${failures} failed.`)
process.exit(failures === 0 ? 0 : 1)
