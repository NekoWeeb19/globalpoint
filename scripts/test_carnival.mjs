// Tests the Hanifolk Carnival logic (src/lib/carnival.ts) without a database.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_carnival.mjs

import { readFileSync } from "node:fs"
import { carnivalTotalBestScore, scoreCarnivalClear, settleCarnivalClear } from "../out/lib/carnival.js"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
const data = JSON.parse(read("../assets/carnival_event.json"))
const serverQuests = JSON.parse(read("../assets/carnival_event_quest.json"))

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

// --- data -------------------------------------------------------------------------------------------
check("data: every carnival quest on the server has carnival data", Object.keys(serverQuests).every(id => data.quests[id]), Object.keys(serverQuests).filter(id => !data.quests[id]))
const byEvent = {}
for (const q of Object.values(data.quests)) (byEvent[q.eventId] ??= []).push(q)
check("data: every event has 3 folders of 3 difficulties", Object.values(byEvent).every(qs => qs.length === 9 && new Set(qs.map(q => q.folderId)).size === 3), Object.fromEntries(Object.entries(byEvent).map(([e, qs]) => [e, qs.length])))
check("data: every reward has a score and at least one slot", Object.values(data.rewards).every(r => r.score > 0 && r.rewards.length > 0))
const maxTotal = eventId => [1, 2, 3].reduce((sum, folder) => sum + Math.max(...Object.values(data.quests).filter(q => q.eventId === eventId && q.folderId === folder).map(q => q.difficultyScore + q.timeLimitMs)), 0)
check("data: every event's top reward can be reached", [...new Set(Object.values(data.quests).map(q => q.eventId))].every(e => Math.max(...Object.values(data.rewards).filter(r => r.eventId === e).map(r => r.score)) <= maxTotal(e)))

// --- scoring ----------------------------------------------------------------------------------------
const q1001 = data.quests["1001"] // difficulty 200000, 30 minutes
check("score: 1001 is folder 1, 200000 difficulty, 1800000 ms", q1001.folderId === 1 && q1001.difficultyScore === 200000 && q1001.timeLimitMs === 1800000, q1001)
const fast = scoreCarnivalClear(q1001, 300000)
check("score: a 5-minute clear scores 200000 + 1500000", fast.difficultyBonus === 200000 && fast.timeBonus === 1500000 && fast.total === 1700000, fast)
check("score: over the time limit gives no time bonus", scoreCarnivalClear(q1001, 9_999_999).timeBonus === 0)
check("score: a junk clear time gives no time bonus", scoreCarnivalClear(q1001, "abc").timeBonus === 0 && scoreCarnivalClear(q1001, -5).timeBonus === 0)

// --- settling ---------------------------------------------------------------------------------------
const none = new Set()
const first = settleCarnivalClear(data, 1001, 300000, [], none)
check("settle: first clear makes folder 1's best 1700000 and the total 1700000", first.folderId === 1 && first.folderBestScore === 1700000 && first.totalBestScore === 1700000 && first.previousTotalBestScore === 0, first)
const worse = settleCarnivalClear(data, 1001, 1_000_000, [{ folderId: 1, bestScore: 1700000 }], none)
check("settle: a worse run keeps the folder's best", worse.folderBestScore === 1700000 && worse.totalBestScore === 1700000, worse)
const otherFolder = settleCarnivalClear(data, 1004, 300000, [{ folderId: 1, bestScore: 1700000 }], none)
check("settle: a second folder adds to the total", otherFolder.folderId === 2 && otherFolder.totalBestScore === 3400000, otherFolder)
check("settle: not a carnival quest -> null", settleCarnivalClear(data, 424242, 1000, [], none) === null)
check("total: sum of folder bests", carnivalTotalBestScore([{ folderId: 1, bestScore: 5 }, { folderId: 2, bestScore: 7 }]) === 12)

// --- rewards ----------------------------------------------------------------------------------------
const event1 = Object.entries(data.rewards).filter(([_, r]) => r.eventId === 1).map(([id, r]) => ({ id: Number(id), score: r.score })).sort((a, b) => a.score - b.score)
const lowest = event1[0]
const records = [{ folderId: 1, bestScore: lowest.score - 1000 }]
const crossing = settleCarnivalClear(data, 1004, 0, records, none) // folder 2 at the time limit's full bonus
check(`rewards: crossing the lowest threshold (${lowest.score}) pays it`, crossing.rewardIds.includes(lowest.id), crossing.rewardIds)
check("rewards: only rewards of this event, in score order", crossing.rewardIds.every(id => data.rewards[id].eventId === 1) && crossing.rewardIds.every((id, i, a) => i === 0 || data.rewards[a[i - 1]].score <= data.rewards[id].score))
check("rewards: nothing above the total is paid", crossing.rewardIds.every(id => data.rewards[id].score <= crossing.totalBestScore))
const again = settleCarnivalClear(data, 1004, 0, [{ folderId: 1, bestScore: lowest.score - 1000 }, { folderId: 2, bestScore: crossing.folderBestScore }], new Set(crossing.rewardIds))
check("rewards: paid rewards are never paid again", again.rewardIds.every(id => !crossing.rewardIds.includes(id)) && again.rewardIds.length === 0, again.rewardIds)
check("popup: with nothing back-paid, the previous total is the real one", crossing.popupPreviousTotalBestScore === crossing.previousTotalBestScore)
const backfill = settleCarnivalClear(data, 1001, 9_999_999, [{ folderId: 1, bestScore: lowest.score + 10 }], none)
check("popup: a reward below the old total paid now lowers the previous total to just under it", backfill.rewardIds.includes(lowest.id) && backfill.popupPreviousTotalBestScore === lowest.score - 1, backfill)

console.log(failures === 0 ? "\nAll carnival tests passed." : `\n${failures} carnival test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
