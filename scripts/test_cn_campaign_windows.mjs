// Tests scripts/cn_campaign_windows.cjs: a campaign mission group whose missions CN's calendar moved takes their
// window (the game's group table and the server's drop rules), one already holding them keeps its own. Offline.
//
//   node scripts/test_cn_campaign_windows.mjs
import fs from "fs"
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const CW = require("./cn_campaign_windows.cjs")
let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

// mission rows: group in column 0, the first two dates are the mission's window
const row = (group, from, until) => [group, "1", "pattern", "text", "39", from, until, from, until].join(",")
const windows = CW.missionWindows({
    a: row("1", "2023-11-22 12:00:00", "2023-12-06 11:59:59"),
    b: row("1", "2023-11-23 12:00:00", "2023-12-07 11:59:59"),
    c: row("80000", "2022-01-27 12:00:00", "2022-02-17 11:59:59"),
})
check("a group's missions' window: earliest start, latest end", windows["1"].from === "2023-11-22 12:00:00" && windows["1"].until === "2023-12-07 11:59:59", windows["1"])
check("a group on JP's dates takes its missions' (CN's) window", JSON.stringify(CW.alignedWindow("2020-02-21 12:00:00", "2020-03-05 11:59:59", windows["1"])) === JSON.stringify(["2023-11-22 12:00:00", "2023-12-07 11:59:59"]))
check("a group already holding its missions' start keeps its own (CN's own longer missions stay)", CW.alignedWindow("2022-01-27 12:00:00", "2022-02-10 11:59:59", windows["80000"]) === null)
check("no missions, nothing to change", CW.alignedWindow("2020-02-21 12:00:00", "2020-03-05 11:59:59", undefined) === null)

// where it's used
const builder = fs.readFileSync(new URL("./gen_cn_event_schedule.cjs", import.meta.url), "utf8")
check("the update builder aligns the game's group table", builder.includes("[CAMPAIGN_GROUPS]: (key, c) =>") && builder.includes("CW.missionWindows("))
const drops = fs.readFileSync(new URL("./gen_event_drops.cjs", import.meta.url), "utf8")
check("the CN drop rules use the same windows", drops.includes("CW.alignedWindow(e[20], e[21], campaignWindows[eventId])"))
const rules = JSON.parse(fs.readFileSync(new URL("../assets/event_drops_cn.json", import.meta.url), "utf8")).rules
check("Treasure Hunt 1 drops on CN's run (2023-11-22), not JP's (2020-02-21)", rules.filter(r => r.eventId === 1).every(r => r.start === "2023-11-22 04:00:00"))
check("Treasure Hunt 2 drops on CN's run (2024-01-04)", rules.filter(r => r.eventId === 2).every(r => r.start === "2024-01-04 04:00:00"))

console.log(failures ? `\n${failures} campaign window test(s) failed.` : "\nAll campaign window tests passed.")
process.exit(failures ? 1 : 0)
