// Connects the Boss Boost refill (src/lib/bossBoost.ts) to the database. The real day of the last
// refill is kept in players_boss_boost, so the points refill once per real day, like daily missions,
// even while the banner rotation holds the server date still.

import getDatabase, { Database } from "../data"
import { getPlayerSync, updatePlayerSync } from "../data/wdfpData"
import { refillBossBoost } from "../lib/bossBoost"
import { dayNumber } from "../lib/mission"

/**
 * Refills the player's Boss Boost points if the daily reset passed since the last refill.
 * @returns The points now, or null when the player doesn't exist.
 */
export function refillBossBoostSync(playerId: number, realMs = Date.now()): number | null {
    const db = getDatabase(Database.WDFP_DATA)
    return db.transaction(() => {
        const player = getPlayerSync(playerId)
        if (player === null) return null
        const row = db.prepare(`SELECT last_day FROM players_boss_boost WHERE player_id = ?`).get(playerId) as { last_day: number } | undefined
        const today = dayNumber(realMs)
        const result = refillBossBoost(player.bossBoostPoint, row?.last_day ?? null, today)
        if (!result.changed) return player.bossBoostPoint
        if (result.points !== player.bossBoostPoint) updatePlayerSync({ id: playerId, bossBoostPoint: result.points })
        db.prepare(`INSERT INTO players_boss_boost (player_id, last_day) VALUES (?, ?)
            ON CONFLICT(player_id) DO UPDATE SET last_day = excluded.last_day`).run(playerId, today)
        return result.points
    })()
}
