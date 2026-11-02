// Tests the Time Attack ranking logic (src/lib/rankingEvent.ts) without a database.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_ranking.mjs

import { readFileSync } from "node:fs"
import { RANKING_TIME_BORDERS_MS, RANKING_TOP_TIMES_MS, placeRankingTime, tierForPercentage } from "../out/lib/rankingEvent.js"

const data = JSON.parse(readFileSync(new URL("../assets/ranking_event.json", import.meta.url), "utf8"))
let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const LETTERS = ["S+", "S", "A", "B", "C", "D", "E", "F", "G"]
const ms = (m, s) => Math.round((m * 60 + s) * 1000)
const place = (eventId, m, s) => placeRankingTime(data.events[eventId], eventId, ms(m, s))
const letter = p => LETTERS[p.tierIndex]

// data
check("data: 5 Trials (Water, Light, Wind, Thunder, Fire), quests 1001..5001", JSON.stringify(Object.values(data.events).map(e => e.questId)) === "[1001,2001,3001,4001,5001]")
check("data: every Trial has 9 tiers ending at 100%", Object.values(data.events).every(e => e.tiers.length === 9 && e.tiers[8].border === 1))
check("data: Water's tiers are 3/5/10/20/30/40/50/70/100%", data.events["1"].tiers.map(t => t.border * 100).map(Math.round).join("/") === "3/5/10/20/30/40/50/70/100")
check("data: S+ pays 50 Lilie Awards and 1,500 beads", data.events["1"].tiers[0].rewards.some(r => r.kind === 0 && r.id === 49100 && r.amount === 50) && data.events["1"].tiers[0].rewards.some(r => r.kind === 2 && r.amount === 1500))
for (const [id, borders] of Object.entries(RANKING_TIME_BORDERS_MS)) {
    check(`borders: Trial ${id} has 8 increasing borders, slower than its top time`, borders.length === 8 && borders.every((b, i) => i === 0 || b > borders[i - 1]) && borders[0] > RANKING_TOP_TIMES_MS[id])
}

// the community screenshots and posts
const cases = [
    [1, 2, 1.43, "S", "Water 2:01.43 was S (4.7%)"],
    [1, 2, 10.61, "A", "Water 2:10.61 was A (5.1%, next border 2:10.37)"],
    [1, 5, 8.51, "C", "Water 5:08.51 was C (25.0%)"],
    [1, 7, 57.64, "D", "Water 7:57.64 was D (32.7%)"],
    [1, 3, 38.09, "B", "Water 3:38.09 (KR, 22.8% C mid-event) is B with the final B border 4:07"],
    [2, 2, 38.55, "B", "Light 2:38.55 was B (18.6%)"],
    [2, 3, 30, "C", "Light 3:30 was C"],
    [3, 1, 51.48, "B", "Wind 1:51.48 was B"],
    [4, 2, 24.29, "B", "Thunder 2:24.29 was B (11.6%)"],
    [5, 0, 6.54, "S+", "Fire's top time is S+"],
]
for (const [eventId, m, s, expected, name] of cases) {
    const p = place(eventId, m, s)
    check(`${name}: ${letter(p)} at ${p.rankPercentage}%`, letter(p) === expected, p)
}
check("Water 5:08.51 sits near 25% (got " + place(1, 5, 8.51).rankPercentage + "%)", Math.abs(place(1, 5, 8.51).rankPercentage - 25) < 2)
check("Thunder 2:24.29 sits near 11.6% (got " + place(4, 2, 24.29).rankPercentage + "%)", Math.abs(place(4, 2, 24.29).rankPercentage - 11.6) < 2)

// borders, next border, extremes
check("exactly on a border counts as that rank (Water 4:07.15 is B)", letter(place(1, 4, 7.15)) === "B")
check("just over a border is the next rank (Water 4:07.16 is C)", letter(place(1, 4, 7.16)) === "C")
check("next rank border: Water C shows B's 4:07.15", place(1, 5, 8.51).nextBorderMs === ms(4, 7.15))
check("next rank border: S+ shows the top time", place(1, 1, 0).nextBorderMs === RANKING_TOP_TIMES_MS[1])
check("faster than the top time is 0.5%, never 0", place(1, 0, 10).rankPercentage === 0.5)
check("very slow is G at no more than 100%", letter(place(1, 60, 0)) === "G" && place(1, 60, 0).rankPercentage <= 100)
check("no time, no placement", placeRankingTime(data.events["1"], 1, 0) === null && placeRankingTime(data.events["1"], 1, NaN) === null)
check("an event with no borders has no placement", placeRankingTime(data.events["1"], 99, 60000) === null)

// what the client shows is what gets paid, for every time from 1 s to 30 min
let mismatches = 0, lastIndex = 0, monotonic = true
for (const eventId of [1, 2, 3, 4, 5]) {
    lastIndex = 0
    let lastPercent = 0
    for (let t = 1000; t <= 30 * 60000; t += 37) {
        const p = placeRankingTime(data.events[eventId], eventId, t)
        if (tierForPercentage(data.events[eventId], p.rankPercentage) !== p.tierIndex) mismatches++
        if (p.tierIndex < lastIndex || p.rankPercentage < lastPercent) monotonic = false
        lastIndex = p.tierIndex
        lastPercent = p.rankPercentage
    }
}
check("the client's rank (from the percentage) always equals the paid tier", mismatches === 0, mismatches)
check("slower times never rank higher", monotonic)

console.log(failures === 0 ? "\nAll ranking tests passed." : `\n${failures} ranking test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
