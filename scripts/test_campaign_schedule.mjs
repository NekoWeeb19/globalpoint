// Tests the yearly seasonal campaigns (src/lib/campaignSchedule.ts), the per-year login bonus runs
// (src/lib/loginBonus.ts) and the game mod rows they make (scripts/gen_event_schedule_mod.cjs),
// without touching the real schedules.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_campaign_schedule.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import os from "node:os"
import {
    parseCampaignSchedule, yearlyLoginColumns, yearlyLoginServerColumns, freePullCopies, freePullClash,
    isFreePullBanner, activeFreePullCopy, freePullCopyRow, currentOrNextRun, SEASONAL_LOGIN_BONUSES, SEASONAL_FREE_PULLS,
    campaignRuns, runCopies, yearlyClash, campaignCopyId, describeRun, isWindowOn
} from "../out/lib/campaignSchedule.js"
import { isLoginBonusGroupOpen, loginBonusProgressKey, loginBonusGroupOfKey, settleLoginBonus } from "../out/lib/loginBonus.js"

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..")
const seasonal = JSON.parse(readFileSync(path.join(root, "assets", "seasonal_campaigns.json"), "utf8"))
const loginData = JSON.parse(readFileSync(path.join(root, "assets", "login_bonus.json"), "utf8"))
const gachas = JSON.parse(readFileSync(path.join(root, "assets", "gacha.json"), "utf8"))

let failed = 0
function check(name, ok, detail) {
    if (!ok) failed++
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
}
const at = s => Date.parse(s + "Z") // UTC
const campaign = id => seasonal.freePulls.find(c => c.id === id)

// data
check("16 seasonal login bonuses, all with dates and pictures", Object.keys(seasonal.loginBonuses).length === 16 && Object.values(seasonal.loginBonuses).every(b => b.start && b.end && b.image))
check("anniversary, collab and story bonuses aren't seasonal", ["anv2020", "anv2021", "anv2022", "anv1half", "halfanv2020", "anv2half", "anv2half2", "rcollab_event", "zcollab_event", "ucollab_01", "chapter10_fin", "hw_v22", "start_dash", "goodbye_login"].every(id => !(id in SEASONAL_LOGIN_BONUSES)))
check("all 19 free pull campaigns are read", seasonal.freePulls.length === 19 && campaign(14).banners.join() === "116", campaign(14))
check("anniversary and story free pulls aren't seasonal", [1, 2, 3, 6, 7, 10, 11, 12, 16, 18, 19, 20].every(id => !(id in SEASONAL_FREE_PULLS)))

// saved choices
const parsed = parseCampaignSchedule({ yearlyLoginBonuses: ["gw22", "anv2020", "gw22"], yearlyFreePulls: [14, 18, "15"] })
check("only seasonal ones are kept (once), the rest reported", JSON.stringify(parsed.schedule) === '{"yearlyLoginBonuses":["gw22"],"yearlyFreePulls":[14],"yearlyRewardRuns":[],"yearlyStaminaRuns":[]}' && parsed.problems.length === 3, parsed)
check("nothing saved means nothing on", JSON.stringify(parseCampaignSchedule(undefined).schedule) === '{"yearlyLoginBonuses":[],"yearlyFreePulls":[],"yearlyRewardRuns":[],"yearlyStaminaRuns":[]}')

// login bonuses made yearly
const gw22 = seasonal.loginBonuses.gw22
check("game row: start stays, end goes, window from the original dates", JSON.stringify(yearlyLoginColumns(gw22.start, gw22.end)) === JSON.stringify({ start: "2023-12-26 14:00:00", end: null, yearlyFrom: "12-26 14:00:00", yearlyUntil: "01-05 04:59:59" }), yearlyLoginColumns(gw22.start, gw22.end))
const server = yearlyLoginServerColumns(gw22.start, gw22.end)
check("server copy: the same moments in UTC", JSON.stringify(server) === JSON.stringify({ start: "2023-12-26 05:00:00", end: null, yearlyFrom: "12-26 05:00:00", yearlyUntil: "01-04 19:59:59" }), server)
check("a year or longer can't be yearly", yearlyLoginColumns("2023-01-01 00:00:00", "2024-01-01 00:00:00") === null)

const yearly = { ...loginData.groups.gw22, ...server }
check("open in its original run", isLoginBonusGroupOpen(yearly, at("2023-12-30T00:00:00")))
check("open again the next December", isLoginBonusGroupOpen(yearly, at("2024-12-27T00:00:00")))
check("and over New Year", isLoginBonusGroupOpen(yearly, at("2025-01-03T00:00:00")))
check("closed between runs", !isLoginBonusGroupOpen(yearly, at("2024-06-01T00:00:00")) && !isLoginBonusGroupOpen(yearly, at("2025-01-05T00:00:00")))
check("never before its original start", !isLoginBonusGroupOpen(yearly, at("2022-12-30T00:00:00")))
check("the original run keeps the plain progress key (also after New Year)", loginBonusProgressKey("gw22", yearly, at("2023-12-30T00:00:00")) === "gw22" && loginBonusProgressKey("gw22", yearly, at("2024-01-03T00:00:00")) === "gw22")
check("later runs are saved per year (by the year they started)", loginBonusProgressKey("gw22", yearly, at("2024-12-27T00:00:00")) === "gw22#2024" && loginBonusProgressKey("gw22", yearly, at("2025-01-03T00:00:00")) === "gw22#2024")
check("progress keys give back the group", loginBonusGroupOfKey("gw22#2024") === "gw22" && loginBonusGroupOfKey("gw22") === "gw22")
check("other groups keep the plain key", loginBonusProgressKey("normal_2022", loginData.groups.normal_2022, at("2025-01-03T00:00:00")) === "normal_2022")
// the game's own yearly group (start 2024-10-29, window 04-28 to 05-08): its first run is 2025
const gw = loginData.groups.login_bonus_gw
check("the game's own yearly bonus: first run keeps the plain key, later ones per year", loginBonusProgressKey("login_bonus_gw", gw, at("2025-05-01T00:00:00")) === "login_bonus_gw" && loginBonusProgressKey("login_bonus_gw", gw, at("2026-05-01T00:00:00")) === "login_bonus_gw#2026")

const data = { groups: { ...loginData.groups, gw22: yearly } }
const finished = { gw22: { lastIndex: 10, lastDay: 100 } }
const nextYear = settleLoginBonus(data, at("2024-12-27T06:00:00"), 200, finished).find(g => g.groupId === "gw22")
check("a finished bonus starts again at day 1 the next year", nextYear !== undefined && nextYear.index === 1 && nextYear.progressKey === "gw22#2024", nextYear)
const day2 = settleLoginBonus(data, at("2024-12-28T06:00:00"), 201, { ...finished, "gw22#2024": { lastIndex: 1, lastDay: 200 } }).find(g => g.groupId === "gw22")
check("and goes on to day 2", day2 !== undefined && day2.index === 2, day2)
check("the original run still stops after its last day", settleLoginBonus(data, at("2024-01-04T06:00:00"), 150, finished).every(g => g.groupId !== "gw22"))
check("not on, not given", settleLoginBonus(loginData, at("2024-12-27T06:00:00"), 200, finished).every(g => g.groupId !== "gw22"))

// free pull copies
const winter = freePullCopies(campaign(14), seasonal.freePulls)
check("copies from the year after the original, up to 2099", winter[0].year === 2024 && winter.at(-1).year === 2099 && winter.length === 76, [winter[0], winter.length])
check("a copy keeps the month, day and time", winter[0].id === 202414 && winter[0].start === "2024-11-26 14:00:00" && winter[0].end === "2024-11-29 04:59:59", winter[0])
const holiday = freePullCopies(campaign(15), seasonal.freePulls)
check("a copy over New Year ends the next year", holiday[0].start === "2024-12-26 14:00:00" && holiday[0].end === "2025-01-05 04:59:59", holiday[0])
const summer = freePullCopies(campaign(8), seasonal.freePulls)
check("a year where a game campaign runs then is skipped (2024: Daily Summer)", !summer.some(c => c.year === 2024) && summer.some(c => c.year === 2025), summer.slice(0, 2))
check("two running at once can't both repeat", freePullClash([15, 5], seasonal.freePulls) !== null && freePullClash([8, 17], seasonal.freePulls) !== null)
check("ones on different dates can", freePullClash([13, 14, 15, 17, 4], seasonal.freePulls) === null, freePullClash([13, 14, 15, 17, 4], seasonal.freePulls))

check("regular unit banners get free pulls", isFreePullBanner(gachas["116"]) && isFreePullBanner(gachas["1"]))
const armament = Object.values(gachas).find(g => g.type === 1)
check("armament banners don't", !isFreePullBanner(armament))
check("the right copy is found by date", activeFreePullCopy(winter, at("2025-11-27T00:00:00"))?.id === 202514 && activeFreePullCopy(winter, at("2025-12-01T00:00:00")) === null)

const row = freePullCopyRow(campaign(14), winter[1], [1, 2, 116])
check("a copy's game row", row === 'gacha_campaign_2025_14,Free 10-Pull Event Celebrating Winter,2,2025-11-26 14:00:00,2025-11-29 04:59:59,"1,2,116",(None),', row)

const run = currentOrNextRun(gw22.start, gw22.end, at("2026-06-01T00:00:00"))
check("next run of a yearly bonus", run !== null && new Date(run.start).toISOString() === "2026-12-26T05:00:00.000Z", run && new Date(run.start).toISOString())
const now = currentOrNextRun(gw22.start, gw22.end, at("2027-01-02T00:00:00"))
check("the run on now (started the year before)", now !== null && new Date(now.start).toISOString() === "2026-12-26T05:00:00.000Z")

// stamina and reward campaign runs
const rewardRows = JSON.parse(readFileSync(path.join(root, "assets", "reward_campaign.json"), "utf8")).campaigns
const staminaRows = JSON.parse(readFileSync(path.join(root, "assets", "stamina_campaign.json"), "utf8")).campaigns
const rewardRuns = campaignRuns(rewardRows), staminaRuns = campaignRuns(staminaRows)
check("campaigns grouped into runs: 14 reward, 19 stamina", rewardRuns.length === 14 && staminaRuns.length === 19, [rewardRuns.length, staminaRuns.length])
check("every row is in one run", rewardRuns.reduce((n, r) => n + r.ids.length, 0) === 156 && staminaRuns.reduce((n, r) => n + r.ids.length, 0) === 369)
const holidayRun = staminaRuns.find(r => r.start === "2022-12-26 14:00:00")
const holidayCopies = runCopies(holidayRun, staminaRuns)
check("a stamina run over New Year: copy ends the next year", holidayCopies[0].year === 2023 && holidayCopies[0].start === "2023-12-26 14:00:00" && holidayCopies[0].end === "2024-01-06 20:59:59", holidayCopies[0])
const aprilRun = staminaRuns.find(r => r.start === "2023-04-23 14:00:00")
check("a year where another of the game's stamina runs is on is skipped (2024: Apr 28 run)", !runCopies(aprilRun, staminaRuns).some(c => c.year === 2024) && runCopies(aprilRun, staminaRuns).some(c => c.year === 2025))
const summerReward = rewardRuns.find(r => r.start === "2024-02-01 14:00:00")
const autumnReward = rewardRuns.find(r => r.start === "2023-09-27 14:00:00")
check("two reward runs on different dates can both repeat", yearlyClash([{ name: "a", copies: runCopies(summerReward, rewardRuns) }, { name: "b", copies: runCopies(autumnReward, rewardRuns) }]) === null)
const may = rewardRuns.find(r => r.start === "2023-04-09 14:00:00"), may2 = rewardRuns.find(r => r.start === "2024-04-16 14:00:00")
check("two reward runs on at the same time can't (Apr 9-27 and Apr 16-28)", yearlyClash([{ name: "a", copies: runCopies(may, rewardRuns) }, { name: "b", copies: runCopies(may2, rewardRuns) }]) !== null)
check("stamina and reward runs are only checked against their own kind", runCopies(summerReward, rewardRuns).some(c => c.year === 2025) && runCopies(staminaRuns.find(r => r.start === "2024-02-01 14:00:00"), staminaRuns).some(c => c.year === 2025))
check("copy ids are whole numbers the game can read, never the game's own", campaignCopyId(2099, 368) === 1099000368 && campaignCopyId(2025, 0) > 99999999 && campaignCopyId(2099, 368) < 2147483647)
check("a run in words", describeRun("stamina", staminaRows.filter(r => holidayRun.ids.includes(r.id))) === "Stamina x0.5: main story, EX quests, Kaleidoscope elements, Kaleidoscope EXP & mana, the Necropolis", describeRun("stamina", staminaRows.filter(r => holidayRun.ids.includes(r.id))))
check("a reward run in words", describeRun("reward", rewardRows.filter(r => summerReward.ids.includes(r.id))).startsWith("More items x2: main story, Kaleidoscope elements"), describeRun("reward", rewardRows.filter(r => summerReward.ids.includes(r.id))))
const known = { reward: rewardRuns.map(r => r.key), stamina: staminaRuns.map(r => r.key) }
const runPicks = parseCampaignSchedule({ yearlyRewardRuns: [summerReward.key, "nope"], yearlyStaminaRuns: [holidayRun.key, rewardRuns.find(r => r.start === "2022-08-15 14:00:00").key] }, known)
check("only the game's own runs can be picked (per kind)", JSON.stringify(runPicks.schedule.yearlyRewardRuns) === JSON.stringify([summerReward.key]) && JSON.stringify(runPicks.schedule.yearlyStaminaRuns) === JSON.stringify([holidayRun.key]) && runPicks.problems.length === 2, runPicks)
check("a copy is on during its dates", isWindowOn(holidayCopies[1], Date.parse("2025-01-01T00:00:00Z")) && !isWindowOn(holidayCopies[1], Date.parse("2025-02-01T00:00:00Z")))

// the game mod: build it with one yearly login bonus and one yearly free pull
const temp = mkdtempSync(path.join(os.tmpdir(), "campaign-schedule-"))
try {
    const events = path.join(temp, "events.json"), campaigns = path.join(temp, "campaigns.json"), out = path.join(temp, "mod.zip")
    writeFileSync(events, JSON.stringify({ entries: [] }))
    writeFileSync(campaigns, JSON.stringify({ yearlyLoginBonuses: ["gw22"], yearlyFreePulls: [14], yearlyStaminaRuns: [holidayRun.key], yearlyRewardRuns: [summerReward.key] }))
    const log = execFileSync(process.execPath, [path.join(root, "scripts", "gen_event_schedule_mod.cjs"), events, out, campaigns], { cwd: root, encoding: "utf8" })
    check("the mod builds", /10 yearly login bonus rows, 76 free pull copies, \d+ stamina\/reward campaign copies/.test(log), log)
    const unzipper = require("unzipper")
    const { decodeFile, leaves, splitCsv } = require(path.join(root, "scripts", "cdn_rows.cjs"))
    const archive = await unzipper.Open.file(out)
    const read = async file => decodeFile(await archive.files.find(f => f.path === file).buffer())
    const bonus = leaves(await read(seasonal.loginBonusFile))
    const gwRows = bonus.filter(l => l.path[0] === "gw22").map(l => splitCsv(l.leaf.text))
    check("every day of the bonus is yearly in the game's files", gwRows.length === 10 && gwRows.every(f => f[40] === "2023-12-26 14:00:00" && f[41] === "(None)" && f[42] === "12-26 14:00:00" && f[43] === "01-05 04:59:59"), gwRows[0]?.slice(38))
    const other = splitCsv(bonus.find(l => l.path.join("/") === "gw21/1").leaf.text)
    check("other bonuses keep their dates", other[41] === "2023-01-07 04:59:59" && other[42] === "(None)", other.slice(40, 44))
    const pullRows = leaves(await read(seasonal.freePullFile))
    const copy = pullRows.find(l => l.path[0] === "202514")
    check("the copies are in the game's free pull file", pullRows.length === 19 + 76 && copy !== undefined && copy.leaf.text.includes("2025-11-26 14:00:00"), pullRows.length)
    const banners = splitCsv(copy.leaf.text)[5].split(",")
    check("a copy lists every regular unit banner", banners.length === Object.values(gachas).filter(isFreePullBanner).length && banners.includes("116") && banners.includes("1"), banners.length)
    check("the original keeps its own run", pullRows.find(l => l.path[0] === "14").leaf.text.includes("2023-11-26 14:00:00,2023-11-29 04:59:59,116,"))
    check("rows stay in id order", pullRows.map(l => Number(l.path[0])).every((id, i, all) => i === 0 || all[i - 1] < id))

    // the stamina run over New Year and the February reward run, copied every year
    const { createHash } = await import("node:crypto")
    const fileOf = logical => { const h = createHash("sha1").update(logical + "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy").digest("hex"); return `production/upload/${h.slice(0, 2)}/${h.slice(2)}` }
    const staminaLeaves = leaves(await read(fileOf("master/campaign/stamina_campaign.orderedmap")))
    const staminaCopies = staminaLeaves.filter(l => Number(l.path[0]) >= 1000000000)
    check("the stamina run's rows are copied for every year it repeats", staminaLeaves.length - staminaCopies.length === 369 && staminaCopies.length === holidayRun.ids.length * holidayCopies.length, [staminaLeaves.length, staminaCopies.length])
    const firstCopy = splitCsv(staminaCopies.find(l => l.path[0] === String(campaignCopyId(2023, staminaRows.findIndex(r => r.id === holidayRun.ids[0])))).leaf.text)
    const firstOwn = splitCsv(staminaLeaves.find(l => l.path[0] === String(holidayRun.ids[0])).leaf.text)
    check("a copy is the game's row with new dates", firstCopy[1] === "2023-12-26 14:00:00" && firstCopy[2] === "2024-01-06 20:59:59" && firstCopy.slice(3).join() === firstOwn.slice(3).join() && firstOwn[1] === "2022-12-26 14:00:00", [firstCopy, firstOwn])
    const rewardLeaves = leaves(await read(fileOf("master/campaign/reward_campaign.orderedmap")))
    check("the reward run's rows are copied too", rewardLeaves.length === 156 + summerReward.ids.length * runCopies(summerReward, rewardRuns).length, rewardLeaves.length)
    check("campaign rows stay in id order", [staminaLeaves, rewardLeaves].every(list => list.map(l => Number(l.path[0])).every((id, i, all) => i === 0 || all[i - 1] < id)))
} finally {
    rmSync(temp, { recursive: true, force: true })
}

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`)
process.exit(failed === 0 ? 0 : 1)
