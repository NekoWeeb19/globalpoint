// Titles ("degrees" in the game's data) a player owns, kept in players_degrees. Title 1 (World
// Voyager) is everyone's, and the title the player is wearing always counts as owned (a save from
// the global server may wear a title it earned there).

import degreeData from "../../assets/degree.json"
import getDatabase, { Database } from "../data"

const DEFAULT_DEGREE_ID = 1
const allDegrees = (degreeData as { degrees: Record<string, unknown> }).degrees

/** How many titles the game has (the profile's "titles owned" maximum). */
export const DEGREE_COUNT = Object.keys(allDegrees).length

/** Whether a title exists in the game's data. */
export function degreeExists(degreeId: number): boolean {
    return Number.isSafeInteger(degreeId) && allDegrees[String(degreeId)] !== undefined
}

/** The titles the player owns, sorted: the default, the one worn, and every one earned here. */
export function getOwnedDegreeIdsSync(playerId: number, currentDegreeId: number): number[] {
    const rows = getDatabase(Database.WDFP_DATA).prepare(`SELECT degree_id FROM players_degrees WHERE player_id = ?`).all(playerId) as { degree_id: number }[]
    const owned = new Set<number>([DEFAULT_DEGREE_ID, ...rows.map(row => row.degree_id)])
    if (degreeExists(currentDegreeId)) owned.add(currentDegreeId)
    return [...owned].sort((a, b) => a - b)
}

/** Gives the player a title. @returns false if it doesn't exist or was already owned. */
export function givePlayerDegreeSync(playerId: number, degreeId: number): boolean {
    if (!degreeExists(degreeId)) return false
    const result = getDatabase(Database.WDFP_DATA).prepare(`INSERT OR IGNORE INTO players_degrees (degree_id, player_id) VALUES (?, ?)`).run(degreeId, playerId)
    return result.changes > 0
}
