// Tests the treasure hunt / collect item event drops (src/lib/eventDrops.ts) against the global data,
// without a database.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_event_drops.mjs

import { readFileSync } from "node:fs"
import { eventDropItems, eventDrops, questEnemyLevel } from "../out/lib/eventDrops.js"

const data = JSON.parse(readFileSync(new URL("../assets/event_drops.json", import.meta.url), "utf8"))
let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const at = s => Date.parse(s + "Z")
const cleared = () => true
const during1 = at("2021-10-25T12:00:00") // Treasure Hunter event 1 (2021-10-18 14:00 to 10-31 13:59 UTC)
const total = drops => drops.reduce((n, d) => n + d.number, 0)

// data
check("data: 314 single-item groups, 1066 rules from 17 events", Object.keys(data.groups).length === 314 && data.rules.length === 1066 && new Set(data.rules.map(r => r.eventId)).size === 17)
check("data: enemy levels (boss 1001001 = 10, main 1001002 present, Kaleidoscope 'Lv 30' = 30)", questEnemyLevel(data, 2, 1001001) === 10 && questEnemyLevel(data, 1, 1001002) !== null && questEnemyLevel(data, 6, 1003) === 30)
check("data: 'Labyrinth: Beginner' has no level", questEnemyLevel(data, 6, 19001) === null)

// boss battles, event 1: tiers 0/20/50/70/80 -> 100/200/240/290/400 Kaleido Drops (80001)
const lv80 = Object.entries(data.enemyLevels["2"]).find(([_, l]) => l === 80)
const boss80 = eventDrops(data, 2, Number(lv80[0]), during1, cleared)
check(`boss lv 80 (${lv80[0]}): every tier at or below 80 -> 1230 drops`, boss80.length === 5 && total(boss80) === 1230, boss80)
const boss10 = eventDrops(data, 2, 1001001, during1, cleared)
check("boss lv 10: the level-0 tier only -> 100", boss10.length === 1 && boss10[0].number === 100 && boss10[0].group_id === 200007, boss10)
check("drop shape is the client's (group_id, index, number)", JSON.stringify(Object.keys(boss10[0])) === JSON.stringify(["group_id", "index", "number"]))
check("items: 80001 x1230 for lv 80", JSON.stringify([...eventDropItems(data, boss80)]) === JSON.stringify([[80001, 1230]]))

// main story chapter 3 (range 0, chapter 3) -> group 200009, 50 drops
const ch3 = Object.keys(data.enemyLevels["1"]).find(id => id.startsWith("3"))
const main3 = eventDrops(data, 1, Number(ch3), during1, cleared)
check(`main chapter 3 (${ch3}) -> 50`, main3.length === 1 && main3[0].group_id === 200009 && main3[0].number === 50, main3)

// boosts and campaigns
check("boost (x2) doubles each tier", total(eventDrops(data, 2, 1001001, during1, cleared, 2)) === 200)
check("1.5x campaign rounds down per tier", total(eventDrops(data, 2, Number(lv80[0]), during1, cleared, 1.5)) === [100, 200, 240, 290, 400].reduce((n, x) => n + Math.floor(x * 1.5), 0))

// when nothing drops
check("outside every event: nothing", eventDrops(data, 2, 1001001, at("2021-10-01T00:00:00"), cleared).length === 0)
check("event ends 13:59:59 UTC: included then, not a second later", eventDrops(data, 2, 1001001, at("2021-10-31T13:59:59"), cleared).length === 1 && eventDrops(data, 2, 1001001, at("2021-10-31T14:00:00"), cleared).length === 0)
check("first-clear quest (main 1004002) not cleared: nothing", eventDrops(data, 2, 1001001, during1, (s, q) => !(s === 1 && q === 1004002)).length === 0)
check("a quest with no enemy level: nothing", eventDrops(data, 6, 19001, during1, cleared).length === 0)
check("an unknown quest: nothing", eventDrops(data, 2, 9999999, during1, cleared).length === 0)
check("practice (section 15) isn't in event 1: nothing", eventDrops(data, 15, 1, during1, cleared).length === 0)

console.log(failures === 0 ? "\nAll event drop tests passed." : `\n${failures} event drop test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
