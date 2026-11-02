// Connects the Score Attack history (src/lib/scoreAttack.ts) to the database: one row per battle in
// players_score_attack_history, read back by history/score_attack_event_battle (newest first).

import getDatabase, { Database } from "../data"
import { clientSerializeDate } from "../data/utils"
import { getPlayerEquipmentSync } from "../data/wdfpData"
import { HistoryParty, historyRecord } from "../lib/scoreAttack"
import { getServerDate } from "../utils"

/** Saves one Score Attack battle to the event's history. */
export function recordScoreAttackBattleSync(playerId: number, eventId: number, battle: {
    categoryId: number
    questId: number
    elapsedTimeMs: number
    score: number
    clearRank: number
    party: HistoryParty | undefined
    zones: unknown
}): void {
    const record = historyRecord({
        ...battle,
        createTime: clientSerializeDate(getServerDate()),
        equipment: id => getPlayerEquipmentSync(playerId, id),
    })
    getDatabase(Database.WDFP_DATA).prepare(`INSERT INTO players_score_attack_history (event_id, record, player_id) VALUES (?, ?, ?)`)
        .run(eventId, JSON.stringify(record), playerId)
}

/** The event's history, newest first. */
export function getScoreAttackHistorySync(playerId: number, eventId: number): Record<string, unknown>[] {
    const rows = getDatabase(Database.WDFP_DATA).prepare(`SELECT record FROM players_score_attack_history WHERE player_id = ? AND event_id = ? ORDER BY id DESC`)
        .all(playerId, eventId) as { record: string }[]
    return rows.flatMap(row => {
        try { return [JSON.parse(row.record) as Record<string, unknown>] } catch { return [] }
    })
}
