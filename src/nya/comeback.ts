// Returning-player login bonuses for the CN app (CN's own groups: assets/cn_comeback_bonuses.json). A save that was
// away long enough (server time since its previous load, so a real month off or a date moved a month ahead both
// count) starts every returning-player group it qualifies for (src/lib/loginBonus.ts comebackQualifies), once per
// save; the group then pays one day per login like an event bonus. A Game settings switch turns it off.
//
// .database/cn_last_seen.json   { player id: server time (ms) of its last CN load }
// A started group is a players_login_bonus row at day 0 (shown), so it pays day 1 at the next settle.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import getDatabase, { Database } from "../data"
import { COMEBACK_TYPES, comebackQualifies, LoginBonusData, loginBonusGroupOfKey } from "../lib/loginBonus"

const FILE = path.join(process.cwd(), ".database", "cn_last_seen.json")

function readSeen(): Record<string, number> {
    try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {} } catch { return {} }
}
/** The server time (ms) of a save's last CN load, or undefined before its first one since this was added. */
export function lastSeen(playerId: number): number | undefined {
    const ms = readSeen()[String(playerId)]
    return typeof ms === "number" && Number.isFinite(ms) ? ms : undefined
}
export function markSeen(playerId: number, serverMs: number) {
    const seen = readSeen()
    seen[String(playerId)] = serverMs
    mkdirSync(path.dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(seen, null, 1))
}

/**
 * Starts the returning-player groups a save qualifies for at this load and records the load. Returns every
 * returning-player group the save has started (now or before). Call inside the login bonus transaction, before
 * reading its progress. A save seen for the first time is only recorded (nobody counts as returning at once).
 */
export function startComebacksSync(playerId: number, data: LoginBonusData, serverMs: number): Set<string> {
    const db = getDatabase(Database.WDFP_DATA)
    const have = new Set((db.prepare(`SELECT group_id FROM players_login_bonus WHERE player_id = ?`).all(playerId) as { group_id: string }[])
        .map(row => loginBonusGroupOfKey(row.group_id)))
    const started = new Set<string>()
    const previous = lastSeen(playerId)
    for (const [id, group] of Object.entries(data.groups)) {
        if (!COMEBACK_TYPES.has(group.type)) continue
        if (have.has(id)) { started.add(id); continue }
        if (previous === undefined || !comebackQualifies(group, previous, serverMs)) continue
        db.prepare(`INSERT INTO players_login_bonus (group_id, last_index, last_day, received_at, shown, player_id) VALUES (?, 0, 0, 0, 1, ?)`).run(id, playerId)
        started.add(id)
        console.log(`[comeback] Player ${playerId}: away ${Math.floor((serverMs - previous) / 86_400_000)} days, starts the returning-player bonus ${id}.`)
    }
    markSeen(playerId, serverMs)
    return started
}

/** Whether a save has a returning-player group running now (started and not finished): the CN load's is_comeback. */
export function comebackRunningSync(playerId: number, data: LoginBonusData): boolean {
    const rows = getDatabase(Database.WDFP_DATA).prepare(`SELECT group_id, last_index FROM players_login_bonus WHERE player_id = ?`).all(playerId) as { group_id: string, last_index: number }[]
    return rows.some(row => {
        const group = data.groups[loginBonusGroupOfKey(row.group_id)]
        return group !== undefined && COMEBACK_TYPES.has(group.type) && row.last_index < group.days.length
    })
}
