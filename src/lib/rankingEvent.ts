// Time Attack ("Speed Run: Trial by ...") ranking events, played alone.
//
// Official ranks were a share of all players (top 3% is S+, and so on), worked out by the server.
// With one player there's no one to rank against, so a clear TIME is compared with each rank's time
// border instead (community records from the NA-SA servers, the rest extrapolated, see
// RANKING_TIME_BORDERS_MS). The client shows the rank from rank_percentage (0-100, lower is better)
// and pays from the same tier table, so the shown rank and the rewards always agree.

/** One reward slot of a tier: kind 0 item, 1 equipment, 2 beads, 3 mana, 4 EXP, 6 title. */
export interface RankingRewardSlot {
    kind: number
    id?: number
    amount: number
}

export interface RankingTier {
    id: number
    /** Share of players at or above this tier (0.03 = top 3%). */
    border: number
    rewards: RankingRewardSlot[]
}

export interface RankingEvent {
    code: string
    name: string | null
    questId: number
    /** Best first; the last one covers everyone (border 1). */
    tiers: RankingTier[]
}

export interface RankingEventData {
    events: Record<string, RankingEvent>
}

export const RANKING_REWARD_KINDS = Object.freeze({ ITEM: 0, EQUIPMENT: 1, BEADS: 2, MANA: 3, EXP: 4, TITLE: 6 })

const time = (minutes: number, seconds: number) => Math.round((minutes * 60 + seconds) * 1000)

/**
 * Clear-time borders (ms) of the tiers S+, S, A, B, C, D, E and F, per ranking event; slower than F
 * is G. Sources (the user's community screenshots and posts, NA-SA unless noted):
 * - Water: S+ 1:18.98 (results period); S 2:10 (KR 2:10.37, and 2:01.43 was 4.7%); B 4:07.15 and
 *   C 6:31.38 (shown as "next rank border"); A interpolated between S and B.
 * - Light, Wind, Thunder: S+, S and A from the final border post; B from posts (Light: 2:38.55 was
 *   18.6%, 3:30 broke into C; Wind about 1:56-2:04; Thunder 3:01 a week before the end).
 * - Fire: S+, S, A and B from the final border post.
 * - Everything else is extrapolated from Water's spread below B (C 1.58x, D 2.9x, E 3.9x, F 5.8x B),
 *   set so a normal clear with a decent team reaches about D.
 */
export const RANKING_TIME_BORDERS_MS: Readonly<Record<number, readonly number[]>> = Object.freeze({
    1: [time(1, 18.98), time(2, 10), time(2, 50), time(4, 7.15), time(6, 31.38), time(12, 0), time(16, 0), time(24, 0)], // Water
    2: [time(0, 35.42), time(0, 49.64), time(1, 9.54), time(2, 45), time(4, 20), time(8, 0), time(10, 45), time(16, 0)], // Light
    3: [time(0, 23.54), time(0, 27.76), time(0, 38.01), time(2, 0), time(3, 10), time(5, 50), time(7, 50), time(11, 40)], // Wind
    4: [time(0, 43.24), time(1, 18.13), time(2, 7.07), time(2, 58), time(4, 40), time(8, 35), time(11, 35), time(17, 10)], // Thunder
    5: [time(0, 7.2), time(0, 9.31), time(0, 15.04), time(1, 0.97), time(1, 36), time(3, 0), time(4, 0), time(5, 55)], // Fire
})

/** The fastest official clear of each event, shown as the border above S+ (this server's earlier values). */
export const RANKING_TOP_TIMES_MS: Readonly<Record<number, number>> = Object.freeze({
    1: 54410,
    2: 25800,
    3: 18880,
    4: 31720,
    5: 6540,
})

/** The client can't draw exactly 0% (the Chinese fork saw it crash), so this is the best shown. */
export const RANKING_MIN_PERCENTAGE = 0.5

export interface RankingPlacement {
    /** Index into the event's tiers (0 is S+). */
    tierIndex: number
    /** 0-100, lower is better: what the client draws and turns into a rank letter. */
    rankPercentage: number
    /** The next faster border's time (the client's "next rank border"); the top time for S+. */
    nextBorderMs: number
}

const round1 = (value: number) => Math.round(value * 10) / 10

/**
 * Places a clear time. Between two borders the percentage moves in proportion, so the marker sits
 * where the time falls; each tier's percentages stay inside that tier's band, so the client's own
 * rank (the first tier whose border >= percentage / 100) is always the tier that gets paid.
 *
 * @returns null when the event has no time borders or the time isn't a positive number.
 */
/** CN-only reruns of a trial use the original's borders (CN event 1000 reruns Water, 1001 Light). */
const RERUN_OF: Readonly<Record<number, number>> = Object.freeze({ 1000: 1, 1001: 2 })

export function placeRankingTime(event: RankingEvent, eventId: number, clearTimeMs: number): RankingPlacement | null {
    eventId = RERUN_OF[eventId] ?? eventId
    const borders = RANKING_TIME_BORDERS_MS[eventId]
    if (borders === undefined || !Number.isFinite(clearTimeMs) || clearTimeMs <= 0) return null
    const percentages = event.tiers.map(tier => tier.border * 100)
    const top = RANKING_TOP_TIMES_MS[eventId] ?? 0
    const lastBorder = borders.length

    // first tier whose time border the clear meets; slower than every border is the last tier (G)
    let tierIndex = borders.findIndex(border => clearTimeMs <= border)
    if (tierIndex === -1 || tierIndex >= percentages.length) tierIndex = Math.min(lastBorder, percentages.length - 1)

    // the band this tier covers, in time and in percentage
    const fromTime = tierIndex === 0 ? top : borders[tierIndex - 1]
    const toTime = tierIndex < lastBorder ? borders[tierIndex] : borders[lastBorder - 1] * 2
    const fromPercent = tierIndex === 0 ? RANKING_MIN_PERCENTAGE : percentages[tierIndex - 1]
    const toPercent = percentages[tierIndex]
    const share = toTime > fromTime ? Math.min(1, Math.max(0, (clearTimeMs - fromTime) / (toTime - fromTime))) : 1

    // keep strictly inside the band after rounding (the client compares against the borders)
    const low = tierIndex === 0 ? RANKING_MIN_PERCENTAGE : fromPercent + 0.1
    const rankPercentage = Math.min(toPercent, Math.max(low, round1(fromPercent + (toPercent - fromPercent) * share)))

    return {
        tierIndex,
        rankPercentage,
        nextBorderMs: tierIndex === 0 ? top : borders[tierIndex - 1],
    }
}

/** The tier the client shows for a percentage (its getRankRating): the first border >= percentage. */
export function tierForPercentage(event: RankingEvent, rankPercentage: number): number {
    const index = event.tiers.findIndex(tier => tier.border * 100 >= rankPercentage - 1e-9)
    return index === -1 ? event.tiers.length - 1 : index
}
