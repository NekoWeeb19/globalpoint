// Daily login bonuses, from the global client's master/bonus/login_bonus (assets/login_bonus.json).
//
// Which bonus groups are open follows the SERVER date (so the banner rotation brings each event's
// login bonus), while the day a bonus is collected for follows the REAL date, reset at 05:00 UTC like
// the daily missions (so moving the dashboard doesn't hand out extra days). The Chinese fork works
// the same way.
//
// A group with a yearly window comes back every year; each year's run starts again at day 1 (its
// progress is saved per run, see loginBonusProgressKey).
//
// Group types: Normal (the everyday bonus; the earliest-starting open one is used, and it loops),
// Limited (event bonuses; every open one runs, and stops after its last day) and ActiveUser (a gift for
// players who kept playing). The Comeback types reward players returning after a long break, which
// a single-player save doesn't track, so they aren't given.

/** One reward: kind 0 beads, 1 item, 2 character, 3 mana, 4 EXP. */
export interface LoginBonusReward {
    kind: number
    amount: number
    id?: number
}

export type LoginBonusGroupType = "Normal" | "Limited" | "Comeback" | "ComebackAlways" | "ActiveUser"

export interface LoginBonusGroup {
    type: LoginBonusGroupType
    /** Master table dates (UTC). */
    start: string
    end: string | null
    /** A yearly window inside start/end, "MM-DD hh:mm:ss" (only a few late groups have one). */
    yearlyFrom: string | null
    yearlyUntil: string | null
    linkedComeback: string | null
    /** Day 1 first. */
    days: LoginBonusReward[][]
}

export interface LoginBonusData {
    groups: Record<string, LoginBonusGroup>
}

export const LOGIN_BONUS_REWARD_KINDS = Object.freeze({ BEADS: 0, ITEM: 1, CHARACTER: 2, MANA: 3, EXP: 4 })

/** The types given here. */
const GIVEN_TYPES: ReadonlySet<LoginBonusGroupType> = new Set(["Normal", "Limited", "ActiveUser"])

/** A group's saved progress: the last day index given, and the real day it was given on. */
export interface LoginBonusProgress {
    lastIndex: number
    lastDay: number
}

export interface LoginBonusGrant {
    groupId: string
    type: LoginBonusGroupType
    /** The day index given (1-based). */
    index: number
    /**
     * Where its progress is saved: the group id, or "<group id>#<year>" for a yearly group's later
     * runs (each year starts again at day 1; the first run keeps the plain id).
     */
    progressKey: string
    rewards: LoginBonusReward[]
}

const parseDate = (value: string | null): number | null => {
    if (value === null) return null
    const ms = Date.parse(value.replace(" ", "T") + "Z")
    return isNaN(ms) ? null : ms
}

/** "MM-DD hh:mm:ss" as a comparable number within a year (MMDDhhmmss). */
const yearlyKey = (value: string): number | null => {
    const match = /^(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value)
    return match === null ? null : Number(match.slice(1).join(""))
}

const yearlyKeyOf = (ms: number): number => {
    const d = new Date(ms)
    const pad = (n: number) => String(n).padStart(2, "0")
    return Number(`${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`)
}

/** Whether a group is open at a server time (start and end included, and inside its yearly window). */
export function isLoginBonusGroupOpen(group: LoginBonusGroup, serverMs: number): boolean {
    const start = parseDate(group.start)
    const end = parseDate(group.end)
    if (start === null || serverMs < start || (end !== null && serverMs > end)) return false
    if (group.yearlyFrom !== null && group.yearlyUntil !== null) {
        const from = yearlyKey(group.yearlyFrom), until = yearlyKey(group.yearlyUntil), now = yearlyKeyOf(serverMs)
        if (from === null || until === null) return false
        return from <= until ? now >= from && now <= until : now >= from || now <= until
    }
    return true
}

const windowEnd = (group: LoginBonusGroup, year: number): number | null => {
    const from = yearlyKey(group.yearlyFrom ?? ""), until = yearlyKey(group.yearlyUntil ?? "")
    if (from === null || until === null) return null
    return parseDate(`${from <= until ? year : year + 1}-${group.yearlyUntil}`)
}

/** For a yearly group open at a server time: the year its current run started in. null otherwise. */
export function yearlyRunOf(group: LoginBonusGroup, serverMs: number): number | null {
    if (group.yearlyFrom === null || group.yearlyUntil === null) return null
    const from = yearlyKey(group.yearlyFrom), until = yearlyKey(group.yearlyUntil)
    if (from === null || until === null) return null
    const year = new Date(serverMs).getUTCFullYear()
    return from <= until || yearlyKeyOf(serverMs) >= from ? year : year - 1
}

/** A yearly group's first run (the one open at its start, or the next one). */
function firstYearlyRun(group: LoginBonusGroup): number | null {
    const start = parseDate(group.start)
    if (start === null) return null
    const year = new Date(start).getUTCFullYear()
    for (const candidate of [year - 1, year, year + 1]) {
        const end = windowEnd(group, candidate)
        if (end !== null && end >= start) return candidate
    }
    return null
}

/** Where a group's progress is saved at a server time (see LoginBonusGrant.progressKey). */
export function loginBonusProgressKey(groupId: string, group: LoginBonusGroup, serverMs: number): string {
    const run = yearlyRunOf(group, serverMs)
    if (run === null || run === firstYearlyRun(group)) return groupId
    return `${groupId}#${run}`
}

/** The group id of a saved progress key. */
export const loginBonusGroupOfKey = (key: string) => key.split("#")[0]

/**
 * The groups that give a bonus at a server time, in the order the client shows them: event
 * (Limited/ActiveUser) groups by start date, then the one Normal group (the earliest-starting open
 * one, as in the client).
 */
export function openLoginBonusGroups(data: LoginBonusData, serverMs: number): string[] {
    const open = Object.entries(data.groups)
        .filter(([_, group]) => GIVEN_TYPES.has(group.type) && group.days.length > 0 && isLoginBonusGroupOpen(group, serverMs))
        .sort((a, b) => (parseDate(a[1].start) ?? 0) - (parseDate(b[1].start) ?? 0) || (a[0] < b[0] ? -1 : 1))
    const normal = open.find(([_, group]) => group.type === "Normal")
    return [...open.filter(([_, group]) => group.type !== "Normal").map(([id]) => id), ...(normal ? [normal[0]] : [])]
}

/**
 * Today's login bonuses. Nothing when a bonus was already given on this real day or a later one (so
 * turning the clock back can't collect again). Normal groups loop back to day 1 after their last
 * day; the others stop.
 */
export function settleLoginBonus(
    data: LoginBonusData,
    serverMs: number,
    realDay: number,
    progress: Readonly<Record<string, LoginBonusProgress>>
): LoginBonusGrant[] {
    const lastDay = Math.max(-Infinity, ...Object.values(progress).map(p => p.lastDay))
    if (lastDay >= realDay) return []

    const grants: LoginBonusGrant[] = []
    for (const groupId of openLoginBonusGroups(data, serverMs)) {
        const group = data.groups[groupId]
        const progressKey = loginBonusProgressKey(groupId, group, serverMs)
        const lastIndex = progress[progressKey]?.lastIndex ?? 0
        let index: number
        if (group.type === "Normal") index = (lastIndex % group.days.length) + 1
        else if (lastIndex >= group.days.length) continue
        else index = lastIndex + 1
        grants.push({ groupId, type: group.type, index, progressKey, rewards: group.days[index - 1] })
    }
    return grants
}

/** Paid beads added to the everyday bonus when LOGIN_BONUS_PAID_BEADS isn't set. */
export const DEFAULT_LOGIN_PAID_BEADS = 150

/** The LOGIN_BONUS_PAID_BEADS setting: a whole number 0..100000, else the default. */
export function loginPaidBeadsSetting(raw: string | undefined): number {
    if (raw === undefined || raw.trim() === "") return DEFAULT_LOGIN_PAID_BEADS
    const n = Number(raw)
    return Number.isSafeInteger(n) && n >= 0 && n <= 100000 ? n : DEFAULT_LOGIN_PAID_BEADS
}

/**
 * Extra paid beads for today's grants: a server addition (not in the game's data) given with the
 * everyday (Normal) bonus, on every day of its loop, on top of that day's own rewards. The popup
 * shows only the game's own rewards.
 */
export function loginPaidBeads(grants: readonly LoginBonusGrant[], amount: number): number {
    return grants.some(grant => grant.type === "Normal") ? amount : 0
}
