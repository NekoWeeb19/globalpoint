// Boss Boost: the pure rules. A boost doubles a boss battle's score drops (see
// givePlayerScoreRewardsSync); the points refill to the maximum at the daily reset
// (05:00 UTC, the same reset as daily missions and login bonuses: dayNumber in src/lib/mission.ts).

/** Boss Boost points after a refill (global: 3 a day). */
export const BOSS_BOOST_MAX = 3

/**
 * The points after the daily refill check. A new day refills to BOSS_BOOST_MAX (never lowering a
 * higher count); the same day changes nothing. lastDay null means never refilled.
 */
export function refillBossBoost(points: number, lastDay: number | null, today: number): { points: number, changed: boolean } {
    if (lastDay !== null && lastDay >= today) return { points, changed: false }
    const refilled = Math.max(points, BOSS_BOOST_MAX)
    return { points: refilled, changed: true }
}

/** Spends one boost point if asked and one is left; otherwise nothing is spent and there's no boost. */
export function spendBoostPoint(points: number, use: boolean): { points: number, used: boolean } {
    const safe = Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0
    if (!use || safe <= 0) return { points: safe, used: false }
    return { points: safe - 1, used: true }
}
