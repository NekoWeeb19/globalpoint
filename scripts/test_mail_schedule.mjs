// Tests scheduled mail (src/nya/mailSchedule.ts, the dashboard's Mail tab) and Give's own title/message, on a
// throwaway save in a temp folder: sends at their server time, repeats and their limit, 30-day expiry, claiming
// (one and all), no back mail for past send times, months keeping their day, only the active save, bad input refused.
//
//   npx tsc
//   node scripts/test_mail_schedule.mjs
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"

const out = new URL("../out/", import.meta.url)
const require = createRequire(import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mail-schedule-"))
process.chdir(temp) // the save and the settings go in <working folder>/.database
delete process.env.CN_ACCOUNT_ID

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const DAY = 86_400_000

try {
    const getDatabase = (await import(new URL("data/index.js", out))).default.default
    const { insertDefaultPlayerSync, getPlayerSync } = await import(new URL("data/wdfpData.js", out))
    const { setServerTime } = await import(new URL("utils.js", out))
    const M = await import(new URL("nya/mailSchedule.js", out))
    const { GetMails, ProcessMail, ProcessAllMails } = await import(new URL("nya/mail.js", out))
    const { setChosenAccount } = await import(new URL("nya/activeAccounts.js", out))
    const db = getDatabase(0)

    const now = new Date().toISOString()
    const newPlayer = () => {
        const account = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
            VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(now, now, now).lastInsertRowid)
        return { account, player: insertDefaultPlayerSync(account).id }
    }
    const A = newPlayer(), B = newPlayer()
    const at = iso => { setServerTime(new Date(iso)) }
    const scheduled = p => GetMails(p).filter(m => m.id >= 20_000_000 && m.id < 90_000_000)
    const T0 = "2026-03-10T09:00:00.000Z"

    // once, now
    at(T0)
    M.saveMailSchedule({ kind: "beads_paid", amount: 2500, title: "Maintenance apology", message: "Sorry for the wait!", start: T0, every: 0 })
    let mails = scheduled(A.player)
    check("a once-mail due now arrives", mails.length === 1 && mails[0].type === 3 && mails[0].number === 2500, mails)
    check("it keeps its title and message", mails[0]?.subject === "Maintenance apology" && mails[0]?.description === "Sorry for the wait!", mails[0])
    check("it can be claimed for 30 days", mails[0]?.create_time === "2026-03-10 09:00:00" && mails[0]?.reward_limit_time === "2026-04-09 09:00:00", mails[0])
    check("reading the mailbox again doesn't send it twice", scheduled(A.player).length === 1)
    const beads = getPlayerSync(A.player).vmoney
    ProcessMail(A.player, mails[0].id)
    check("claiming it adds the beads", getPlayerSync(A.player).vmoney === beads + 2500)
    check("a claimed mail is gone and not sent again", scheduled(A.player).length === 0)
    let threw = false
    try { ProcessMail(A.player, mails[0].id) } catch { threw = true }
    check("claiming it twice is refused", threw)

    // weekly, 3 times; arrives only once the server time reaches each send
    const week = M.saveMailSchedule({ kind: "item", typeId: 1001, amount: 5, start: "2026-03-11T05:00:00Z", every: 1, unit: "week", times: 3 }).at(-1)
    check("a later send hasn't arrived yet", scheduled(A.player).length === 0)
    at("2026-03-11T05:00:30Z")
    mails = scheduled(A.player)
    check("it arrives at its time, with the default title", mails.length === 1 && mails[0].type === 1 && mails[0].type_id === 1001 && mails[0].subject === "Item 1001 * 5", mails)
    at("2026-03-26T00:00:00Z")
    mails = scheduled(A.player).filter(m => m.subject === "Item 1001 * 5")
    check("3 times in all, then it stops", mails.length === 3 && M.nextSendTime(week, Date.parse("2026-03-26T00:00:00Z")) === null, mails.map(m => m.create_time))
    const all = ProcessAllMails(A.player)
    check("claim all takes the scheduled mails", all.mail_ids.length === 3 && scheduled(A.player).length === 0, all.mail_ids)

    // expiry
    at("2026-04-20T00:00:00Z")
    M.saveMailSchedule({ kind: "mana", amount: 1000, start: "2026-04-20T00:00:00Z", every: 0 })
    mails = scheduled(A.player)
    check("mana mail arrives", mails.length === 1 && mails[0].type === 8)
    at("2026-05-20T00:00:01Z")
    check("after 30 days it's gone", scheduled(A.player).length === 0)
    threw = false
    try { ProcessMail(A.player, mails[0].id) } catch { threw = true }
    check("an expired mail can't be claimed", threw)

    // no back mail: a daily schedule starting in the past starts from now
    at("2026-06-01T12:00:00Z")
    const daily = M.saveMailSchedule({ kind: "exp", amount: 100, start: "2026-05-01T12:00:00Z", every: 1, unit: "day", times: null }).at(-1)
    mails = scheduled(A.player).filter(m => m.type === 9)
    check("a past start sends nothing for the days before it was saved (today's 12:00 send only)", mails.length === 1 && mails[0].create_time === "2026-06-01 12:00:00", mails.map(m => m.create_time))
    // a long jump forward: only the last 30 days' sends (older ones would have expired)
    at("2027-06-01T12:00:00Z")
    mails = scheduled(A.player).filter(m => m.type === 9)
    check("a year's jump gives only the last 30 days' sends", mails.length === 30 && mails[0].create_time === "2027-05-03 12:00:00", { n: mails.length, first: mails[0]?.create_time })
    M.deleteMailSchedule(daily.id)
    at("2027-06-05T12:00:00Z")
    check("a deleted schedule sends no more; what arrived stays", scheduled(A.player).filter(m => m.type === 9).length === 26)
    ProcessAllMails(A.player)

    // a first send time already past: one goes out right away, then it keeps its own times
    at("2027-07-14T15:00:00Z") // a Wednesday
    const late = M.saveMailSchedule({ kind: "beads_free", amount: 7, title: "late once", start: "2027-07-14T09:00:00Z", every: 0 }).at(-1)
    let got = scheduled(A.player).filter(m => m.subject === "late once")
    check("a once-mail whose time has passed sends right away", got.length === 1 && got[0].create_time === "2027-07-14 15:00:00", got.map(m => m.create_time))
    const mondays = M.saveMailSchedule({ kind: "beads_free", amount: 8, title: "mondays", start: "2027-07-05T10:00:00Z", every: 1, unit: "week", times: null }).at(-1)
    got = scheduled(A.player).filter(m => m.subject === "mondays")
    check("weekly from a past Monday: one right away (not every missed week)", got.length === 1, got.map(m => m.create_time))
    at("2027-07-19T10:00:30Z") // the next Monday
    got = scheduled(A.player).filter(m => m.subject === "mondays")
    check("...then it carries on on Mondays, at its own time", got.length === 2 && got[1].create_time === "2027-07-19 10:00:00", got.map(m => m.create_time))
    M.saveMailSchedule({ ...mondays, title: "mondays", message: "new words" })
    check("editing only the message doesn't send it again", scheduled(A.player).filter(m => m.subject === "mondays").length === 2)
    M.deleteMailSchedule(late.id); M.deleteMailSchedule(mondays.id)
    ProcessAllMails(A.player)

    // a save made after a send time still gets it (dated as sent), while it's under 30 days old
    at("2027-07-20T00:00:00Z")
    M.saveMailSchedule({ kind: "mana", amount: 3, title: "for late joiners", start: "2027-07-20T00:00:00Z", every: 0 })
    at("2027-07-25T00:00:00Z")
    const C = newPlayer()
    got = scheduled(C.player).filter(m => m.subject === "for late joiners")
    check("a save made 5 days after the send still gets it, dated as sent", got.length === 1 && got[0].create_time === "2027-07-20 00:00:00", got.map(m => m.create_time))
    at("2027-08-25T00:00:00Z")
    const D = newPlayer()
    check("one made after the 30 days doesn't (it would have expired)", scheduled(D.player).filter(m => m.subject === "for late joiners").length === 0)
    ProcessAllMails(A.player); ProcessAllMails(C.player)

    // months keep their day (31st -> end of shorter months), years too
    const monthly = { start: "2026-01-31T10:00:00.000Z", every: 1, unit: "month", times: null }
    check("monthly from Jan 31: Feb 28, Mar 31, Apr 30", [1, 2, 3].map(k => new Date(M.sendTime(monthly, k)).toISOString().slice(0, 10)).join() === "2026-02-28,2026-03-31,2026-04-30")
    check("yearly from Feb 29: Feb 28 next year", new Date(M.sendTime({ start: "2028-02-29T10:00:00.000Z", every: 1, unit: "year", times: null }, 1)).toISOString().slice(0, 10) === "2029-02-28")

    // editing doesn't resend past sends
    at("2027-07-01T00:00:00Z")
    const yearly = M.saveMailSchedule({ kind: "beads_free", amount: 300, start: "2027-07-01T00:00:00Z", every: 1, unit: "year", times: 2 }).at(-1)
    check("yearly mail arrives", scheduled(A.player).filter(m => m.type === 4).length === 1)
    at("2027-07-02T00:00:00Z")
    M.saveMailSchedule({ ...yearly, title: "Anniversary", start: "2027-07-01T00:00:00Z" })
    check("editing it doesn't send yesterday's again", scheduled(A.player).filter(m => m.type === 4).length === 1)
    ProcessAllMails(A.player)

    // only the active save
    setChosenAccount("cn", A.account)
    at("2027-08-01T00:00:00Z")
    M.saveMailSchedule({ kind: "beads_paid", amount: 50, start: "2027-08-01T00:00:00Z", every: 0 })
    check("the active save gets it", scheduled(A.player).length === 1)
    check("another save doesn't", scheduled(B.player).length === 0)
    check("the dashboard shows what was delivered and waits", M.mailScheduleStatus(A.player).at(-1).delivered === 1 && M.mailScheduleStatus(A.player).at(-1).waiting === 1)
    ProcessAllMails(A.player)
    const after = M.mailScheduleStatus(A.player).at(-1)
    check("after claiming in the game: still delivered 1, waiting 0", after.delivered === 1 && after.waiting === 0, after)
    // no active save picked: the counts add up every save that got some
    setChosenAccount("cn", null)
    at("2027-08-02T00:00:00Z")
    const daily2 = M.saveMailSchedule({ kind: "mana", amount: 10, start: "2027-08-02T00:00:00Z", every: 1, unit: "day", times: null }).at(-1)
    scheduled(A.player); scheduled(B.player)
    const both = M.mailScheduleStatus(null).find(s => s.id === daily2.id)
    check("no active save: delivered and waiting counted across saves", both.delivered === 2 && both.waiting === 2, both)
    at("2027-08-03T00:00:00Z")
    scheduled(A.player)
    const later = M.mailScheduleStatus(null).find(s => s.id === daily2.id)
    check("the next day's send shows up in the counts", later.delivered === 3 && later.waiting === 3, later)
    M.deleteMailSchedule(daily2.id)
    check("saved to .database for restarts and the Wi-Fi copy", fs.existsSync(path.join(temp, ".database", "mail_schedule.json")) && fs.existsSync(path.join(temp, ".database", "mail_delivered.json")))

    // every year: the whole run again from its first send's anniversary
    setChosenAccount("cn", A.account)
    at("2028-03-01T10:00:00Z")
    const yr = M.saveMailSchedule({ kind: "mana", amount: 9, title: "spring run", start: "2028-03-01T10:00:00Z", every: 1, unit: "week", times: 3, yearly: true }).at(-1)
    const times6 = [0, 1, 2, 3, 4, 5].map(k => new Date(M.sendTime(yr, k)).toISOString().slice(0, 10)).join()
    check("every year: weekly x3 from 2028-03-01, then again in 2029", times6 === "2028-03-01,2028-03-08,2028-03-15,2029-03-01,2029-03-08,2029-03-15", times6)
    at("2028-04-01T00:00:00Z")
    check("after this year's run, the next send is next year's first", new Date(M.nextSendTime(yr, Date.parse("2028-04-01T00:00:00Z"))).toISOString().slice(0, 10) === "2029-03-01")
    ProcessAllMails(A.player)
    at("2029-03-01T10:00:30Z")
    got = scheduled(A.player).filter(m => m.subject === "spring run")
    check("next year's run arrives on its day", got.length === 1 && got[0].create_time === "2029-03-01 10:00:00", got.map(m => m.create_time))
    ProcessAllMails(A.player)
    check("Feb 29 every year falls on Feb 28 in other years", new Date(M.sendTime({ start: "2028-02-29T10:00:00.000Z", every: 0, unit: "day", times: 1, yearly: true }, 1)).toISOString().slice(0, 10) === "2029-02-28")
    for (const [what, input] of [
        ["every year with forever", { kind: "mana", amount: 1, start: T0, every: 1, unit: "day", times: null, yearly: true }],
        ["every year with a run over a year", { kind: "mana", amount: 1, start: T0, every: 1, unit: "month", times: 13, yearly: true }],
    ]) {
        let refused = false
        try { M.saveMailSchedule(input) } catch { refused = true }
        check(`refuses ${what}`, refused)
    }

    // sharing: export, then import (past first sends: now or next)
    const shared = M.exportMailSchedules([yr.id])
    check("export: one file of what and when, no ids or progress", shared.kind === "globalpoint-mail-schedule" && shared.mails.length === 1 && shared.mails[0].yearly === true && !("id" in shared.mails[0]) && !("savedAt" in shared.mails[0]), shared)
    const before = M.listMailSchedules().length
    at("2029-06-01T00:00:00Z")
    const pastFile = { kind: "globalpoint-mail-schedule", version: 1, mails: [{ kind: "beads_free", typeId: null, amount: 4, title: "imported late", message: "", start: "2029-05-01T00:00:00Z", every: 1, unit: "week", times: null }] }
    let r = M.importMailSchedules(pastFile, "next")
    check("import adds next to what's there", r.added === 1 && M.listMailSchedules().length === before + 1, r)
    check("import 'start at its next time': no mail right away", scheduled(A.player).filter(m => m.subject === "imported late").length === 0)
    r = M.importMailSchedules({ ...pastFile, mails: [{ ...pastFile.mails[0], title: "imported now" }] }, "now")
    check("import 'send them now': one right away", scheduled(A.player).filter(m => m.subject === "imported now").length === 1)
    r = M.importMailSchedules({ kind: "globalpoint-mail-schedule", version: 1, mails: [{ kind: "chara", typeId: 999999, amount: 1, title: "", message: "", start: "2029-06-01T00:00:00Z", every: 0, unit: "day", times: 1 }, { kind: "gold", amount: 1 }] }, "now", id => id !== 999999)
    check("import refuses a unit this server doesn't have, and a bad line, with reasons", r.added === 0 && r.refused.length === 2 && /isn't on this server/.test(r.refused[0].why), r)
    let notFile = false
    try { M.importMailSchedules({ hello: 1 }, "now") } catch { notFile = true }
    check("import refuses a file that isn't a mail schedule", notFile)
    for (const s of M.listMailSchedules().filter(s => /imported|spring run/.test(s.title))) M.deleteMailSchedule(s.id)
    ProcessAllMails(A.player)

    // bad input
    for (const [what, input] of [
        ["no amount", { kind: "beads_paid", amount: 0, start: T0, every: 0 }],
        ["item with no id", { kind: "item", amount: 1, start: T0, every: 0 }],
        ["unknown kind", { kind: "gold", amount: 1, start: T0, every: 0 }],
        ["no date", { kind: "mana", amount: 1, start: "", every: 0 }],
        ["bad repeat unit", { kind: "mana", amount: 1, start: T0, every: 1, unit: "hour" }],
        ["0 times", { kind: "mana", amount: 1, start: T0, every: 1, unit: "day", times: 0 }],
        ["title too long", { kind: "mana", amount: 1, start: T0, every: 0, title: "x".repeat(61) }],
    ]) {
        let refused = false
        try { M.saveMailSchedule(input) } catch { refused = true }
        check(`refuses ${what}`, refused)
    }

    // Give: your own title and message
    const serverRoutes = (await import(new URL("routes/web_api/server.js", out))).default
    const fastify = require("fastify")()
    await fastify.register(serverRoutes.default ?? serverRoutes)
    await fastify.ready()
    await fastify.inject({ method: "GET", url: `/give?${new URLSearchParams({ playerId: A.player, type: "beads_free", number: 10, subject: "Thanks!", message: "For testing" })}` })
    await fastify.inject({ method: "GET", url: `/give?${new URLSearchParams({ playerId: A.player, type: "item", typeId: 1001, number: 1 })}` })
    const given = GetMails(A.player).filter(m => m.id >= 10_000_000 && m.id < 20_000_000)
    check("Give uses your title and message", given.some(m => m.subject === "Thanks!" && m.description === "For testing"), given)
    check("Give keeps the defaults when left empty", given.some(m => m.subject === "Give Item" && m.description === "From Web API"), given)
    const page = await fastify.inject({ method: "GET", url: "/mail" })
    check("the Mail tab's data loads", page.statusCode === 200 && Array.isArray(page.json().schedules) && page.json().days === 30, page.body.slice(0, 200))
    const bad = await fastify.inject({ method: "POST", url: "/mail", payload: { kind: "item", amount: 1, start: T0, every: 0 } })
    check("the dashboard gets a readable refusal", bad.statusCode === 400 && /id/.test(bad.json().message), bad.body)
    await fastify.close()
} finally {
    process.chdir(os.tmpdir())
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { }
}

console.log(failures ? `\n${failures} scheduled mail test(s) failed.` : "\nAll scheduled mail tests passed.")
process.exit(failures ? 1 : 0)
