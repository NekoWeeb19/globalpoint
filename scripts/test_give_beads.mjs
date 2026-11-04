// Tests giving beads from the dashboard (Players > a player > Give: Paid beads / Free beads, GET /api/server/give)
// on a throwaway save in a temp folder: the mail arrives, claiming it adds the beads, and bad requests are refused.
//
//   npx tsc
//   node scripts/test_give_beads.mjs
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"

const out = new URL("../out/", import.meta.url)
const require = createRequire(import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "give-beads-"))
process.chdir(temp) // the save goes in <working folder>/.database

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

try {
    const dataModule = (await import(new URL("data/index.js", out))).default
    const getDatabase = dataModule.default
    const { insertDefaultPlayerSync, getPlayerSync } = await import(new URL("data/wdfpData.js", out))
    const { GetMails, ProcessMail, MAIL_TYPE } = await import(new URL("nya/mail.js", out))
    const serverRoutes = (await import(new URL("routes/web_api/server.js", out))).default
    const fastify = require("fastify")()
    await fastify.register(serverRoutes.default ?? serverRoutes)
    await fastify.ready()
    const db = getDatabase(0 /* Database.WDFP_DATA */)

    const now = new Date().toISOString()
    const accountId = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
        VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(now, now, now).lastInsertRowid)
    const playerId = insertDefaultPlayerSync(accountId).id
    const before = getPlayerSync(playerId)
    const ours = () => GetMails(playerId).filter(m => m.description === "From Web API")

    const give = query => fastify.inject({ method: "GET", url: `/give?${new URLSearchParams({ playerId, ...query })}` })

    let r = await give({ type: "beads_paid", number: 2500 })
    check("paid beads: request accepted with no id", r.statusCode === 200, r.body)
    r = await give({ type: "beads_free", number: 300 })
    check("free beads: request accepted", r.statusCode === 200, r.body)

    const mails = ours()
    const paid = mails.find(m => m.type === MAIL_TYPE.PAID_VIRTUAL_MONEY)
    const free = mails.find(m => m.type === MAIL_TYPE.FREE_VIRTUAL_MONEY)
    check("two mails, types 3 (paid) and 4 (free)", mails.length === 2 && paid?.number === 2500 && free?.number === 300, mails)
    check("mail subjects say what they are", paid?.subject === "Paid beads * 2500" && free?.subject === "Free beads * 300", mails.map(m => m.subject))

    ProcessMail(playerId, paid.id)
    ProcessMail(playerId, free.id)
    const after = getPlayerSync(playerId)
    check("claiming adds 2500 paid beads", after.vmoney === before.vmoney + 2500, { before: before.vmoney, after: after.vmoney })
    check("claiming adds 300 free beads", after.freeVmoney === before.freeVmoney + 300, { before: before.freeVmoney, after: after.freeVmoney })
    check("claimed mails are gone", ours().length === 0, ours())

    r = await give({ type: "beads_paid", number: 0 })
    check("0 beads refused", r.statusCode === 400, r.body)
    r = await give({ type: "beads_paid", number: "x" })
    check("not a number refused", r.statusCode === 400, r.body)
    r = await give({ type: "item", number: 5 })
    check("an item still needs an id", r.statusCode === 400, r.body)
    check("refused requests sent nothing", ours().length === 0, ours())
    await fastify.close()
} finally {
    process.chdir(os.tmpdir())
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { }
}

console.log(failures ? `\n${failures} give-beads test(s) failed.` : "\nAll give-beads tests passed.")
process.exit(failures ? 1 : 0)
