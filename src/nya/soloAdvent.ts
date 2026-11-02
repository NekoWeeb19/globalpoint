// Connects the single-player stand-ins for The Purge (src/lib/soloAdvent.ts) to the real database.

import adventRules from "../../assets/advent_event_rules.json"
import getDatabase, { Database } from "../data"
import { getPlayerItemSync, givePlayerItemSync, updatePlayerItemSync } from "../data/wdfpData"
import { dailyPeriodKey } from "../lib/mission"
import { AdventRules, PLAY_MODE, getEntryItem, planSoloAdvent } from "../lib/soloAdvent"
import { getQuestFromCategorySync } from "../lib/assets"
import { QuestCategory } from "../lib/types"
import { getServerDate } from "../utils"

const rules = adventRules as unknown as AdventRules

/**
 * Boss event clears are saved under category 7: the recorded global login lists boss event clears
 * there, and recorded multiplayer battles use the category of their quest table (never 8).
 */
const ADVENT_SECTION = QuestCategory.ADVENT_EVENT_SINGLE

/**
 * The first version also saved these clears under category 8, which the global game doesn't use
 * (opening The Purge then failed with error C3212). Those rows are removed.
 */
const WRONG_SECTION = QuestCategory.ADVENT_EVENT_MULTI

/** A battle clear needs a rank, a time and a score (the recorded login has them on every one). */
function clearValues(questId: number): { rank: number, timeMs: number, score: number } {
    const quest = getQuestFromCategorySync(ADVENT_SECTION, questId) as { bRankTime?: number } | null
    const bRankTime = quest?.bRankTime ?? 0
    return { rank: 1, timeMs: bRankTime > 0 ? bRankTime + 1000 : 60000, score: 0 }
}

/**
 * At login: saves the multiplayer-only battles of open boss events as cleared as host, and gives the
 * day's tickets. Afterwards the login data carries both. It never throws: login must not fail over it.
 */
export function prepareSoloAdventEventsSync(playerId: number): void {
    try {
        const db = getDatabase(Database.WDFP_DATA)
        const serverMs = getServerDate().getTime()
        const dayKey = dailyPeriodKey({ serverMs, realMs: Date.now() })

        const isHostCleared = db.prepare(`
        SELECT 1 FROM players_quest_progress
        WHERE player_id = ? AND quest_id = ? AND section = ? AND finished = 1 AND host_finished = 1
            AND clear_rank IS NOT NULL AND best_elapsed_time_ms IS NOT NULL AND high_score IS NOT NULL
        `)

        // remove the category-8 copies an earlier version saved for these battles
        const multiOnlyIds = Object.entries(rules.quests).filter(([_, q]) => q.playMode === PLAY_MODE.MULTI_ONLY).map(([id]) => Number(id))
        const removeWrong = db.prepare(`DELETE FROM players_quest_progress WHERE player_id = ? AND section = ? AND quest_id = ?`)
        let removed = 0
        for (const questId of multiOnlyIds) removed += removeWrong.run(playerId, WRONG_SECTION, questId).changes
        if (removed > 0) console.log(`[purge] Player ${playerId}: removed ${removed} clear(s) saved under category 8 by an earlier version.`)
        const lastTicket = db.prepare(`SELECT last_day FROM players_solo_event_tickets WHERE player_id = ? AND event_id = ?`)

        const plan = planSoloAdvent(rules, serverMs, dayKey, {
            isHostCleared: questId => isHostCleared.get(playerId, questId, ADVENT_SECTION) !== undefined,
            lastTicketDay: eventId => (lastTicket.get(playerId, eventId) as { last_day: string } | undefined)?.last_day ?? null,
        })
        if (plan.hostClears.length === 0 && plan.tickets.length === 0) return

        // a real clear keeps its own rank, time and score; only missing ones are filled in
        const markCleared = db.prepare(`
        INSERT INTO players_quest_progress (section, quest_id, finished, high_score, clear_rank, best_elapsed_time_ms, host_finished, player_id)
        VALUES (?, ?, 1, ?, ?, ?, 1, ?)
        ON CONFLICT (section, quest_id, player_id) DO UPDATE SET
            finished = 1,
            host_finished = 1,
            high_score = COALESCE(high_score, excluded.high_score),
            clear_rank = COALESCE(clear_rank, excluded.clear_rank),
            best_elapsed_time_ms = COALESCE(best_elapsed_time_ms, excluded.best_elapsed_time_ms)
        `)
        const rememberTicket = db.prepare(`
        INSERT INTO players_solo_event_tickets (event_id, last_day, player_id) VALUES (?, ?, ?)
        ON CONFLICT (event_id, player_id) DO UPDATE SET last_day = excluded.last_day
        `)
        db.transaction(() => {
            for (const clear of plan.hostClears) {
                const values = clearValues(clear.questId)
                markCleared.run(ADVENT_SECTION, clear.questId, values.score, values.rank, values.timeMs, playerId)
            }
            for (const ticket of plan.tickets) {
                givePlayerItemSync(playerId, ticket.itemId, ticket.count)
                rememberTicket.run(ticket.eventId, dayKey, playerId)
            }
        })()
        if (plan.hostClears.length > 0) console.log(`[purge] Player ${playerId}: multiplayer-only battles ${plan.hostClears.map(c => c.questId).join(", ")} saved as cleared as host.`)
        for (const ticket of plan.tickets) console.log(`[purge] Player ${playerId}: gave today's ticket for event ${ticket.eventId} (item ${ticket.itemId} x${ticket.count}).`)
    } catch (error) {
        console.error(`Could not prepare solo boss events for player ${playerId}:`, error)
    }
}

/**
 * Spends a battle's entry ticket at the start.
 *
 * @returns null when the battle has no ticket, the ticket and the player's new total when one was
 *          spent, or "missing" when the player doesn't have enough.
 */
export function spendEntryItemSync(playerId: number, questId: number): { id: number, count: number, total: number } | null | "missing" {
    const item = getEntryItem(rules, questId)
    if (item === null) return null
    const owned = getPlayerItemSync(playerId, item.id) ?? 0
    if (owned < item.count) return "missing"
    updatePlayerItemSync(playerId, item.id, owned - item.count)
    return { ...item, total: owned - item.count }
}

/** Gives a spent entry ticket back (the battle was abandoned). Returns the new total. */
export function refundEntryItemSync(playerId: number, item: { id: number, count: number }): number {
    return givePlayerItemSync(playerId, item.id, item.count)
}
