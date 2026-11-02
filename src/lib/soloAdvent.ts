// Single-player stand-ins for The Purge (boss events whose top difficulty needs multiplayer clears).
//
// This file has no imports on purpose, so it can be tested without the database
// (scripts/test_solo_advent.mjs). src/nya/soloAdvent.ts connects it to the real database.
//
// In the game (the Chinese fork's docs/systems/boss-epuration-unlock.md, from its decompiled client;
// the global data has the same fields):
// - The three Purger battles are multiplayer only. The Purger Empress is solo only, and unlocks
//   when its story stage is cleared and the three Purgers were cleared as the room host
//   (quest_progress host_finished).
// - Each Empress attempt spends a ticket, which came from a daily "clear multiplayer battles" mission.
//
// This server has no multiplayer, so while such an event is open (server date):
// - its multiplayer-only battles count as cleared as host, and
// - one ticket is given per day, in place of the daily mission's.

export interface AdventQuestRule {
    eventId: number
    /** 0 solo only, 1 solo or multiplayer, 2 multiplayer only. */
    playMode: number
    start: string | null
    end: string | null
    entryItem?: { id: number, count: number }
}

export interface AdventRules {
    quests: Record<string, AdventQuestRule>
}

export const PLAY_MODE = Object.freeze({ SOLO_ONLY: 0, SOLO_OR_MULTI: 1, MULTI_ONLY: 2 })

/** Tickets given per day while the event is open (the daily mission gave one). */
export const TICKETS_PER_DAY = 1

const parseDate = (value: string | null): number | null => {
    if (value === null) return null
    const ms = Date.parse(value.replace(" ", "T") + "Z")
    return isNaN(ms) ? null : ms
}

export function isQuestOpen(rule: AdventQuestRule, serverMs: number): boolean {
    const start = parseDate(rule.start), end = parseDate(rule.end)
    return (start === null || start <= serverMs) && (end === null || serverMs <= end)
}

/** The ticket a battle spends on every attempt, or null. */
export function getEntryItem(rules: AdventRules, questId: number): { id: number, count: number } | null {
    return rules.quests[String(questId)]?.entryItem ?? null
}

export interface SoloAdventState {
    /** Whether the quest is already saved as cleared as host. */
    isHostCleared(questId: number): boolean
    /** The day key a ticket was last given for this event, or null. */
    lastTicketDay(eventId: number): string | null
}

export interface SoloAdventPlan {
    /** Multiplayer-only battles of open events to save as cleared as host. */
    hostClears: { eventId: number, questId: number }[]
    /** Tickets to give today. */
    tickets: { eventId: number, itemId: number, count: number }[]
}

/**
 * What to do at login for the open events. It changes nothing: the caller saves the clears, gives
 * the tickets and remembers the day.
 *
 * @param dayKey The current daily period (a new value each day).
 */
export function planSoloAdvent(rules: AdventRules, serverMs: number, dayKey: string, state: SoloAdventState): SoloAdventPlan {
    const plan: SoloAdventPlan = { hostClears: [], tickets: [] }
    const ticketEvents = new Map<number, { id: number, count: number }>()

    for (const [id, rule] of Object.entries(rules.quests)) {
        if (!isQuestOpen(rule, serverMs)) continue
        const questId = Number(id)
        if (rule.playMode === PLAY_MODE.MULTI_ONLY && !state.isHostCleared(questId)) {
            plan.hostClears.push({ eventId: rule.eventId, questId })
        }
        if (rule.entryItem) ticketEvents.set(rule.eventId, rule.entryItem)
    }

    for (const [eventId, item] of ticketEvents) {
        if (state.lastTicketDay(eventId) === dayKey) continue
        plan.tickets.push({ eventId, itemId: item.id, count: TICKETS_PER_DAY })
    }

    plan.hostClears.sort((a, b) => a.questId - b.questId)
    return plan
}
