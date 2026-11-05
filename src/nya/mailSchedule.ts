// Scheduled mail, set on the dashboard's Mail page: gifts that arrive in the in-game mailbox at a set server time,
// once or again and again (every N days / weeks / months / years, a number of times or forever), like the
// game's own maintenance and event gifts. Only the active save gets them (the CN account picked on the Players tab,
// or CN_ACCOUNT_ID; with neither, any save that opens its mailbox). Each delivered mail can be claimed for 30 days.
//
// .database/mail_schedule.json   the schedules
// .database/mail_delivered.json  per player: how far each schedule has been delivered, and the mails not yet claimed
// Both are saved, so mails survive a restart and go along with the companion's Wi-Fi copy.
//
// Delivery happens when the mailbox is read: every send time of a schedule that has come (server time) and is less
// than 30 days old becomes a mail; older ones would already have expired. When a schedule is made (or its times are
// changed) with its first send time already past, one mail goes out right away, then it carries on at its own times
// ("every Monday from the 1st" keeps Mondays); the older sends are not poured out. An edit of only the title or
// message keeps its progress.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs"
import path from "path"
import { getAccountPlayersSync } from "../data/wdfpData"
import { cnLinkedAccountId } from "../lib/cnClient"
import { getServerDate } from "../utils"

const DIR = path.join(process.cwd(), ".database")
const SCHEDULE_FILE = path.join(DIR, "mail_schedule.json")
const DELIVERED_FILE = path.join(DIR, "mail_delivered.json")

export const MAIL_DAYS = 30
const DAY = 86_400_000
const MAX_TITLE = 60
const MAX_MESSAGE = 300
/** Mail ids for scheduled mail: above the dashboard's Give mails (10000000+), below the never-ending ones (90000000+). */
const FIRST_MAIL_ID = 20_000_000

export const MAIL_KINDS = ["beads_paid", "beads_free", "mana", "exp", "item", "chara", "equip"] as const
export type MailKind = typeof MAIL_KINDS[number]
export const REPEAT_UNITS = ["day", "week", "month", "year"] as const
export type RepeatUnit = typeof REPEAT_UNITS[number]

/** The game's mail type for each kind (src/nya/mail.ts MAIL_TYPE). */
export const MAIL_TYPE_OF: Record<MailKind, number> = {
    item: 1, beads_paid: 3, beads_free: 4, chara: 5, equip: 6, mana: 8, exp: 9,
}
const KIND_WORDS: Record<MailKind, string> = {
    beads_paid: "Paid beads", beads_free: "Free beads", mana: "Mana", exp: "EXP", item: "Item", chara: "Unit", equip: "Armament",
}
const needsId = (kind: MailKind) => kind === "item" || kind === "chara" || kind === "equip"

export interface MailSchedule {
    id: number
    kind: MailKind
    /** the item, unit or armament id (null for beads, mana and EXP) */
    typeId: number | null
    amount: number
    title: string
    message: string
    /** first send time, server time (UTC), ISO */
    start: string
    /** 0: once; else every `every` `unit`s after the first */
    every: number
    unit: RepeatUnit
    /** how many times in all; null: forever */
    times: number | null
    /** server time (ms) when it was last saved: send times before it are skipped */
    savedAt: number
}

/** A delivered, unclaimed mail as the game's mail list wants it (plus which schedule it came from). */
export interface ScheduledMail {
    id: number
    create_time: string
    description: string
    number: number
    reason_id: number
    receive_time: string
    reward_limit_time: string
    reward_period_limited: boolean
    subject: string
    type: number
    type_id?: number
    scheduleId: number
    /** server ms it arrived / stops being claimable */
    at: number
    expires: number
}

interface PlayerState {
    /** per schedule: the next send to deliver, for which save of the schedule */
    /** timing: the schedule's start/repeat when this progress began (an edit of only the title or message keeps it) */
    progress: Record<string, { savedAt: number, next: number, timing?: string }>
    mails: ScheduledMail[]
    /** how many each schedule delivered to this save (shown on the dashboard) */
    delivered?: Record<string, number>
}
interface Delivered { nextMailId: number, players: Record<string, PlayerState> }

// ---- files (cached by modification time, like the other dashboard settings) ----

let scheduleCache: { mtimeMs: number, list: MailSchedule[] } | null = null

function readJson<T>(file: string, fallback: T): T {
    try {
        if (!existsSync(file)) return fallback
        return JSON.parse(readFileSync(file, "utf8")) as T
    } catch {
        return fallback
    }
}
function writeJson(file: string, value: unknown) {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(file, JSON.stringify(value, null, 1))
}

export function listMailSchedules(): MailSchedule[] {
    try {
        if (!existsSync(SCHEDULE_FILE)) return []
        const mtimeMs = statSync(SCHEDULE_FILE).mtimeMs
        if (scheduleCache === null || scheduleCache.mtimeMs !== mtimeMs) {
            const raw = readJson<{ schedules?: unknown[] }>(SCHEDULE_FILE, {})
            const list = (Array.isArray(raw.schedules) ? raw.schedules : []).filter((s): s is MailSchedule => {
                try { checkSchedule(s as MailSchedule); return true } catch { return false }
            })
            scheduleCache = { mtimeMs, list }
        }
        return JSON.parse(JSON.stringify(scheduleCache.list))
    } catch {
        return []
    }
}
/** The next schedule id: ids are never reused (a deleted schedule's deliveries are kept under its id). */
function nextScheduleId(list: MailSchedule[]): number {
    const raw = readJson<{ nextId?: unknown }>(SCHEDULE_FILE, {})
    const stored = Number.isSafeInteger(raw.nextId) ? raw.nextId as number : 1
    // ...nor any id a save already has deliveries for
    const used = Object.values(readDelivered().players).flatMap(p => Object.keys(p.progress ?? {}).map(Number))
    return Math.max(stored, ...list.map(x => x.id + 1), ...used.map(id => id + 1), 1)
}
function saveSchedules(list: MailSchedule[], nextId?: number) {
    const raw = readJson<{ nextId?: unknown }>(SCHEDULE_FILE, {})
    const keep = Number.isSafeInteger(raw.nextId) ? raw.nextId as number : undefined
    writeJson(SCHEDULE_FILE, { schedules: list, nextId: nextId ?? keep ?? Math.max(1, ...list.map(x => x.id + 1)) })
    scheduleCache = null
}
const readDelivered = (): Delivered => {
    const d = readJson<Partial<Delivered>>(DELIVERED_FILE, {})
    return { nextMailId: Number.isSafeInteger(d.nextMailId) ? d.nextMailId! : FIRST_MAIL_ID, players: d.players ?? {} }
}
const writeDelivered = (d: Delivered) => writeJson(DELIVERED_FILE, d)

// ---- checking and saving schedules ----

const isInt = (v: unknown, min: number, max: number) => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max

/** Throws a readable message when a schedule isn't usable. */
function checkSchedule(s: MailSchedule) {
    if (!MAIL_KINDS.includes(s.kind)) throw new Error("Pick what to send.")
    if (needsId(s.kind) ? !isInt(s.typeId, 1, 999_999_999) : s.typeId !== null) throw new Error(`${KIND_WORDS[s.kind]}: ${needsId(s.kind) ? "type its id number" : "no id needed"}.`)
    if (!isInt(s.amount, 1, 99_999_999)) throw new Error("The amount must be a whole number from 1.")
    if (typeof s.title !== "string" || s.title.length > MAX_TITLE) throw new Error(`The title can be at most ${MAX_TITLE} characters.`)
    if (typeof s.message !== "string" || s.message.length > MAX_MESSAGE) throw new Error(`The message can be at most ${MAX_MESSAGE} characters.`)
    if (typeof s.start !== "string" || Number.isNaN(Date.parse(s.start))) throw new Error("Pick the first send date and time.")
    if (!isInt(s.every, 0, 999)) throw new Error("Repeat every: a whole number (0 for once).")
    if (!REPEAT_UNITS.includes(s.unit)) throw new Error("Repeat every: days, weeks, months or years.")
    if (s.every > 0 ? !(s.times === null || isInt(s.times, 1, 9999)) : s.times !== 1) throw new Error("How many times: 1 to 9999, or forever.")
}

/** The default title, when none was typed: "Paid beads * 1500", "Item 1001 * 3". */
export function defaultTitle(kind: MailKind, typeId: number | null, amount: number): string {
    return `${KIND_WORDS[kind]}${typeId !== null ? " " + typeId : ""} * ${amount}`
}
export const DEFAULT_MESSAGE = "A gift from the server."

/** Adds (no id) or replaces (id) a schedule from the dashboard. Throws with a readable message. Returns the list. */
export function saveMailSchedule(input: Record<string, unknown>): MailSchedule[] {
    const list = listMailSchedules()
    const kind = input.kind as MailKind
    const every = Number(input.every ?? 0)
    const s: MailSchedule = {
        id: 0,
        kind,
        typeId: MAIL_KINDS.includes(kind) && needsId(kind) ? Number(input.typeId) : null,
        amount: Number(input.amount),
        title: String(input.title ?? "").trim(),
        message: String(input.message ?? "").trim(),
        start: typeof input.start === "string" ? new Date(Date.parse(input.start)).toISOString() : "",
        every,
        unit: (input.unit ?? "day") as RepeatUnit,
        times: every > 0 ? (input.times === null || input.times === "" || input.times === undefined ? null : Number(input.times)) : 1,
        savedAt: getServerDate().getTime(),
    }
    if (input.start && Number.isNaN(Date.parse(String(input.start)))) s.start = ""
    checkSchedule(s)
    if (input.id !== undefined && input.id !== null) {
        const at = list.findIndex(x => x.id === Number(input.id))
        if (at < 0) throw new Error("That scheduled mail no longer exists.")
        s.id = list[at].id
        list[at] = s
    } else {
        s.id = nextScheduleId(list)
        list.push(s)
        saveSchedules(list, s.id + 1)
        return list
    }
    saveSchedules(list)
    return list
}

/** Deletes a schedule. Mails it already delivered stay in the mailbox until claimed or expired. */
export function deleteMailSchedule(id: number): MailSchedule[] {
    const list = listMailSchedules().filter(s => s.id !== id)
    saveSchedules(list)
    return list
}

// ---- send times ----

const PERIOD_MS: Partial<Record<RepeatUnit, number>> = { day: DAY, week: 7 * DAY }

/** The k-th send time (0 = the first), in ms. Months and years keep the day of the month (31st -> 30th/28th). */
export function sendTime(s: MailSchedule, k: number): number {
    const start = Date.parse(s.start)
    if (k === 0 || s.every === 0) return start
    const fixed = PERIOD_MS[s.unit]
    if (fixed !== undefined) return start + k * s.every * fixed
    const d = new Date(start)
    const months = k * s.every * (s.unit === "year" ? 12 : 1)
    const y = d.getUTCFullYear() + Math.floor((d.getUTCMonth() + months) / 12)
    const m = (d.getUTCMonth() + months) % 12
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    return Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())
}
const sendCount = (s: MailSchedule) => s.every === 0 ? 1 : s.times

/** The first send not before `from` (ms), or the count when there is none. A minute's grace: "now" counts. */
function firstSendFrom(s: MailSchedule, from: number): number {
    const limit = sendCount(s) ?? Infinity
    const fixed = PERIOD_MS[s.unit]
    let k = 0
    if (s.every > 0 && fixed !== undefined) k = Math.max(0, Math.ceil((from - Date.parse(s.start)) / (s.every * fixed)) - 1)
    for (let i = 0; i < 100_000 && k < limit && sendTime(s, k) < from; i++) k++
    return Math.min(k, limit)
}

/** The next send at or after `now` (ms), or null when the schedule is done. */
export function nextSendTime(s: MailSchedule, now: number): number | null {
    const k = firstSendFrom(s, Math.max(now, s.savedAt - 60_000))
    const limit = sendCount(s)
    return limit !== null && k >= limit ? null : sendTime(s, k)
}

// ---- who gets it ----

/** Whether this save gets scheduled mail: the CN app's chosen account (Players tab / CN_ACCOUNT_ID), or any save without one. */
export function isActiveSave(playerId: number): boolean {
    const account = cnLinkedAccountId()
    if (account === null) return true
    try {
        return getAccountPlayersSync(account).includes(playerId)
    } catch {
        return false
    }
}

// ---- delivery ----

const date2str = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, "")

/**
 * Delivers what's due to a save and drops its expired mails. Returns its unclaimed mails (oldest first).
 * Saves the file only when something changed.
 */
export function scheduledMailsFor(playerId: number, now = getServerDate().getTime()): ScheduledMail[] {
    const d = readDelivered()
    const key = String(playerId)
    const state: PlayerState = d.players[key] ?? { progress: {}, mails: [] }
    let changed = false

    if (isActiveSave(playerId)) {
        for (const s of listMailSchedules()) {
            const p = state.progress[s.id]
            const timing = timingOf(s)
            const limit = sendCount(s) ?? Infinity
            const deliver = (at: number) => {
                state.mails.push({
                    id: d.nextMailId++,
                    create_time: date2str(at),
                    description: s.message || DEFAULT_MESSAGE,
                    number: s.amount,
                    reason_id: 1,
                    receive_time: "0000-00-00 00:00:00",
                    reward_limit_time: date2str(at + MAIL_DAYS * DAY),
                    reward_period_limited: false,
                    subject: s.title || defaultTitle(s.kind, s.typeId, s.amount),
                    type: MAIL_TYPE_OF[s.kind],
                    ...(s.typeId !== null ? { type_id: s.typeId } : {}),
                    scheduleId: s.id,
                    at,
                    expires: at + MAIL_DAYS * DAY,
                })
                state.delivered = { ...(state.delivered ?? {}), [s.id]: (state.delivered?.[s.id] ?? 0) + 1 }
            }
            // a new schedule, or one whose times changed (an edit of only its title or message carries on)
            const fresh = p === undefined || (p.timing !== undefined ? p.timing !== timing : p.savedAt !== s.savedAt)
            let k: number
            if (fresh) {
                // its sends from the moment it was saved on...
                k = firstSendFrom(s, s.savedAt - 60_000)
                // ...and when its first send time had already passed, one right away (then it keeps its own times)
                // (not when a send of its own is due right now anyway)
                if (k > 0 && (k >= limit || sendTime(s, k) > s.savedAt) && s.savedAt + MAIL_DAYS * DAY > now) deliver(s.savedAt)
            } else {
                k = p.next
            }
            // sends more than 30 days back would have expired already
            const skipTo = firstSendFrom(s, now - MAIL_DAYS * DAY)
            if (k < skipTo) k = skipTo
            for (let i = 0; i < 1000 && k < limit; i++) {
                const at = sendTime(s, k)
                if (at > now) break
                deliver(at)
                k++
            }
            if (p === undefined || p.savedAt !== s.savedAt || p.next !== k || p.timing !== timing) {
                state.progress[s.id] = { savedAt: s.savedAt, next: k, timing }
                changed = true
            }
        }
    }

    const kept = state.mails.filter(m => m.expires > now)
    if (kept.length !== state.mails.length) changed = true
    state.mails = kept.sort((a, b) => a.at - b.at || a.id - b.id)
    if (changed) {
        d.players[key] = state
        writeDelivered(d)
    }
    return state.mails.map(m => ({ ...m }))
}

/** Takes a delivered mail out once it's claimed. */
export function removeScheduledMail(playerId: number, mailId: number) {
    const d = readDelivered()
    const state = d.players[String(playerId)]
    if (!state) return
    const before = state.mails.length
    state.mails = state.mails.filter(m => m.id !== mailId)
    if (state.mails.length !== before) writeDelivered(d)
}

/** A schedule's times, as one string: progress carries on through an edit that leaves them alone. */
const timingOf = (s: MailSchedule) => [s.start, s.every, s.unit, s.times].join("|")

/** Whether a mail id is a scheduled one. */
export const isScheduledMailId = (id: number) => id >= FIRST_MAIL_ID && id < 90_000_000

/** For the dashboard: each schedule with its next send and, for the given save, how many were delivered and wait unclaimed. */
export function mailScheduleStatus(playerId: number | null, now = getServerDate().getTime()) {
    // the active save: deliver what's due first, so the counts are current
    if (playerId !== null) scheduledMailsFor(playerId, now)
    // no active save (each device its own account): every save that has received some, added up
    const players = Object.entries(readDelivered().players).filter(([id]) => playerId === null || id === String(playerId)).map(([, state]) => state)
    return listMailSchedules().map(s => {
        const next = nextSendTime(s, now)
        return {
            ...s,
            next: next === null ? null : new Date(next).toISOString(),
            delivered: players.reduce((n, p) => n + (p.delivered?.[s.id] ?? 0), 0),
            waiting: players.reduce((n, p) => n + p.mails.filter(m => m.scheduleId === s.id && m.expires > now).length, 0),
        }
    })
}
