// Tests the ticking server time (src/lib/serverClock.ts) and the rotation's ticking option.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_server_clock.mjs

import { parseClockConfig, parseSavedClock, serializeClock, tickedTime, withRealTimeOfDay } from "../out/lib/serverClock.js"
import { createBannerRotation } from "../out/lib/bannerRotation.js"

let failed = 0
function check(name, ok, detail) {
    if (!ok) failed++
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
}

const HOUR = 3600 * 1000

// settings
check("ticking is off by default", parseClockConfig({}).ticking === false)
check("SERVER_TIME_TICKS=true turns it on", parseClockConfig({ SERVER_TIME_TICKS: " True " }).ticking === true)
check("other values leave it off", parseClockConfig({ SERVER_TIME_TICKS: "nope" }).ticking === false)

// ticking
const set = Date.parse("2024-06-02T12:00:00Z")
check("3 real hours later the date is 3 hours on", tickedTime(set, 1000, 1000 + 3 * HOUR) === set + 3 * HOUR)
check("at the moment it was set the date is unchanged", tickedTime(set, 5000, 5000) === set)
check("a clock moved backwards doesn't go back in time", tickedTime(set, 5000, 1000) === set)

// saving
const saved = { serverMs: set, realMs: 123, pinned: true }
const round = parseSavedClock(serializeClock(saved))
check("a saved clock reads back the same", JSON.stringify(round) === JSON.stringify(saved), round)
check("real time (null date) saves too", parseSavedClock(serializeClock({ serverMs: null, realMs: 1, pinned: false }))?.serverMs === null)
check("broken text is rejected", parseSavedClock("{oops") === null)
check("a missing field is rejected", parseSavedClock('{"serverMs":1,"realMs":2}') === null)
check("a non-number date is rejected", parseSavedClock('{"serverMs":"x","realMs":2,"pinned":false}') === null)

// banner rotation
const banners = {
    "1": { type: 0, startDate: "2024-01-01 00:00:00", endDate: "2024-01-10 00:00:00" },
    "2": { type: 0, startDate: "2024-01-05 00:00:00", endDate: "2024-01-20 00:00:00" }
}
let now = 1_000_000
const options = { banners, stepHours: 24, stateFile: null, now: () => now }
const frozen = createBannerRotation(options)
const ticking = createBannerRotation({ ...options, ticking: true })
const step1 = Date.parse("2024-01-01T01:00:00Z")

check("rotation starts one hour after the step's banner", ticking.getDate().getTime() === step1)
now += 5 * HOUR
check("frozen rotation stays on the step's date", frozen.getDate().getTime() === step1)
check("ticking rotation counts up 5 hours", ticking.getDate().getTime() === step1 + 5 * HOUR)
check("status says it ticks", ticking.status().ticking === true && frozen.status().ticking === false)
now += 19 * HOUR + 1
check("after the step's 24 hours it moves to the next banner's start",
    ticking.getDate().getTime() === Date.parse("2024-01-05T01:00:00Z") + 1, ticking.getDate().toISOString())
ticking.skip(1)
check("skipping restarts the count at the new step", ticking.getDate().getTime() === step1)

// matching the real time of day (the dashboard's "Match real time" button)
const matched = withRealTimeOfDay(Date.parse("2026-01-02T14:19:31.545Z"), Date.parse("2026-10-30T20:53:28.900Z"))
check("match real time: keeps the server date, takes the real time of day", new Date(matched).toISOString() === "2026-01-02T20:53:28.000Z", new Date(matched).toISOString())
const late = withRealTimeOfDay(Date.parse("2026-01-02T23:59:00Z"), Date.parse("2026-10-30T00:10:00Z"))
check("match real time: the date never moves (even near midnight)", new Date(late).toISOString() === "2026-01-02T00:10:00.000Z", new Date(late).toISOString())

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`)
process.exit(failed === 0 ? 0 : 1)
