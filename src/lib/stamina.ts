// Real stamina (dashboard switch "Spend stamina like the real game", src/nya/stamina.ts): the game's own rules, as
// the CN client works them out (pinball/common/data/player/PlayerLogic getCurrentStamina) and the Chinese fork's
// server charges them (src/lib/stamina*.ts there). Plain logic, no side effects.
//
// - Stamina refills 1 point every stamina_recovery_seconds (360) x (1 - the rank's stamina_heal_time_decrease_rate)
//   seconds, counted from stamina_heal_time, up to the rank's maximum. Stamina above the maximum (from rank-ups,
//   items or beads) doesn't refill and isn't cut down; nothing goes above 999.
// - A battle costs its quest's stamina when it starts; a stamina campaign running then multiplies the cost (at
//   least 1 when the result isn't 0). Retiring gives it back.
// - A rank-up adds the new rank's maximum on top (a recorded global finish: 128 + 28 = 156).
// - 50 beads (free beads first) buy 100 stamina.

// 360 on the CN game: its own countdown (rank 120, rate 0.38) runs 223 s a point, floor(360 x 0.62); the Chinese fork
// uses 300, which would put the server ahead of the game
export const STAMINA_RECOVERY_SECONDS = 360
export const STAMINA_OVERFLOW_MAX = 999
export const STAMINA_RECOVERY_BEADS = 50
export const STAMINA_RECOVERY_VALUE = 100

export interface StaminaState {
    stamina: number
    healTimeMs: number
}

/** Seconds per stamina point at a rank (its stamina_heal_time_decrease_rate). */
export const recoverySeconds = (decreaseRate: number): number =>
    Math.max(1, Math.floor(STAMINA_RECOVERY_SECONDS * (1 - (Number.isFinite(decreaseRate) ? decreaseRate : 0)) + 1e-10 + 1e-10))

/** The stamina the game shows now (as its getCurrentStamina). */
export function currentStamina(state: StaminaState, nowMs: number, max: number, seconds: number): number {
    if (state.stamina >= max) return Math.min(state.stamina, STAMINA_OVERFLOW_MAX)
    const gained = Math.max(0, Math.floor((nowMs - state.healTimeMs) / (seconds * 1000)))
    return Math.max(0, Math.min(max, state.stamina + gained))
}

/**
 * The stamina now, saved with a heal time that keeps the part of a point already refilled (the game counts from
 * stamina_heal_time). At or above the maximum the heal time is now: refilling starts when stamina drops below it.
 */
export function settle(state: StaminaState, nowMs: number, max: number, seconds: number): StaminaState {
    const stamina = currentStamina(state, nowMs, max, seconds)
    if (stamina >= max || state.stamina >= max) return { stamina, healTimeMs: nowMs }
    const gained = stamina - state.stamina
    return { stamina, healTimeMs: state.healTimeMs + gained * seconds * 1000 }
}

/** Spends stamina, or null when there isn't enough. */
export function spend(state: StaminaState, cost: number, nowMs: number, max: number, seconds: number): StaminaState | null {
    const now = settle(state, nowMs, max, seconds)
    if (cost <= 0) return now
    if (now.stamina < cost) return null
    // spending from a full (or over-full) bar starts the refill now
    return { stamina: now.stamina - cost, healTimeMs: now.stamina >= max ? nowMs : now.healTimeMs }
}

/** Adds stamina (a refund, a rank-up, beads), up to 999. */
export function add(state: StaminaState, amount: number, nowMs: number, max: number, seconds: number): StaminaState {
    const now = settle(state, nowMs, max, seconds)
    const stamina = Math.min(STAMINA_OVERFLOW_MAX, now.stamina + Math.max(0, amount))
    return { stamina, healTimeMs: stamina >= max ? nowMs : now.healTimeMs }
}

/** A stamina campaign row of the CN table (master/campaign/stamina_campaign): window, rate, quest type, id filters. */
export interface StaminaCampaign {
    startMs: number
    endMs: number
    rate: number
    questType: number
    /** [event or chapter ids, middle level, quest ids]: null = any, [] = none */
    selectors: [number[] | null, number[] | null, number[] | null]
}

/** QuestCategory -> the campaign table's quest type (the Chinese fork's CATEGORY_TO_CDN_TYPE). */
const CAMPAIGN_QUEST_TYPES: Readonly<Record<number, number>> = Object.freeze({
    1: 0, 4: 1, 2: 2, 6: 3, 14: 4, 7: 5, 8: 5, 10: 6, 13: 7, 11: 8, 18: 9, 19: 10, 15: 11, 20: 13, 21: 14, 22: 15, 23: 16, 24: 17, 25: 18, 26: 19,
})

/** Reads a campaign row's id filter ("(None)" any, "" none, "1,2"). */
export const parseSelector = (text: string | undefined): number[] | null =>
    text === undefined || text === "(None)" ? null : text === "" ? [] : text.split(",").map(Number)

/**
 * Whether a campaign covers a quest: main, EX and boss battle quests match three levels of the id (id / 1000000,
 * id / 1000 % 1000, id % 1000); event quests match the event (id / 1000) and quest (id % 1000), skipping the middle.
 */
function covers(campaign: StaminaCampaign, questId: number): boolean {
    const threeLevels = campaign.questType <= 2
    const path = threeLevels
        ? [Math.floor(questId / 1_000_000), Math.floor(questId / 1_000) % 1_000, questId % 1_000]
        : [Math.floor(questId / 1_000), questId % 1_000]
    const levels = threeLevels ? [0, 1, 2] : [0, 2]
    return levels.every((level, i) => {
        const ids = campaign.selectors[level]
        if (ids === null) return true
        // a list of several events counts its first only, as the game reads it
        return (level === 0 && ids.length > 1 ? ids.slice(0, 1) : ids).includes(path[i])
    })
}

/** The lowest rate of the campaigns covering a quest now (1 when none). */
export function campaignRate(campaigns: readonly StaminaCampaign[], category: number, questId: number, nowMs: number): number {
    const type = CAMPAIGN_QUEST_TYPES[category]
    if (type === undefined) return 1
    let rate = 1
    for (const c of campaigns) {
        if (c.questType !== type || nowMs < c.startMs || nowMs > c.endMs || !covers(c, questId)) continue
        rate = Math.min(rate, c.rate)
    }
    return rate
}

/** A battle's cost with a campaign's rate: at least 1 unless the cost or the rate is 0. */
export const costWithRate = (cost: number, rate: number): number =>
    cost <= 0 || rate <= 0 ? 0 : Math.max(1, Math.floor(cost * rate))
