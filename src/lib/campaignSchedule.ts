// Yearly seasonal campaigns: seasonal login bonuses and seasonal free pulls that come back every
// year on the same dates, after their original run.
//
//  - A seasonal login bonus is turned into a yearly one the way the game's own late bonuses
//    (login_bonus_gw, countdown_anv, login_bonus_anv) are written: it keeps its start, loses its end,
//    and gets a yearly window ("MM-DD hh:mm:ss") made from its original start and end.
//  - A seasonal free pull gets a copy for every later year (same month, day and time). A copy lists
//    every regular unit banner, so it applies to whichever of them is running then. A year whose copy
//    would overlap one of the game's own free pull campaigns is skipped, and the original keeps its
//    own first run.
//  - A stamina or reward campaign run (the rows of master/campaign/stamina_campaign or
//    reward_campaign that share the same dates) gets a copy of its rows for every later year, the
//    same way: a year whose copy would overlap one of the game's own runs of the same kind (stamina
//    with stamina, rewards with rewards) is skipped, and two chosen runs of the same kind that would
//    overlap can't both repeat.
//
// Anniversary, collab and story-specific campaigns are left alone (not in the lists below).
//
// Dates are written the way the game's data writes them (Japan time, see eventSchedule.ts).
// Everything in this file is plain logic with no side effects.

import { formatServerDate, parseMasterDate } from "./eventSchedule"

/**
 * Seasonal login bonuses that can repeat every year (group id -> name shown on the dashboard). Named as the CN
 * game has them (its row titles, the year of its CN run): global reused many at other times under other names
 * (gw2020, CN's Golden Week, was global's "Lunar New Year" in December).
 */
export const SEASONAL_LOGIN_BONUSES: Readonly<Record<string, string>> = Object.freeze({
    ny20: "New Year's Red Envelope (2022)",
    gw2020: "Golden Week (2020)",
    valentine21: "Valentine's (2021)",
    smr_v20: "Summer Vacation (2020)",
    ny21: "New Year's Red Envelope (2021)",
    spring2021: "Spring (2021)",
    gw21: "Golden Week (2021)",
    smr_v21: "Summer (2021)",
    smr_v21_02: "Summer, part 2 (2021)",
    hw_v21_01: "Halloween, part 1 (2023)",
    hw_v21_02: "Halloween, part 2 (2023)",
    xmas21: "Christmas (2023)",
    ny22: "World Flipper Year After Year (2023)",
    gw22: "Golden Week (2024)",
    smr_v22: "Summer (2024)",
    xmas22: "Christmas (2024)",
})

/** Seasonal free pull campaigns that can repeat every year (campaign id -> name shown on the dashboard). */
export const SEASONAL_FREE_PULLS: Readonly<Record<number, string>> = Object.freeze({
    4: "New Year's free daily pull",
    5: "Golden Week free daily pull",
    8: "Summer Season free daily pull",
    13: "Fall Foliage free 10-pull",
    14: "Winter free 10-pull",
    15: "Winter Holiday free daily pull",
    17: "Daily Summer free pull",
})

/**
 * The CN game's own seasonal login bonuses (CN-only groups, assets/campaigns_cn.json), for the CN
 * client only. Collab, anniversary and newcomer groups are left alone, as for global.
 */
export const CN_SEASONAL_LOGIN_BONUSES: Readonly<Record<string, string>> = Object.freeze({
    ny20_2022: "New Year's Red Envelope (CN, 2022)",
    ny22_spring: "Lunar New Year Red Envelope (CN, 2022)",
    qingming_2022: "Spring Outing (CN, 2022)",
    smr_v2022: "Summer Vacation (CN, 2022)",
    smr_v2022_2nd: "Summer Vacation, part 2 (CN, 2022)",
    ny21_2022: "New Year's Gift (CN, 2022)",
    spring2023: "Lunar New Year (CN, 2023)",
    gw23: "Golden Week (CN, 2023)",
    smr_v21_1: "Summer (CN, 2023)",
    smr_v21_02_1: "Summer, part 2 (CN, 2023)",
    smr_v23: "Summer (CN, 2025)",
    hw_v23: "Halloween (CN, 2025)",
})

/** The CN game's own seasonal free pull campaigns, for the CN client only. */
export const CN_SEASONAL_FREE_PULLS: Readonly<Record<number, string>> = Object.freeze({
    1002: "New Year free daily pull (CN)",
    1005: "Golden Week free daily pull (CN)",
    21: "Summer Vacation free daily pull (CN)",
    1019: "Summer Vacation free daily pull, later (CN)",
    1013: "Winter Break free daily pull (CN)",
    1017: "Winter free 10-pull (CN)",
})

/**
 * A CN-only free pull's yearly copy gets an id of its own range: year * 100 + id (global's copies) could
 * meet another campaign's copy (1013 in 2030 = 13 in 2040).
 */
export const cnFreePullCopyId = (year: number, originalId: number) => 600_000_000 + year * 10_000 + originalId

/** Copies are made up to this year. */
export const LAST_COPY_YEAR = 2099

/**
 * A campaign row on the CN game's own dates: `cn` is its window from .database/cn_event_windows.json (ISO,
 * written by each CN update build); the row's dates are UTC text, "YYYY-MM-DD hh:mm:ss", like the data's. The
 * row as it is when CN's data doesn't have it.
 */
export function withCnDates<T extends { start: string, end: string }>(row: T, cn: { start: string, end: string } | null | undefined): T {
    if (!cn) return row
    const text = (iso: string) => iso.slice(0, 19).replace("T", " ")
    return { ...row, start: text(cn.start), end: text(cn.end) }
}

export interface CampaignSchedule {
    yearlyLoginBonuses: string[],
    yearlyFreePulls: number[],
    yearlyRewardRuns: string[], // run keys (see runKey)
    yearlyStaminaRuns: string[]
}

/** The runs a saved schedule may name (run keys), when known. */
export interface KnownRuns {
    reward: readonly string[],
    stamina: readonly string[]
}

/** A free pull campaign row of the game's data (master/gacha/gacha_campaign). */
export interface FreePullCampaign {
    id: number,
    name: string,
    kind: number, // 1 daily 1-pull, 2 daily 10-pull
    start: string, // Japan time, as written
    end: string,
    banners: number[]
}

/** A yearly copy of a free pull campaign. */
export interface FreePullCopy {
    id: number, // year * 100 + original id, e.g. 202514
    originalId: number,
    year: number,
    start: string, // Japan time, as written
    end: string
}

/** The copy ids are year * 100 + id, far above the game's own (1-20). */
export const isFreePullCopyId = (id: number) => id >= 100000

/**
 * Reads a saved campaign schedule. Ids that aren't seasonal are dropped and reported.
 */
export function parseCampaignSchedule(raw: unknown, known?: KnownRuns): { schedule: CampaignSchedule, problems: string[] } {
    const problems: string[] = []
    const value = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {}
    const logins = Array.isArray(value.yearlyLoginBonuses) ? value.yearlyLoginBonuses : []
    const pulls = Array.isArray(value.yearlyFreePulls) ? value.yearlyFreePulls : []
    const yearlyLoginBonuses: string[] = []
    for (const id of logins) {
        if (typeof id === "string" && (id in SEASONAL_LOGIN_BONUSES || id in CN_SEASONAL_LOGIN_BONUSES)) { if (!yearlyLoginBonuses.includes(id)) yearlyLoginBonuses.push(id) }
        else problems.push(`login bonus ${String(id)} is not a seasonal one`)
    }
    const yearlyFreePulls: number[] = []
    for (const id of pulls) {
        if (typeof id === "number" && (id in SEASONAL_FREE_PULLS || id in CN_SEASONAL_FREE_PULLS)) { if (!yearlyFreePulls.includes(id)) yearlyFreePulls.push(id) }
        else problems.push(`free pull ${String(id)} is not a seasonal one`)
    }
    const runs = (field: unknown, kind: "reward" | "stamina") => {
        const out: string[] = []
        for (const key of Array.isArray(field) ? field : []) {
            const ok = typeof key === "string" && (known === undefined ? RUN_KEY.test(key) : known[kind].includes(key))
            if (!ok) problems.push(`${kind} campaign ${String(key)} is not one of the game's runs`)
            else if (!out.includes(key)) out.push(key)
        }
        return out
    }
    const yearlyRewardRuns = runs(value.yearlyRewardRuns, "reward")
    const yearlyStaminaRuns = runs(value.yearlyStaminaRuns, "stamina")
    return { schedule: { yearlyLoginBonuses, yearlyFreePulls, yearlyRewardRuns, yearlyStaminaRuns }, problems }
}

/** "YYYY-MM-DD hh:mm:ss" -> "MM-DD hh:mm:ss" (the game's yearly window format). */
export const yearlyPart = (dateText: string) => dateText.slice(5)

/**
 * The columns of a login bonus row made yearly: the start stays, the end goes, and the yearly
 * window is the original start and end. null when the dates can't be read or the run is a year or
 * longer.
 */
export function yearlyLoginColumns(start: string, end: string): { start: string, end: null, yearlyFrom: string, yearlyUntil: string } | null {
    const from = parseMasterDate(start), until = parseMasterDate(end)
    if (from === null || until === null || until <= from) return null
    if (until - from >= 365 * 24 * 60 * 60 * 1000) return null
    return { start, end: null, yearlyFrom: yearlyPart(start), yearlyUntil: yearlyPart(end) }
}

/**
 * The same, for the server's own copy (which reads its dates as UTC): the moments are the game's
 * Japan time ones, written in UTC.
 */
export function yearlyLoginServerColumns(start: string, end: string): { start: string, end: null, yearlyFrom: string, yearlyUntil: string } | null {
    const columns = yearlyLoginColumns(start, end)
    if (columns === null) return null
    const from = formatServerDate(parseMasterDate(start)!), until = formatServerDate(parseMasterDate(end)!)
    return { start: from, end: null, yearlyFrom: yearlyPart(from), yearlyUntil: yearlyPart(until) }
}

/** A date text moved to another year (same month, day and time); null for Feb 29 in a short year. */
function inYear(dateText: string, year: number): string | null {
    const moved = `${String(year).padStart(4, "0")}${dateText.slice(4)}`
    return parseMasterDate(moved) === null ? null : moved
}

const overlaps = (a: { start: number, end: number }, b: { start: number, end: number }) => a.start <= b.end && b.start <= a.end

/** A yearly copy's dates (Japan time, as written). */
export interface YearlyWindow {
    year: number,
    start: string,
    end: string
}

/**
 * The same dates in every year after the original run, up to `lastYear`. A year whose copy would
 * overlap one of `originals` (the game's own runs of the same kind) is skipped.
 */
export function yearlyWindows(start: string, end: string, originals: readonly { start: string, end: string }[], lastYear = LAST_COPY_YEAR): YearlyWindow[] {
    const from = parseMasterDate(start), until = parseMasterDate(end)
    if (from === null || until === null || until <= from) return []
    const firstYear = Number(start.slice(0, 4))
    const span = Number(end.slice(0, 4)) - firstYear // 1 when it runs over New Year
    const taken = originals.map(c => ({ start: parseMasterDate(c.start), end: parseMasterDate(c.end) }))
        .filter((w): w is { start: number, end: number } => w.start !== null && w.end !== null)
    const windows: YearlyWindow[] = []
    for (let year = firstYear + 1; year <= lastYear; year++) {
        const copyStart = inYear(start, year), copyEnd = inYear(end, year + span)
        if (copyStart === null || copyEnd === null) continue
        const window = { start: parseMasterDate(copyStart)!, end: parseMasterDate(copyEnd)! }
        if (taken.some(o => overlaps(o, window))) continue
        windows.push({ year, start: copyStart, end: copyEnd })
    }
    return windows
}

/**
 * Several yearly picks of one kind, with no two copies running at the same time: where copies of two picks
 * would overlap, the pick whose original run is longer (`length`, ms) keeps that copy and the other skips it
 * (equal length: the one listed first). The server and the game updates all use this, so they make the same
 * copies. `parse` reads the copies' dates (global's data: Japan time; CN-dated rows: parseUtcText).
 */
export function keepLongerOnOverlap<K, T extends { start: string, end: string }>(
    picks: readonly { key: K, length: number, copies: readonly T[] }[],
    parse: (text: string) => number | null = parseMasterDate
): Map<K, T[]> {
    const order = picks.map((p, i) => ({ ...p, i })).sort((a, b) => b.length - a.length || a.i - b.i)
    const taken: { start: number, end: number }[] = []
    const kept = new Map<K, T[]>()
    for (const pick of order) {
        const list: T[] = []
        for (const copy of pick.copies) {
            const start = parse(copy.start), end = parse(copy.end)
            if (start === null || end === null) continue
            const window = { start, end }
            if (taken.some(t => overlaps(t, window))) continue
            taken.push(window)
            list.push(copy)
        }
        kept.set(pick.key, list)
    }
    return kept
}

/** A run's or campaign's length in ms (0 when its dates can't be read). */
export function runLength(row: { start: string, end: string }, parse: (text: string) => number | null = parseMasterDate): number {
    const start = parse(row.start), end = parse(row.end)
    return start === null || end === null ? 0 : end - start
}

/**
 * Why several yearly picks of one kind can't all be on (two would run at the same time), or null.
 * `picks` are the picks' names with their copies.
 */
export function yearlyClash(picks: readonly { name: string, copies: readonly YearlyWindow[] }[]): string | null {
    const window = (w: YearlyWindow) => ({ start: parseMasterDate(w.start)!, end: parseMasterDate(w.end)! })
    for (let i = 0; i < picks.length; i++) for (let j = i + 1; j < picks.length; j++) {
        for (const a of picks[i].copies) for (const b of picks[j].copies) {
            if (overlaps(window(a), window(b))) return `"${picks[i].name}" and "${picks[j].name}" would run at the same time (${a.year}), so only one of them can repeat`
        }
    }
    return null
}

/**
 * A campaign's yearly copies, from the year after its original run up to LAST_COPY_YEAR. A copy that
 * would overlap one of the game's own campaigns (`all`, the originals) is skipped.
 */
export function freePullCopies(campaign: FreePullCampaign, all: readonly FreePullCampaign[], lastYear = LAST_COPY_YEAR): FreePullCopy[] {
    return yearlyWindows(campaign.start, campaign.end, all, lastYear)
        .map(w => ({ id: w.year * 100 + campaign.id, originalId: campaign.id, year: w.year, start: w.start, end: w.end }))
}

/**
 * Why a set of yearly free pulls can't all be on, or null. Two of them running at once would put
 * two free pulls on the same banner, which the game can't show.
 */
export function freePullClash(ids: readonly number[], campaigns: readonly FreePullCampaign[]): string | null {
    return yearlyClash(ids.map(id => {
        const campaign = campaigns.find(c => c.id === id)
        return { name: SEASONAL_FREE_PULLS[id] ?? `campaign ${id}`, copies: campaign === undefined ? [] : freePullCopies(campaign, campaigns) }
    }))
}

/** A summon banner of assets/gacha.json, as far as free pulls care. */
export interface FreePullBannerInfo {
    type: number, // 0 units, 1 armaments
    paymentType: number,
    singleCost: number,
    movieName?: string
}

/** Whether a banner is a regular unit banner, the kind the game's own free pulls were given on. */
export function isFreePullBanner(gacha: FreePullBannerInfo): boolean {
    return gacha.type === 0 && gacha.paymentType === 0 && gacha.singleCost > 0 && (gacha.movieName === "normal" || gacha.movieName === "fes")
}

/** UTC date text ("YYYY-MM-DD hh:mm:ss") to ms: the CN-dated rows (withCnDates, assets/campaigns_cn.json) are UTC. */
export const parseUtcText = (text: string): number | null => {
    const ms = Date.parse(text.replace(" ", "T") + "Z")
    return isNaN(ms) ? null : ms
}

/**
 * The yearly copy running at a moment (ms), if any. `parse` reads the copies' dates: global's data is Japan time
 * (the default); the CN client's copies are UTC (parseUtcText), as its game update writes them.
 */
export function activeFreePullCopy(copies: readonly FreePullCopy[], ms: number, parse: (text: string) => number | null = parseMasterDate): FreePullCopy | null {
    for (const copy of copies) {
        const start = parse(copy.start), end = parse(copy.end)
        if (start !== null && end !== null && ms >= start && ms <= end) return copy
    }
    return null
}

/** A copy's row in master/gacha/gacha_campaign: the original's row with the new name key, dates and banners. */
export function freePullCopyRow(original: FreePullCampaign, copy: FreePullCopy, banners: readonly number[]): string {
    const quote = (text: string) => /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    return [
        `gacha_campaign_${copy.year}_${String(original.id).padStart(2, "0")}`,
        quote(original.name),
        String(original.kind),
        copy.start,
        copy.end,
        quote(banners.join(",")),
        "(None)",
        ""
    ].join(",")
}


/**
 * The run of a yearly campaign (original dates, Japan time) that is on at `afterMs` or comes next:
 * the original run, or the same dates in a later year. null when the dates can't be read.
 */
export function currentOrNextRun(start: string, end: string, afterMs: number): { start: number, end: number } | null {
    const from = parseMasterDate(start), until = parseMasterDate(end)
    if (from === null || until === null || until <= from) return null
    const firstYear = Number(start.slice(0, 4)), span = Number(end.slice(0, 4)) - firstYear
    const nowYear = new Date(afterMs).getUTCFullYear()
    for (let year = Math.max(firstYear, nowYear - 1); year <= Math.max(firstYear, nowYear) + 2; year++) {
        const s = inYear(start, year), e = inYear(end, year + span)
        if (s === null || e === null) continue
        const run = { start: parseMasterDate(s)!, end: parseMasterDate(e)! }
        if (run.end >= afterMs) return run
    }
    return null
}

// ---- stamina and reward campaigns ----

/** A row of assets/stamina_campaign.json or reward_campaign.json (master dates as written). */
export interface TimedCampaign {
    id: number,
    weekly: boolean,
    start: string,
    end: string,
    rate: number,
    rewardKind?: number, // reward campaigns: 0 items, 1 EXP, 2 mana
    range: (number | string | null)[]
}

/** A campaign run: the rows that share the same dates. */
export interface CampaignRun {
    key: string, // see runKey
    start: string,
    end: string,
    ids: number[]
}

const RUN_KEY = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}~\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

/** A run's key: its start and end as written, "start~end". */
export const runKey = (start: string, end: string) => `${start}~${end}`

/** The runs of a campaign table, by start date. Weekly rows are left out (the global data has none). */
export function campaignRuns(campaigns: readonly TimedCampaign[]): CampaignRun[] {
    const runs = new Map<string, CampaignRun>()
    for (const campaign of campaigns) {
        if (campaign.weekly) continue
        const key = runKey(campaign.start, campaign.end)
        const run = runs.get(key) ?? { key, start: campaign.start, end: campaign.end, ids: [] }
        run.ids.push(campaign.id)
        runs.set(key, run)
    }
    return [...runs.values()].sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : 1)
}

/** A run's yearly copies: every later year, skipping years where another of the game's runs of its kind is on. */
export function runCopies(run: CampaignRun, runs: readonly CampaignRun[], lastYear = LAST_COPY_YEAR): YearlyWindow[] {
    return yearlyWindows(run.start, run.end, runs, lastYear)
}

/**
 * The id of a copy of a campaign row: 1,000,000,000 + (year - 2000) * 1,000,000 + the row's place in
 * its table (by id). Far above the game's own ids (8 digits), and a whole number the game can read.
 */
export function campaignCopyId(year: number, index: number): number {
    return 1_000_000_000 + (year - 2000) * 1_000_000 + index
}

const RANGE_NAMES: Readonly<Record<number, string>> = Object.freeze({
    0: "main story", 1: "EX quests", 2: "boss battles", 3: "Kaleidoscope elements", 4: "Kaleidoscope EXP & mana",
    5: "boss events", 6: "story events", 7: "the Necropolis", 8: "Trials", 9: "world story events",
    10: "world story boss battles", 12: "the Kaleidoscope",
})
const REWARD_NAMES = ["More items", "More EXP", "More mana"]

/** What a run does, in words: "Stamina x0.5: main story, Kaleidoscope elements". */
export function describeRun(kind: "reward" | "stamina", rows: readonly TimedCampaign[]): string {
    const parts = new Map<string, string[]>()
    for (const row of rows) {
        const head = kind === "stamina" ? `Stamina x${row.rate}` : `${REWARD_NAMES[row.rewardKind ?? 0] ?? "Rewards"} x${row.rate}`
        const rangeKind = Number(row.range[0])
        const name = RANGE_NAMES[rangeKind] ?? `quest group ${rangeKind}`
        const list = parts.get(head) ?? []
        if (!list.includes(name)) list.push(name)
        parts.set(head, list)
    }
    return [...parts].map(([head, names]) => `${head}: ${names.join(", ")}`).join(" · ")
}

/** Whether dates (Japan time, as written) are on at a moment (ms). */
export function isWindowOn(window: { start: string, end: string }, ms: number): boolean {
    const start = parseMasterDate(window.start), end = parseMasterDate(window.end)
    return start !== null && end !== null && ms >= start && ms <= end
}
