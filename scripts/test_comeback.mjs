// Tests the CN app's returning-player login bonuses (src/nya/comeback.ts, CN's groups in
// assets/cn_comeback_bonuses.json): a save away 30+ days of server time starts the groups it qualifies for, once
// each, paid one day per login; a save seen for the first time isn't returning; CN's condition periods; the global
// app gets none; the Game settings switch. On a throwaway save in a temp folder.
//
//   npx tsc
//   node scripts/test_comeback.mjs
import fs from "fs"
import os from "os"
import path from "path"

const out = new URL("../out/", import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "comeback-"))
process.chdir(temp)
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
    const { runInCnContext } = await import(new URL("lib/cnClient.js", out))
    const { settleLoginBonusSync, getPendingLoginBonusSync, confirmLoginBonusShownSync } = await import(new URL("nya/loginBonus.js", out))
    const { comebackQualifies } = await import(new URL("lib/loginBonus.js", out))
    const { comebackRunningSync } = await import(new URL("nya/comeback.js", out))
    const { loginBonusDataFor } = await import(new URL("nya/cnCampaigns.js", out))
    const { setServerSettings } = await import(new URL("nya/serverSettings.js", out))
    const groups = JSON.parse(fs.readFileSync(new URL("../assets/cn_comeback_bonuses.json", import.meta.url), "utf8")).groups
    const db = getDatabase(0)
    const stamp = new Date().toISOString()
    const newPlayer = () => {
        const account = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
            VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(stamp, stamp, stamp).lastInsertRowid)
        return insertDefaultPlayerSync(account).id
    }
    const cn = fn => { let r; runInCnContext(true, () => { r = fn() }); return r }
    const ms = iso => Date.parse(iso)
    let realDay = Date.parse("2030-01-01T06:00:00Z")
    // a CN /load at a server time, on the next real day: the groups paid now
    const load = (p, iso, inCn = true) => { realDay += DAY; const run = () => { const paid = settleLoginBonusSync(p, ms(iso), realDay); confirmLoginBonusShownSync(p); return paid }; return inCn ? cn(run) : run() }
    const comebacks = paid => paid.filter(id => groups[id] !== undefined)

    // global's end-of-service farewell bonus isn't in the CN game's login bonus table: sending it stopped the CN game
    // at login with C8601 ("key=goodbye_login") on 2024-05-28 to 07-25; the global app still gets it
    check("the CN app doesn't get global's goodbye_login (C8601)", cn(() => loginBonusDataFor().groups.goodbye_login) === undefined)
    check("the global app still has goodbye_login", loginBonusDataFor().groups.goodbye_login !== undefined)
    const cnPaidAtGoodbye = load(newPlayer(), "2024-07-15T12:00:00Z")
    check("a CN login on 2024-07-15 pays no goodbye_login", !cnPaidAtGoodbye.includes("goodbye_login"), cnPaidAtGoodbye)

    // ---- the data ----
    check("CN's four returning-player groups", ["comeback_01", "comebackpresent", "cn_comeback", "anv3_comeback"].every(id => groups[id]), Object.keys(groups))
    check("comeback_01: 15 days, 1,500 beads in all, 30 days away", groups.comeback_01.days.length === 15 && groups.comeback_01.daysAway === 30
        && groups.comeback_01.days.flat().filter(r => r.kind === 0).reduce((n, r) => n + r.amount, 0) === 1500)
    const g = groups.comeback_01
    check("qualifies: away 30 days, previous load in its period", comebackQualifies(g, ms("2023-04-01T00:00:00Z"), ms("2023-05-02T00:00:00Z")))
    check("doesn't qualify: away 29 days", !comebackQualifies(g, ms("2023-04-01T00:00:00Z"), ms("2023-04-30T00:00:00Z")))
    check("doesn't qualify: the group isn't open (before 2023-03-02)", !comebackQualifies(g, ms("2022-12-01T00:00:00Z"), ms("2023-02-01T00:00:00Z")))
    check("anv3_comeback: previous load must be 2024-05-23..07-04", comebackQualifies(groups.anv3_comeback, ms("2024-06-01T00:00:00Z"), ms("2024-07-15T00:00:00Z"))
        && !comebackQualifies(groups.anv3_comeback, ms("2024-05-01T00:00:00Z"), ms("2024-07-15T00:00:00Z")))
    check("cn_comeback (CN's placeholder period): only the 30 days count", comebackQualifies(groups.cn_comeback, ms("2024-06-01T00:00:00Z"), ms("2024-07-02T00:00:00Z")))

    // ---- a save ----
    const A = newPlayer()
    check("a save seen for the first time isn't returning", comebacks(load(A, "2023-03-10T00:00:00Z")).length === 0)
    check("a short break isn't returning", comebacks(load(A, "2023-03-20T00:00:00Z")).length === 0)
    const free = getPlayerSync(A).freeVmoney
    const back = load(A, "2023-04-25T00:00:00Z")
    check("back after 36 days: the 15-day bonus starts, day 1 paid with the daily bonus", back.includes("comeback_01"), back)
    check("the CN load says is_comeback while it runs", cn(() => comebackRunningSync(A, loginBonusDataFor())))
    let days = 1
    for (let i = 0; i < 20; i++) if (load(A, `2023-04-${String(26 + Math.min(i, 4)).padStart(2, "0")}T0${i % 10}:00:00Z`).includes("comeback_01")) days++
    check("it pays all 15 days, then stops", days === 15, days)
    const beads = getPlayerSync(A).freeVmoney - free
    check("1,500 free beads from it", beads >= 1500, beads)
    check("is_comeback off once it's done", !cn(() => comebackRunningSync(A, loginBonusDataFor())))
    check("another 30-day break: comeback_01 isn't given twice", !load(A, "2023-06-10T00:00:00Z").includes("comeback_01"))
    const gift = load(A, "2023-09-20T00:00:00Z")
    check("after 2023-08-31, a 30-day break gives the one-off returning gift", gift.includes("comebackpresent"), gift)

    // pending popup lists the comeback group with its type
    const B = newPlayer()
    cn(() => settleLoginBonusSync(B, ms("2023-03-10T00:00:00Z"), realDay += DAY))
    cn(() => confirmLoginBonusShownSync(B))
    cn(() => settleLoginBonusSync(B, ms("2023-05-01T00:00:00Z"), realDay += DAY))
    const pending = cn(() => getPendingLoginBonusSync(B))
    check("the login popup lists it with its type", pending?.bonus_index_list.some(b => b.bonus_group_id === "comeback_01" && b.bonus_group_type === "Comeback" && b.index === 1), pending)

    // the 2024 groups
    const C = newPlayer()
    load(C, "2024-06-10T00:00:00Z")
    const anv = load(C, "2024-07-15T00:00:00Z")
    check("2024: back after 35 days gets the 7-day bonus and the 3rd anniversary one", anv.includes("cn_comeback") && anv.includes("anv3_comeback"), anv)

    // the global app, and the switch
    const D = newPlayer()
    load(D, "2023-03-10T00:00:00Z", false)
    check("the global app gets no returning-player bonus", comebacks(load(D, "2023-05-10T00:00:00Z", false)).length === 0)
    const E = newPlayer()
    load(E, "2023-03-10T00:00:00Z")
    setServerSettings({ cnComeback: false })
    check("switched off: none", comebacks(load(E, "2023-05-10T00:00:00Z")).length === 0)
    setServerSettings({ cnComeback: true })
} finally {
    process.chdir(os.tmpdir())
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { }
}

console.log(failures ? `\n${failures} returning-player test(s) failed.` : "\nAll returning-player tests passed.")
process.exit(failures ? 1 : 0)
