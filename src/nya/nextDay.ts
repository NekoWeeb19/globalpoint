// Dashboard Overview "Start the next day": everything that turns over at the real daily reset (05:00 UTC) turns
// over at the next game login instead, for every save. Nothing is paid here: the game's next login does the daily
// reset as usual (login bonus with the daily beads, Boss Boost and boost points, daily-first summons, campaign
// counters, free pulls of yearly copies, periodic reward points, solo boss event tickets, daily and login-day
// missions, the daily News pop-up, today's shop limits). Pressing it twice before logging in is still one day.

import getDatabase, { Database } from "../data"
import { dailyPeriodKey, dayNumber, loginDayKey } from "../lib/mission"
import { getServerDate } from "../utils"
import { updatePlayerSync } from "../data/wdfpData"

const DAY_MS = 24 * 60 * 60 * 1000

export function startNextDaySync(realMs = Date.now()): { players: number } {
    const db = getDatabase(Database.WDFP_DATA)
    const today = dayNumber(realMs)
    const serverMs = getServerDate().getTime()
    const dailyKey = dailyPeriodKey({ serverMs, realMs })
    const loginKey = loginDayKey({ serverMs, realMs })
    const yesterday = new Date(realMs - DAY_MS)
    const tableExists = (name: string) => db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined
    const rewind = (table: string) => {
        if (tableExists(table)) db.prepare(`UPDATE ${table} SET last_day = ? WHERE last_day >= ?`).run(today - 1, today)
    }

    const players = (db.prepare(`SELECT COUNT(*) AS n FROM players`).get() as { n: number }).n
    db.transaction(() => {
        // the daily reset at /load (dailyResetPlayerDataSync) runs when the last login was on an earlier day
        for (const row of db.prepare(`SELECT id, last_login_time FROM players`).all() as { id: number, last_login_time: string }[]) {
            if (new Date(row.last_login_time).getTime() > yesterday.getTime()) updatePlayerSync({ id: row.id, lastLoginTime: yesterday })
        }
        rewind("players_login_bonus")
        rewind("players_boss_boost")
        rewind("players_free_pull_reset")
        rewind("players_periodic_reward_refill")
        // solo boss event tickets and daily / login-day missions keep the day's key: mark it as an earlier one
        if (tableExists("players_solo_event_tickets")) db.prepare(`UPDATE players_solo_event_tickets SET last_day = 'before ' || last_day WHERE last_day = ?`).run(dailyKey)
        db.prepare(`UPDATE players_missions SET period = 'before ' || period WHERE period IN (?, ?)`).run(dailyKey, loginKey)
        // today's shop limits (by the server's day)
        if (tableExists("players_shop_purchases")) db.prepare(`UPDATE players_shop_purchases SET day_count = 0 WHERE day_key = ?`).run(dayNumber(serverMs))
    })()
    console.log(`[next day] The next login starts a new day for ${players} save(s).`)
    return { players }
}
