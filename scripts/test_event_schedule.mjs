// Tests the event schedule (src/lib/eventSchedule.ts), the catalog (assets/event_catalog.json) and
// the game mod it builds (scripts/gen_event_schedule_mod.cjs), without touching the real schedule.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_event_schedule.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import os from "node:os"
import {
    parseMasterDate, formatMasterDate, formatServerDate, eventWindow, mapInstant, remapText,
    parseSchedule, checkEntry, planRowMoves, remapRecordDates, dateFields
} from "../out/lib/eventSchedule.js"

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..")
const catalog = JSON.parse(readFileSync(path.join(root, "assets", "event_catalog.json"), "utf8"))

let failed = 0
function check(name, ok, detail) {
    if (!ok) failed++
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
}
const DAY = 24 * 3600 * 1000, HOUR = 3600 * 1000

// Japan time
check("data dates are Japan time: 14:00 is 05:00 UTC", parseMasterDate("2023-11-26 14:00:00") === Date.parse("2023-11-26T05:00:00Z"))
check("and back", formatMasterDate(Date.parse("2023-11-26T05:00:00Z")) === "2023-11-26 14:00:00")
check("server copies are written in UTC", formatServerDate(Date.parse("2023-11-26T05:00:00Z")) === "2023-11-26 05:00:00")
check("impossible dates aren't dates", parseMasterDate("2023-02-30 10:00:00") === null)

// moving dates
const from = { start: 0, end: 10 * DAY, close: 17 * DAY }
const to = { start: 100 * DAY, end: 114 * DAY } // 14 days instead of 10
check("start moves to the new start", mapInstant(0, from, to) === 100 * DAY)
check("end becomes the new end", mapInstant(10 * DAY, from, to) === 114 * DAY)
check("a day-3 date keeps its distance from the start", mapInstant(3 * DAY, from, to) === 103 * DAY)
check("closing after the end keeps its distance from the end", mapInstant(17 * DAY, from, to) === 121 * DAY)
check("a date before the start keeps its distance", mapInstant(-DAY, from, to) === 99 * DAY)
const shorter = { start: 100 * DAY, end: 105 * DAY }
check("made shorter: later dates stop at the new end", mapInstant(8 * DAY, from, shorter) === 105 * DAY)

// a carnival row: start, end and close move together; other text stays
const carnival = catalog.events.find(e => e.key === "carnival_event:5")
check("carnival 5 is in the catalog", carnival !== undefined && carnival.name === "Hanifolk Carnival", carnival)
const window = eventWindow(carnival)
const newStart = Date.parse("2026-01-10T05:00:00Z")
const sameLength = { start: newStart, end: newStart + (window.end - window.start) }
const row = "haniwa_carnival_05,Hanifolk Carnival,,quest/event/banner/x,2023-11-26 14:00:00,2023-12-11 20:59:59,2023-12-19 04:59:59"
const moved = remapText(row, window, sameLength, formatMasterDate)
check("a row's dates all move", moved === "haniwa_carnival_05,Hanifolk Carnival,,quest/event/banner/x,2026-01-10 14:00:00,2026-01-25 20:59:59,2026-02-02 04:59:59", moved)
check("dates inside one field move too", remapText('"2023-11-26 14:00:00,2023-11-27 14:00:00,"', window, sameLength, formatMasterDate) === '"2026-01-10 14:00:00,2026-01-11 14:00:00,"')

// server records
const record = { name: "x", start: "2023-11-26 14:00:00", end: "2023-12-11 20:59:59", stock: 5 }
const original = dateFields(record)
check("date fields are found", JSON.stringify(Object.keys(original)) === '["start","end"]', original)
const move = { eventKey: carnival.key, from: window, to: sameLength }
remapRecordDates(record, original, move)
check("a server copy moves, in UTC", record.start === "2026-01-10 05:00:00" && record.end === "2026-01-25 11:59:59" && record.stock === 5, record)
remapRecordDates(record, original, undefined)
check("taking it off the schedule restores it", record.start === "2023-11-26 14:00:00" && record.end === "2023-12-11 20:59:59", record)

// schedule checks
const entry = { key: carnival.key, start: "2026-01-10T05:00:00.000Z", end: "2026-01-25T11:59:59.000Z", moveBanners: true }
check("a good entry passes", checkEntry(entry, catalog) === null)
check("unknown events are refused", checkEntry({ ...entry, key: "carnival_event:999" }, catalog) === "unknown event")
check("end before start is refused", checkEntry({ ...entry, end: "2026-01-01T00:00:00.000Z" }, catalog) !== null)
check("bad dates are refused", checkEntry({ ...entry, start: "soon" }, catalog) !== null)
check("the same event twice is refused", checkEntry(entry, catalog, [entry]) !== null)
const parsed = parseSchedule({ entries: [entry, { key: "nope" }] }, catalog)
check("loading keeps good entries and reports bad ones", parsed.schedule.entries.length === 1 && parsed.problems.length === 1, parsed)

// rows that move
const { moves, conflicts } = planRowMoves(catalog, { entries: [entry] })
const rowTotal = Object.values(carnival.rows).flat().length + Object.values(carnival.banners).flat().length
check("every row of the event moves (with its banners)", moves.size === rowTotal, { moves: moves.size, rowTotal })
check("no conflicts for one event", conflicts.length === 0, conflicts)
const noBanners = planRowMoves(catalog, { entries: [{ ...entry, moveBanners: false }] })
check("banners can stay behind", noBanners.moves.size === Object.values(carnival.rows).flat().length)

// catalog sanity: each event's own row, quests and (where it has them) missions are linked
const has = (ev, logical) => Object.entries(catalog.tables).some(([file, name]) => name === logical && (ev.rows[file] ?? []).length > 0)
check("every event links its own row", catalog.events.every(ev => has(ev, ev.family === "gacha" ? "master/gacha/gacha.orderedmap" : `master/quest/event/${ev.family}.orderedmap`)))
check("142 events in the catalog", catalog.events.filter(e => e.family !== "gacha").length === 142, catalog.events.length)
const banners = catalog.events.filter(e => e.family === "gacha")
check("244 summon banners (unit and armament)", banners.length === 244 && banners.some(b => b.bannerType === "armament") && banners.some(b => b.bannerType === "unit"), banners.length)

// a banner given its own dates keeps them when an event that opened with it is moved
const steambot = catalog.events.find(e => e.key === "advent_event:200014")
const [bannerFile, bannerPaths] = Object.entries(steambot.banners)[0]
const bannerKey = `gacha:${bannerPaths[0]}`
const bannerEntry = { key: bannerKey, start: "2027-01-01T00:00:00.000Z", end: "2027-01-08T00:00:00.000Z", moveBanners: false }
const eventEntry = { key: steambot.key, start: "2026-06-01T00:00:00.000Z", end: "2026-06-11T00:00:00.000Z", moveBanners: true }
const both = planRowMoves(catalog, { entries: [eventEntry, bannerEntry] })
check("a banner's own dates beat the event's", both.moves.get(`${bannerFile}#${bannerPaths[0]}`).eventKey === bannerKey)
check("and that is reported", both.conflicts.some(c => c.includes("Summons tab")), both.conflicts)
check("carnival 5 links its 9 quests, its missions and its shop",
    has(carnival, "master/quest/event/carnival_event_quest.orderedmap") && has(carnival, "master/mission/event_mission.orderedmap") && has(carnival, "master/shop/event_item_shop.orderedmap"))
const purge = catalog.events.find(e => e.key === "advent_event:200013")
const anniversary = catalog.events.find(e => e.key === "world_story_event:500005")
const story = Object.entries(catalog.tables).find(([, n]) => n === "master/quest/event/story_event_single_quest.orderedmap")[0]
check("the Purge doesn't take the 3rd anniversary's quests", !(purge.rows[story] ?? []).length && !(anniversary.rows[story] ?? []).length)

// the game mod: build it for one event into a temporary folder and read the carnival row back
const temp = mkdtempSync(path.join(os.tmpdir(), "event-schedule-"))
try {
    const scheduleFile = path.join(temp, "schedule.json"), outFile = path.join(temp, "event_schedule.zip")
    writeFileSync(scheduleFile, JSON.stringify({ entries: [entry] }))
    const log = execFileSync(process.execPath, [path.join(root, "scripts", "gen_event_schedule_mod.cjs"), scheduleFile, outFile], { cwd: root, encoding: "utf8" })
    check("the mod builds", /Wrote .*1 event\(s\) scheduled/.test(log), log)
    const unzipper = require("unzipper")
    const { decodeFile, leaves } = require(path.join(root, "scripts", "cdn_rows.cjs"))
    const archive = await unzipper.Open.file(outFile)
    // every catalog file, plus the free pull file and the stamina and reward campaign files (the yearly campaigns, src/lib/campaignSchedule.ts)
    check("the mod holds every catalog file, the free pull file and the 2 campaign files", archive.files.length === Object.keys(catalog.tables).length + 3, archive.files.length)
    const eventFile = Object.entries(catalog.tables).find(([, n]) => n === "master/quest/event/carnival_event.orderedmap")[0]
    const tree = decodeFile(await archive.files.find(f => f.path === eventFile).buffer())
    const carnivalRow = leaves(tree).find(l => l.path.join("/") === "5").leaf.text
    check("carnival 5 opens on its new date in the game's files", carnivalRow.includes("2026-01-10 14:00:00") && carnivalRow.includes("2026-01-25 20:59:59") && !carnivalRow.includes("2023-11-26"), carnivalRow.slice(-80))
    const other = leaves(tree).find(l => l.path.join("/") === "4").leaf.text
    check("other carnivals keep their dates", other.includes("2023-08-29 14:00:00"), other.slice(-80))
} finally {
    rmSync(temp, { recursive: true, force: true })
}

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`)
process.exit(failed === 0 ? 0 : 1)
