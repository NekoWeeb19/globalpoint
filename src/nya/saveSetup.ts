// Dashboard save tools (player page): clear every main story stage so all chapters are open, and set the player
// rank. Same rules as scripts/test_save_setup.cjs (a community member's dashboard patch first had them, 2026-11-12).
// The game reads both at login, so the player closes and reopens the game afterwards.

import getDatabase, { Database } from "../data"
import mainQuests from "../../assets/main_quest.json"
import playerRanks from "../../assets/player_rank.json"
import { getRankByPt } from "./player"

const MAIN_SECTION = 1 // QuestCategory.MAIN

export const MAX_PLAYER_RANK = playerRanks.length

/**
 * Marks every stage in assets/main_quest.json cleared. Stages already cleared keep their score and clear rank; no
 * clear rewards are given. Units that join during the story arrive at the next login (catchUpQuestJoinUnitsSync).
 */
export function unlockAllChaptersSync(playerId: number): { newlyCleared: number, total: number } {
    const db = getDatabase(Database.WDFP_DATA)
    const questIds = Object.keys(mainQuests).map(Number)
    const count = () => (db.prepare("SELECT COUNT(*) AS n FROM players_quest_progress WHERE player_id = ? AND section = ? AND finished = 1")
        .get(playerId, MAIN_SECTION) as { n: number }).n
    const before = count()
    const upsert = db.prepare(`INSERT INTO players_quest_progress (section, quest_id, finished, player_id) VALUES (?, ?, 1, ?)
        ON CONFLICT (section, quest_id, player_id) DO UPDATE SET finished = 1`)
    db.transaction(() => { for (const id of questIds) upsert.run(MAIN_SECTION, id, playerId) })()
    const newlyCleared = count() - before
    console.log(`[save tools] Player ${playerId}: all story stages cleared (${newlyCleared} newly).`)
    return { newlyCleared, total: questIds.length }
}

/** Sets the rank points to where `rank` starts (also downwards). Rank-up rewards aren't given. */
export function setPlayerRankSync(playerId: number, rank: number): { from: number, to: number } | null {
    const db = getDatabase(Database.WDFP_DATA)
    const row = db.prepare("SELECT rank_point FROM players WHERE id = ?").get(playerId) as { rank_point: number } | undefined
    if (!row || !Number.isInteger(rank) || rank < 1 || rank > MAX_PLAYER_RANK) return null
    const from = getRankByPt(row.rank_point)?.rank ?? 1
    db.prepare("UPDATE players SET rank_point = ? WHERE id = ?").run(playerRanks[rank - 1].total_rp, playerId)
    console.log(`[save tools] Player ${playerId}: rank ${from} -> ${rank}.`)
    return { from, to: rank }
}
