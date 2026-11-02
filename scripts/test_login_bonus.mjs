// Tests the login bonus logic (src/lib/loginBonus.ts) without a database.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_login_bonus.mjs

import { readFileSync } from "node:fs"
import { isLoginBonusGroupOpen, loginPaidBeads, loginPaidBeadsSetting, openLoginBonusGroups, settleLoginBonus } from "../out/lib/loginBonus.js"

const data = JSON.parse(readFileSync(new URL("../assets/login_bonus.json", import.meta.url), "utf8"))
let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const at = s => Date.parse(s + "Z")
const ids = grants => grants.map(g => `${g.groupId}:${g.index}`).join(" ")

// data
check("data: 42 groups, every day has rewards", Object.keys(data.groups).length === 42 && Object.values(data.groups).every(g => g.days.length > 0 && g.days.every(d => d.length > 0)))
check("data: normal_2022 is a 4-day Normal loop starting 2024-01-17 05:00", data.groups.normal_2022.type === "Normal" && data.groups.normal_2022.days.length === 4 && data.groups.normal_2022.start === "2024-01-17 05:00:00")
check("data: goodbye_login gives 600 beads a day for 59 days", data.groups.goodbye_login.days.length === 59 && data.groups.goodbye_login.days[0][0].kind === 0 && data.groups.goodbye_login.days[0][0].amount === 600)

// which groups are open
check("open: 2024-06-07 is goodbye_login then normal_2022 (as recorded on global)", JSON.stringify(openLoginBonusGroups(data, at("2024-06-07T20:51:51"))) === JSON.stringify(["goodbye_login", "normal_2022"]), openLoginBonusGroups(data, at("2024-06-07T20:51:51")))
check("open: anv3_present (ActiveUser) closed by 2024-06-07 (ended 06-04)", !openLoginBonusGroups(data, at("2024-06-07T20:51:51")).includes("anv3_present"))
check("open: 2023-01-01 is gw21 (New Year) + normal_2020", JSON.stringify(openLoginBonusGroups(data, at("2023-01-01T12:00:00"))) === JSON.stringify(["gw21", "normal_2020"]), openLoginBonusGroups(data, at("2023-01-01T12:00:00")))
check("open: Normal switches 2020 -> 2022 at 2024-01-17 05:00", openLoginBonusGroups(data, at("2024-01-17T04:59:00")).includes("normal_2020") && openLoginBonusGroups(data, at("2024-01-17T05:00:00")).includes("normal_2022") && !openLoginBonusGroups(data, at("2024-01-17T05:00:00")).includes("normal_2020"))
check("open: exactly one Normal group at a time", [at("2022-03-01T00:00:00"), at("2023-06-01T00:00:00"), at("2024-06-01T00:00:00")].every(t => openLoginBonusGroups(data, t).filter(id => data.groups[id].type === "Normal").length === 1))
check("open: Comeback groups are never given", Object.entries(data.groups).filter(([_, g]) => g.type.startsWith("Comeback")).every(([id, g]) => !openLoginBonusGroups(data, at(g.start.replace(" ", "T")) + 3600e3).includes(id)))
const yearly = { ...data.groups.login_bonus_gw }
check("open: a yearly-window group is open only inside its window", isLoginBonusGroupOpen(yearly, at("2025-05-01T00:00:00")) && !isLoginBonusGroupOpen(yearly, at("2025-06-01T00:00:00")))

// settling
const t = at("2023-01-01T12:00:00")
const day1 = settleLoginBonus(data, t, 100, {})
check("settle: first login gives day 1 of each open group: " + ids(day1), ids(day1) === "gw21:1 normal_2020:1")
check("settle: same real day again gives nothing", settleLoginBonus(data, t, 100, { gw21: { lastIndex: 1, lastDay: 100 }, normal_2020: { lastIndex: 1, lastDay: 100 } }).length === 0)
check("settle: an earlier real day (clock turned back) gives nothing", settleLoginBonus(data, t, 99, { normal_2020: { lastIndex: 1, lastDay: 100 } }).length === 0)
const day2 = settleLoginBonus(data, t, 101, { gw21: { lastIndex: 1, lastDay: 100 }, normal_2020: { lastIndex: 1, lastDay: 100 } })
check("settle: next real day gives day 2: " + ids(day2), ids(day2) === "gw21:2 normal_2020:2")
check("settle: Normal loops after its last day", settleLoginBonus(data, t, 200, { normal_2020: { lastIndex: 14, lastDay: 150 } }).find(g => g.groupId === "normal_2020").index === 1)
check("settle: a finished Limited group stops", !settleLoginBonus(data, t, 200, { gw21: { lastIndex: 12, lastDay: 150 } }).some(g => g.groupId === "gw21"))
check("settle: rewards are the day's rewards", JSON.stringify(day1.find(g => g.groupId === "normal_2020").rewards) === JSON.stringify(data.groups.normal_2020.days[0]))
check("settle: no open group, nothing", settleLoginBonus(data, at("2010-01-01T00:00:00"), 100, {}).length === 0)

// paid beads added to the everyday bonus (server addition)
check("paid beads: 150 by default, the .env value when valid", loginPaidBeadsSetting(undefined) === 150 && loginPaidBeadsSetting("") === 150 && loginPaidBeadsSetting("300") === 300 && loginPaidBeadsSetting("0") === 0)
check("paid beads: a bad .env value falls back to 150", loginPaidBeadsSetting("abc") === 150 && loginPaidBeadsSetting("-5") === 150 && loginPaidBeadsSetting("1.5") === 150 && loginPaidBeadsSetting("999999") === 150)
const now22 = at("2026-10-30T12:00:00")
const loop = [1, 2, 3, 4].map(day => settleLoginBonus(data, now22, 500 + day, { normal_2022: { lastIndex: day - 1, lastDay: 499 + day } }))
check("paid beads: every day of normal_2022 (1-4) adds 150", loop.every(g => loginPaidBeads(g, 150) === 150) && loop.map(g => g.find(x => x.groupId === "normal_2022").index).join() === "1,2,3,4")
check("paid beads: the day's own rewards are unchanged", loop.every((g, i) => JSON.stringify(g.find(x => x.groupId === "normal_2022").rewards) === JSON.stringify(data.groups.normal_2022.days[i])))
check("paid beads: event-only grants or none add nothing", loginPaidBeads([{ groupId: "gw21", type: "Limited", index: 1, rewards: [] }], 150) === 0 && loginPaidBeads([], 150) === 0)

console.log(failures === 0 ? "\nAll login bonus tests passed." : `\n${failures} login bonus test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
