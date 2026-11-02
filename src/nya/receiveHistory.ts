// The Item Log (history/receive): the gifts a player claimed from the gift box, newest first. The game
// says "Displaying last 500 messages", so the last 500 are kept, 100 a page. A row is the gift itself
// (subject, text, MAIL_TYPE type/type_id/number from nya/mail.ts); with no subject the game writes
// "Auto-Mail". create_time is on the game clock, like the gift box's own dates.

import getDatabase, { Database } from "../data"
import { getServerDate } from "../utils"

const KEEP_ROWS = 500
export const RECEIVE_HISTORY_PAGE_SIZE = 100

export interface ReceivedEntry {
    type: number
    type_id?: number | null
    number: number
    reason_id?: number
    subject?: string | null
    description?: string | null
}

let tableReady = false
function db() {
    const database = getDatabase(Database.WDFP_DATA)
    if (!tableReady) {
        database.prepare(`CREATE TABLE IF NOT EXISTS players_receive_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER NOT NULL,
            type INTEGER NOT NULL,
            type_id INTEGER,
            number INTEGER NOT NULL,
            reason_id INTEGER NOT NULL DEFAULT 0,
            subject TEXT,
            description TEXT,
            create_time TEXT NOT NULL,
            FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
        )`).run()
        database.prepare("CREATE INDEX IF NOT EXISTS players_receive_history_player ON players_receive_history (player_id, id)").run()
        tableReady = true
    }
    return database
}

const gameClock = () => getServerDate().toISOString().replace("T", " ").replace(/\.\d+Z$/, "")

/** Adds received things to a player's Item Log. Never throws: a log problem mustn't stop a reward. */
export function recordReceivedSync(playerId: number, entries: ReceivedEntry[]) {
    if (entries.length === 0) return
    try {
        const database = db()
        const insert = database.prepare(`INSERT INTO players_receive_history (player_id, type, type_id, number, reason_id, subject, description, create_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        const time = gameClock()
        database.transaction(() => {
            for (const entry of entries) {
                if (!Number.isFinite(entry.number) || entry.number <= 0) continue
                insert.run(playerId, entry.type, entry.type_id ?? null, entry.number, entry.reason_id ?? 0, entry.subject ?? null, entry.description ?? null, time)
            }
            database.prepare(`DELETE FROM players_receive_history WHERE player_id = ? AND id NOT IN
                (SELECT id FROM players_receive_history WHERE player_id = ? ORDER BY id DESC LIMIT ?)`).run(playerId, playerId, KEEP_ROWS)
        })()
    } catch (error) {
        console.error(`[item log] could not record for player ${playerId}:`, error)
    }
}

/** One page (from 1) of a player's Item Log, newest first, in the client's form. */
export function receiveHistoryPageSync(playerId: number, page: number) {
    const database = db()
    const rows = database.prepare(`SELECT type, type_id, number, reason_id, subject, description, create_time FROM players_receive_history
        WHERE player_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`)
        .all(playerId, RECEIVE_HISTORY_PAGE_SIZE, (Math.max(1, page) - 1) * RECEIVE_HISTORY_PAGE_SIZE) as
        { type: number, type_id: number | null, number: number, reason_id: number, subject: string | null, description: string | null, create_time: string }[]
    const total = (database.prepare("SELECT COUNT(*) AS n FROM players_receive_history WHERE player_id = ?").get(playerId) as { n: number }).n
    return {
        history: rows.map(row => ({
            create_time: row.create_time,
            description: row.description,
            number: row.number,
            reason_id: row.reason_id,
            subject: row.subject,
            type: row.type,
            type_id: row.type_id,
        })),
        total_count: total,
    }
}
