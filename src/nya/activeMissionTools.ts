// Testing tools for active missions, used by the "Active missions" box on a player's page.
//
// Nothing raises a mission's progress as the player plays yet, so without these a player has no
// claimable mission and the game never calls /active_mission/receive.

import activeMissionData from "../../assets/active_missions.json"
import getDatabase, { Database } from "../data"

interface ActiveMissionToolsData {
    /** Mission ID -> stage -> the progress that stage needs to unlock. */
    requirements?: Record<string, Record<string, number>>
    missions: Record<string, { stages: Record<string, unknown> }>
}

const data = activeMissionData as unknown as ActiveMissionToolsData

/**
 * Makes a mission claimable for a player: raises its progress to what its stages need, and marks
 * each stage that hasn't been received as unlocked. The player has to log in again (restart the
 * game) to see it, because the game gets this from the login data.
 *
 * @returns "unlocked", or "already received" if every stage was received before.
 */
export function unlockPlayerActiveMissionSync(
    playerId: number,
    missionId: number
): "unlocked" | "already received" {
    const mission = data.missions[String(missionId)]
    if (!mission) throw new Error(`Unknown active mission: ${missionId}`)

    const stageIds = Object.keys(mission.stages).map(Number)
    const required = Math.max(...stageIds.map(stage => data.requirements?.[String(missionId)]?.[String(stage)] ?? 1))

    const db = getDatabase(Database.WDFP_DATA)
    return db.transaction(() => {
        const existing = db.prepare(`
        SELECT id, status
        FROM players_active_missions_stages
        WHERE player_id = ? AND mission_id = ?
        `).all(playerId, missionId) as { id: number, status: number }[]
        const received = new Set(existing.filter(stage => stage.status !== 0).map(stage => stage.id))

        db.prepare(`
        INSERT INTO players_active_missions (id, progress, player_id)
        VALUES (?, ?, ?)
        ON CONFLICT (id, player_id) DO UPDATE SET progress = MAX(progress, excluded.progress)
        `).run(missionId, required, playerId)

        let unlocked = false
        for (const stage of stageIds) {
            if (received.has(stage)) continue // keep what was already received
            db.prepare(`
            INSERT INTO players_active_missions_stages (id, status, player_id, mission_id)
            VALUES (?, 0, ?, ?)
            ON CONFLICT (id, mission_id, player_id) DO UPDATE SET status = excluded.status
            `).run(stage, playerId, missionId)
            unlocked = true
        }
        return unlocked ? "unlocked" : "already received"
    })()
}

/**
 * Removes a mission's progress for a player, so it can be unlocked and claimed again.
 */
export function resetPlayerActiveMissionSync(
    playerId: number,
    missionId: number
) {
    if (!data.missions[String(missionId)]) throw new Error(`Unknown active mission: ${missionId}`)

    const db = getDatabase(Database.WDFP_DATA)
    db.transaction(() => {
        db.prepare(`
        DELETE FROM players_active_missions_stages
        WHERE player_id = ? AND mission_id = ?
        `).run(playerId, missionId)
        db.prepare(`
        DELETE FROM players_active_missions
        WHERE player_id = ? AND id = ?
        `).run(playerId, missionId)
    })()
}
