// CN's real calendar (scripts/cn_calendar.cjs, assets/cn_calendar_dates.json) on the CN game files: rows on CN's own
// dates, events CN never ran in 2020, the fork's reused ids left alone, raw reads untouched. Needs the CN game files
// (CN_CDN_DIR, as scripts/run_tests_full.cjs sets); skips without them.
//   node --env-file=.env scripts/test_cn_calendar.mjs
import fs from "fs"
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const { cnDir } = require("./cn_archives.cjs")
if (!fs.existsSync(cnDir())) { console.log(`SKIP no CN game files at ${cnDir()}`); process.exit(0) }
const R = require("./cn_read.cjs")
const CAL = require("./cn_calendar.cjs")
const D = JSON.parse(fs.readFileSync(new URL("../assets/cn_calendar_dates.json", import.meta.url), "utf8"))

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const dates = text => (text ?? "").match(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/g) ?? []

const story = await R.readCnTable("master/quest/event/story_event.orderedmap")
const storyRaw = await R.readCnTable("master/quest/event/story_event.orderedmap", { raw: true })
const advent = await R.readCnTable("master/quest/event/advent_event.orderedmap")
const adventRaw = await R.readCnTable("master/quest/event/advent_event.orderedmap", { raw: true })
const gacha = await R.readCnTable("master/gacha/gacha.orderedmap")

// CN's own dates (Bilibili: Valentine's Fest from 2021-12-09, the first boss event 2021-11-18)
check("Valentine's Fest (story 100003) on CN's 2021-12-09", dates(story["100003"])[0] === "2021-12-09 12:00:00", dates(story["100003"]))
check("raw read keeps the CN files' date", dates(storyRaw["100003"])[0] === "2020-01-31 12:00:00", dates(storyRaw["100003"]))
check("first boss event (advent 1) on CN's 2021-11-18", dates(advent["1"])[0] === "2021-11-18 12:00:00", dates(advent["1"]))
// the fork reused these ids for other events: our rows keep their own (announced) dates
for (const id of ["100005", "100006", "100007", "100008", "100009"]) check(`advent ${id} keeps its own dates`, dates(advent[id]).join() === dates(adventRaw[id]).join(), dates(advent[id]))
// events CN never ran start in 2020 or earlier and close before CN's paid test
for (const [name, t, id] of [["Black Clover (advent 300001)", advent, "300001"], ["JP's 800-day quests (story 200025)", story, "200025"], ["Towa Kiseki (story 300001)", story, "300001"]]) {
    const d = dates(t[id]).filter(x => x < "2030")
    check(`${name} in the JP-only year`, d.length > 0 && d[0] < "2021" && d.every(x => x <= CAL.JP_ONLY_END), d)
}
check("ticket-only portal 4 closes before CN's paid test", dates(gacha["4"])[1] === CAL.JP_ONLY_END, dates(gacha["4"]))
check("Launch Gala (1) runs CN's paid test to 2021-11-04", dates(gacha["1"])[0] === "2021-08-17 10:00:00" && dates(gacha["1"])[1] === "2021-11-04 11:59:59", dates(gacha["1"]))

// every hidden row: no real date after the paid test, and its event moved no further than 2020
let late = 0
for (const id of D.hidden) {
    const at = id.indexOf(" "), logical = id.slice(0, at), key = id.slice(at + 1)
    const t = await R.readCnTable(logical)
    if (dates(t?.[key]).some(d => d >= "2013" && d > CAL.JP_ONLY_END)) late++
}
check("no hidden row has a date after CN's paid test", late === 0, late)

// applying twice changes nothing more (only cells still holding the CN files' date change)
const { decodeFile, encodeFile } = require("./cdn_rows.cjs")
const file = R.hashed("master/quest/event/story_event.orderedmap")
const once = await R.readCn("master/quest/event/story_event.orderedmap")
const tree = decodeFile(once)
check("applying the calendar twice changes nothing", CAL.applyToTree(file, tree) === 0 && encodeFile(tree).equals(once))
check("the builder ships every calendar table", CAL.FILES.length >= Object.keys(D.tables).length)

if (failures > 0) { console.log(`${failures} check(s) failed.`); process.exit(1) }
console.log("All CN calendar tests passed.")
