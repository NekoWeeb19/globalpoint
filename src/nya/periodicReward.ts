// Connects the Hard Multi "Daily Reward Count" (src/lib/periodicReward.ts) to the database. The points
// live in players_periodic_reward_points (sent at /load as user_periodic_reward_point_list); the real
// day of the last refill is kept in players_periodic_reward_refill, so they refill once per real day,
// like daily missions, even while the banner rotation holds the server date still.

import periodicRewardData from "../../assets/periodic_reward.json"
import getDatabase, { Database } from "../data"
import { givePlayerItemSync } from "../data/wdfpData"
import { dayNumber } from "../lib/mission"
import { PeriodicDrop, PeriodicPoint, PeriodicRewardData, pickPeriodicDrop, questPointId, refillPeriodicPoints } from "../lib/periodicReward"

const data = periodicRewardData as unknown as PeriodicRewardData

function storedPoints(playerId: number): PeriodicPoint[] {
    return getDatabase(Database.WDFP_DATA).prepare(`SELECT id, point FROM players_periodic_reward_points WHERE player_id = ? ORDER BY id`).all(playerId) as PeriodicPoint[]
}

/** At /load: adds any missing point kinds, and the daily points when a new real day has begun. */
export function refillPeriodicRewardPointsSync(playerId: number, realMs = Date.now()): PeriodicPoint[] {
    const db = getDatabase(Database.WDFP_DATA)
    return db.transaction(() => {
        const row = db.prepare(`SELECT last_day FROM players_periodic_reward_refill WHERE player_id = ?`).get(playerId) as { last_day: number } | undefined
        const today = dayNumber(realMs)
        const before = storedPoints(playerId)
        const after = refillPeriodicPoints(data, before, row?.last_day ?? null, today)
        const save = db.prepare(`INSERT INTO players_periodic_reward_points (id, point, player_id) VALUES (?, ?, ?)
            ON CONFLICT (id, player_id) DO UPDATE SET point = excluded.point`)
        const old = new Map(before.map(entry => [entry.id, entry.point]))
        for (const entry of after) if (old.get(entry.id) !== entry.point) save.run(entry.id, entry.point, playerId)
        if (row?.last_day !== today) {
            db.prepare(`INSERT INTO players_periodic_reward_refill (player_id, last_day) VALUES (?, ?)
                ON CONFLICT (player_id) DO UPDATE SET last_day = excluded.last_day`).run(playerId, today)
        }
        return after
    })()
}

export interface PeriodicDropResult {
    drops: PeriodicDrop[]
    /** Item id -> the new total. */
    items: Record<string, number>
    /** The point list after the drop (for user_periodic_reward_point_list). */
    points: PeriodicPoint[]
}

/**
 * A cleared Hard Multi battle: spends one of the event's points (if there is one) and gives the bonus
 * drop. Nothing happens without a point left.
 */
export function givePeriodicDropSync(playerId: number, questId: number, random: () => number = Math.random): PeriodicDropResult {
    const db = getDatabase(Database.WDFP_DATA)
    return db.transaction(() => {
        const none = { drops: [], items: {}, points: storedPoints(playerId) }
        const pointId = questPointId(data, questId)
        if (pointId === null) return none
        const picked = pickPeriodicDrop(data, questId, random)
        if (picked === null) return none
        const spent = db.prepare(`UPDATE players_periodic_reward_points SET point = point - 1 WHERE player_id = ? AND id = ? AND point > 0`).run(playerId, pointId)
        if (spent.changes !== 1) return none
        const total = givePlayerItemSync(playerId, picked.itemId, picked.drop.number)
        const points = storedPoints(playerId)
        console.log(`[hard multi] Player ${playerId}: quest ${questId} bonus ${picked.drop.number}x ${picked.itemId}, ${points.find(p => p.id === pointId)?.point ?? 0} daily reward count left.`)
        return { drops: [picked.drop], items: { [String(picked.itemId)]: total }, points }
    })()
}
