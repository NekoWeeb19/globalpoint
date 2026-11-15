// Tests the Overview's "Start the next day" (src/nya/nextDay.ts): after it, the next login of every save is a new
// day (daily reset, login bonus, Boss Boost, free pulls, periodic points, daily and login-day missions, solo
// tickets, today's shop limits), weekly missions are untouched, and pressing it twice is still one day.
//   npx tsc
//   node scripts/test_next_day.mjs
import fs from "fs"
import os from "os"
import path from "path"

const out = new URL("../out/", import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "next-day-"))
process.chdir(temp)

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

try {
    const getDatabase = (await import(new URL("data/index.js", out))).default.default
    const W = await import(new URL("data/wdfpData.js", out))
    const M = await import(new URL("lib/mission.js", out))
    const U = await import(new URL("utils.js", out))
    const { startNextDaySync } = await import(new URL("nya/nextDay.js", out))
    const { refillBossBoostSync } = await import(new URL("nya/bossBoost.js", out))
    const db = getDatabase(0)
    const now = Date.now()
    const iso = new Date(now).toISOString()
    const accountId = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
        VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(iso, iso, iso).lastInsertRowid)
    const playerId = W.insertDefaultPlayerSync(accountId).id
    const today = M.dayNumber(now)
    const serverMs = U.getServerDate().getTime()
    const dailyKey = M.dailyPeriodKey({ serverMs, realMs: now }), loginKey = M.loginDayKey({ serverMs, realMs: now })
    const weekKey = M.weeklyPeriodKey({ serverMs, realMs: now })

    // a save that already played today
    W.updatePlayerSync({ id: playerId, lastLoginTime: new Date(now) })
    check("logged in today: no daily reset yet", W.dailyResetPlayerSync(playerId) === false)
    refillBossBoostSync(playerId, now)
    db.prepare(`INSERT INTO players_missions (category, id, progress, rewarded_stage, period, player_id) VALUES (2, 1, 3, 1, ?, ?), (1, 2, 5, 0, ?, ?), (7, 3, 2, 0, ?, ?)`)
        .run(dailyKey, playerId, loginKey, playerId, weekKey, playerId)
    const lastDay = table => db.prepare(`SELECT last_day FROM ${table} WHERE player_id = ?`).get(playerId)?.last_day

    let r = startNextDaySync(now)
    check("reports the saves", r.players === 1, r)
    check("the next login does the daily reset", W.dailyResetPlayerSync(playerId) === true)
    check("Boss Boost refills at the next login", lastDay("players_boss_boost") === today - 1, lastDay("players_boss_boost"))
    const period = (category) => db.prepare(`SELECT period FROM players_missions WHERE player_id = ? AND category = ?`).get(playerId, category).period
    check("daily mission progress belongs to an earlier day", period(2) !== dailyKey, period(2))
    check("a login-day mission counts the next login", period(1) !== loginKey, period(1))
    check("weekly pass missions are untouched", period(7) === weekKey, period(7))

    W.updatePlayerSync({ id: playerId, lastLoginTime: new Date(now) })
    startNextDaySync(now)
    startNextDaySync(now)
    check("pressing it twice is still one day back", lastDay("players_boss_boost") === today - 1)
    check("...and the daily reset runs once", W.dailyResetPlayerSync(playerId) === true && W.dailyResetPlayerSync(playerId) === false)
} finally {
    process.chdir(os.tmpdir())
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { }
}
console.log(failures ? `\n${failures} next day test(s) failed.` : "\nAll next day tests passed.")
process.exit(failures ? 1 : 0)
