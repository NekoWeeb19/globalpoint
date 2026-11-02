// Event schedule: moves an event (and everything tied to it) to new dates.
//
// assets/event_catalog.json (scripts/gen_event_catalog.cjs) lists every timed event and the rows
// of other tables that belong to it. A schedule entry gives an event a new start and end; every
// date in each of its rows is moved by the same rule (mapInstant), so the event, its quests,
// missions, shop and tokens open and close together.
//
// Time zones: the game reads the dates in its data as Japan time (UTC+9), so "2023-11-26 14:00:00"
// is 05:00 UTC. The server's own checks read the same text as UTC. A moved row is written for each
// reader: Japan time in the game's files (formatMasterDate), UTC in the server's copies
// (formatServerDate), so both see the event open at the same moment.
//
// Everything in this file is plain logic with no side effects.

export const MASTER_UTC_OFFSET_MS = 9 * 60 * 60 * 1000
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
const DATE_IN_TEXT = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g

export interface CatalogEvent {
    key: string, // "<family>:<id>"
    /** Which apps have it: global, CN, or both (set when the CN-only catalog is merged in). */
    servers?: ("global" | "cn")[],
    family: string,
    id: string,
    dev: string,
    name: string,
    rerunOf: string | null,
    start: string, // as written in the data (Japan time)
    end: string,
    close: string,
    rowCount: number,
    bannerType?: "unit" | "armament", // summon banners only
    image?: string | null, // picture id in .cdn/dashboard_images (the event's banner)
    bannerInfo?: { id: string, name: string, image: string | null }[], // summon banners that opened with it
    rows: Record<string, string[]>, // hashed file -> row paths ("key/key")
    banners: Record<string, string[]>
}

export interface EventCatalog {
    families: Record<string, string>,
    tables: Record<string, string>, // hashed file -> logical path
    events: CatalogEvent[]
}

/** Times are ms since 1970 (UTC). */
export interface EventWindow {
    start: number,
    end: number, // play ends
    close: number // shops and rewards close
}

export interface ScheduleEntry {
    key: string,
    start: string, // ISO date (UTC)
    end: string,
    moveBanners: boolean,
    /** Summon banners (gacha ids) that stay where they are even though moveBanners is on. */
    skipBanners?: string[]
}

export interface Schedule {
    entries: ScheduleEntry[]
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0")

function parseDateText(text: string, offsetMs: number): number | null {
    const m = DATE_TEXT.exec(text)
    if (m === null) return null
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
    const check = new Date(ms)
    if (check.getUTCMonth() !== +m[2] - 1 || check.getUTCDate() !== +m[3]) return null // e.g. Feb 30
    return ms - offsetMs
}

function formatDateText(ms: number, offsetMs: number): string {
    const d = new Date(ms + offsetMs)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

/** A date from the game's data (Japan time) as a moment, or null if it isn't one. */
export const parseMasterDate = (text: string): number | null => parseDateText(text, MASTER_UTC_OFFSET_MS)
/** A moment written the way the game's data writes it (Japan time). */
export const formatMasterDate = (ms: number): string => formatDateText(ms, MASTER_UTC_OFFSET_MS)
/** A moment written the way the server's own data checks read it (UTC). */
export const formatServerDate = (ms: number): string => formatDateText(ms, 0)

/** An event's own window, from its catalog dates. */
export function eventWindow(event: Pick<CatalogEvent, "start" | "end" | "close">): EventWindow | null {
    const start = parseMasterDate(event.start), end = parseMasterDate(event.end), close = parseMasterDate(event.close)
    if (start === null || end === null || close === null) return null
    return { start, end, close: Math.max(close, end) }
}

/**
 * Where a date tied to an event lands when the event moves from `from` to `to` (start and end).
 *  - the event's end becomes the new end;
 *  - dates during the event keep their distance from the start (daily quests, phases), but never
 *    go past the new end (when the event is made shorter);
 *  - dates after the end keep their distance from the end (shops and rewards closing later);
 *  - dates before the start keep their distance from the start.
 */
export function mapInstant(ms: number, from: EventWindow, to: { start: number, end: number }): number {
    if (ms === from.end) return to.end
    if (ms > from.end) return to.end + (ms - from.end)
    if (ms < from.start) return to.start + (ms - from.start)
    return Math.min(to.start + (ms - from.start), to.end)
}

/**
 * Moves every date in a row of the game's data. `write` formats the moved moment (Japan time for
 * the game's files, UTC for the server's copies). Text that isn't a real date is left alone.
 */
export function remapText(text: string, from: EventWindow, to: { start: number, end: number }, write: (ms: number) => string): string {
    return text.replace(DATE_IN_TEXT, found => {
        const ms = parseMasterDate(found)
        return ms === null ? found : write(mapInstant(ms, from, to))
    })
}

const isoMs = (value: unknown): number | null => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?Z$/.test(value)) return null
    const ms = Date.parse(value)
    return isNaN(ms) ? null : ms
}

/**
 * Reads a saved schedule. Entries that aren't valid are dropped and reported.
 */
export function parseSchedule(raw: unknown, catalog: Pick<EventCatalog, "events">): { schedule: Schedule, problems: string[] } {
    const problems: string[] = []
    const entries: ScheduleEntry[] = []
    const list = typeof raw === "object" && raw !== null && Array.isArray((raw as { entries?: unknown }).entries) ? (raw as { entries: unknown[] }).entries : []
    for (const item of list) {
        const entry = item as Partial<ScheduleEntry>
        const candidate: ScheduleEntry = {
            key: String(entry?.key ?? ""), start: String(entry?.start ?? ""), end: String(entry?.end ?? ""),
            moveBanners: entry?.moveBanners !== false,
            ...(Array.isArray(entry?.skipBanners) && entry.skipBanners.length > 0 ? { skipBanners: entry.skipBanners.map(String) } : {})
        }
        const problem = checkEntry(candidate, catalog, entries)
        if (problem === null) entries.push(candidate)
        else problems.push(`${candidate.key || "(no event)"}: ${problem}`)
    }
    return { schedule: { entries }, problems }
}

/**
 * Why an entry can't be used, or null if it's fine. `others` are the entries already accepted.
 */
export function checkEntry(entry: ScheduleEntry, catalog: Pick<EventCatalog, "events">, others: ScheduleEntry[] = []): string | null {
    const event = catalog.events.find(e => e.key === entry.key)
    if (event === undefined) return "unknown event"
    if (eventWindow(event) === null) return "the event's own dates can't be read"
    const start = isoMs(entry.start), end = isoMs(entry.end)
    if (start === null || end === null) return "start and end must be dates (UTC)"
    if (end <= start) return "the end must be after the start"
    if (end - start > 366 * 24 * 60 * 60 * 1000) return "an event can run for a year at most"
    if (others.some(other => other.key === entry.key)) return "the event is already scheduled"
    return null
}

export interface RowMove {
    eventKey: string,
    from: EventWindow,
    to: { start: number, end: number }
}

/**
 * Which rows move, and how: "<hashed file>#<path>" -> move. Summon banners scheduled on their own
 * (family "gacha") come first, so they keep their own dates instead of moving with an event that
 * opened with them. Otherwise a row that belongs to two scheduled events follows the first one in
 * the schedule; those rows are reported as conflicts.
 */
export function planRowMoves(catalog: Pick<EventCatalog, "events">, schedule: Schedule): { moves: Map<string, RowMove>, conflicts: string[] } {
    const moves = new Map<string, RowMove>()
    const conflicts: string[] = []
    const familyOf = (key: string) => catalog.events.find(e => e.key === key)?.family
    const nameOf = (key: string) => catalog.events.find(e => e.key === key)?.name ?? key
    const ordered = [...schedule.entries].sort((a, b) => Number(familyOf(a.key) !== "gacha") - Number(familyOf(b.key) !== "gacha"))
    for (const entry of ordered) {
        const event = catalog.events.find(e => e.key === entry.key)
        const from = event === undefined ? null : eventWindow(event)
        const start = isoMs(entry.start), end = isoMs(entry.end)
        if (event === undefined || from === null || start === null || end === null) continue
        const move: RowMove = { eventKey: event.key, from, to: { start, end } }
        // the event's banners, minus the ones the entry keeps where they are
        const skip = new Set(entry.skipBanners ?? [])
        const banners = Object.fromEntries(Object.entries(event.banners).map(([file, paths]) => [file, paths.filter(p => !skip.has(p))]))
        const groups = entry.moveBanners ? [event.rows, banners] : [event.rows]
        for (const group of groups) for (const [file, paths] of Object.entries(group)) for (const p of paths) {
            const key = `${file}#${p}`
            const existing = moves.get(key)
            if (existing !== undefined) {
                if (existing.eventKey === event.key) continue
                conflicts.push(familyOf(existing.eventKey) === "gacha"
                    ? `The banner "${nameOf(existing.eventKey)}" has its own dates on the Summons tab, so it doesn't move with "${nameOf(event.key)}".`
                    : `${key} belongs to ${existing.eventKey} and ${event.key}; it follows ${existing.eventKey}`)
                continue
            }
            moves.set(key, move)
        }
    }
    return { moves, conflicts }
}

/**
 * Moves the date fields of one of the server's own records (a mission, shop item, ...): every
 * string field that is a date is moved and written in UTC, the way the server reads it.
 * `original` holds the record's untouched values, so moving again always starts from them.
 */
export function remapRecordDates(record: Record<string, unknown>, original: Record<string, string>, move: RowMove | undefined): void {
    for (const [field, value] of Object.entries(original)) {
        if (move === undefined) { record[field] = value; continue }
        const ms = parseMasterDate(value)
        record[field] = ms === null ? value : formatServerDate(mapInstant(ms, move.from, move.to))
    }
}

/** The date fields of a record (string fields holding a date), for remapRecordDates. */
export function dateFields(record: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [field, value] of Object.entries(record)) if (typeof value === "string" && DATE_TEXT.test(value)) out[field] = value
    return out
}
