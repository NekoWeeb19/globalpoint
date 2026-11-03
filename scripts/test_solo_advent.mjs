// Tests the single-player stand-ins for The Purge (src/lib/soloAdvent.ts) without a database.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_solo_advent.mjs

import { readFileSync } from "node:fs"
import { getEntryItem, isQuestOpen, planSoloAdvent, TICKETS_PER_DAY } from "../out/lib/soloAdvent.js"

const rules = JSON.parse(readFileSync(new URL("../assets/advent_event_rules.json", import.meta.url), "utf8"))
let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const at = iso => Date.parse(iso)
const fresh = { isHostCleared: () => false, lastTicketDay: () => null }

// data
const multiOnly = Object.entries(rules.quests).filter(([_, q]) => q.playMode === 2).map(([id]) => Number(id))
check("data: the multiplayer-only battles are the 15 Purgers of The Purge's 5 runs (3 global, 2 CN)", multiOnly.length === 15 && multiOnly.every(id => [200013, 200021, 200050, 200071, 200076].includes(Math.floor(id / 1000))), multiOnly)
check("data: the Empress tickets are 40314, 40323, 40335", JSON.stringify([200013009, 200021009, 200050009].map(id => getEntryItem(rules, id)?.id)) === "[40314,40323,40335]")
check("data: other boss battles have no ticket", getEntryItem(rules, 200013002) === null && getEntryItem(rules, 1002) === null)

// planning
const during = planSoloAdvent(rules, at("2024-05-01T12:00:00Z"), "day1", fresh)
check("open Purge: its 3 Purgers are cleared as host", JSON.stringify(during.hostClears.map(c => c.questId)) === "[200013002,200013005,200013006]", during.hostClears)
check("open Purge: one Empress ticket for the day", during.tickets.length === 1 && during.tickets[0].itemId === 40314 && during.tickets[0].count === TICKETS_PER_DAY, during.tickets)
const sameDay = planSoloAdvent(rules, at("2024-05-01T18:00:00Z"), "day1", { isHostCleared: () => true, lastTicketDay: () => "day1" })
check("same day again: nothing more", sameDay.hostClears.length === 0 && sameDay.tickets.length === 0, sameDay)
const nextDay = planSoloAdvent(rules, at("2024-05-02T12:00:00Z"), "day2", { isHostCleared: () => true, lastTicketDay: () => "day1" })
check("next day: one more ticket, no clears", nextDay.hostClears.length === 0 && nextDay.tickets.length === 1, nextDay)
const before = planSoloAdvent(rules, at("2024-04-01T12:00:00Z"), "d", fresh)
const after = planSoloAdvent(rules, at("2024-05-20T12:00:00Z"), "d", fresh)
check("before and after The Purge: nothing", before.hostClears.length + before.tickets.length + after.hostClears.length + after.tickets.length === 0, { before, after })
const rerun = planSoloAdvent(rules, at("2024-09-10T12:00:00Z"), "d", fresh)
check("the September rerun: its own Purgers and ticket (40323)", JSON.stringify(rerun.hostClears.map(c => c.questId)) === "[200021002,200021005,200021006]" && rerun.tickets[0]?.itemId === 40323, rerun)
check("window edges are inclusive", isQuestOpen(rules.quests["200013002"], at("2024-04-28T14:00:00Z")) && isQuestOpen(rules.quests["200013002"], at("2024-05-15T20:59:59Z")) && !isQuestOpen(rules.quests["200013002"], at("2024-05-15T21:00:00Z")))

console.log(failures === 0 ? "\nAll solo boss event tests passed." : `\n${failures} solo boss event test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
