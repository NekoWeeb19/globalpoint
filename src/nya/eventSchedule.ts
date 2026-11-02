// Wiring for the event schedule (src/lib/eventSchedule.ts): keeps the schedule in
// .database/event_schedule.json, moves the server's own copies of the moved rows (missions, event
// shop items, event tokens, boss event and raid dates, summon banners), and rebuilds the game's mod
// (.cdn/mods/event_schedule.zip, by scripts/gen_event_schedule_mod.cjs) so the game shows the
// same dates.

import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import catalogData from "../../assets/event_catalog.json"
import missionData from "../../assets/missions.json"
import eventShopData from "../../assets/event_item_shop.json"
import itemRulesData from "../../assets/item_rules.json"
import adventRulesData from "../../assets/advent_event_rules.json"
import raidData from "../../assets/raid_event.json"
import periodicRewardData from "../../assets/periodic_reward.json"
import loginBonusData from "../../assets/login_bonus.json"
import gachaData from "../../assets/gacha.json"
import {
    CatalogEvent, checkEntry, dateFields, EventCatalog, eventWindow, parseSchedule, planRowMoves, remapRecordDates,
    RowMove, Schedule, ScheduleEntry
} from "../lib/eventSchedule"
import { getServerDate } from "../utils"
import { cdnDir, cnCdnRoot, cnCopyWindow } from "../lib/cnClient"
import { reloadMods } from "../routes/api/asset"

// global's events, plus the events only the CN client has (assets/event_catalog_cn.json, from
// scripts/gen_event_catalog.cjs --cn): scheduling one of those changes only the CN game files
// (scripts/gen_cn_event_schedule.cjs); global's event mod skips it
const catalog = withCnEvents(catalogData as unknown as EventCatalog)

function withCnEvents(global: EventCatalog): EventCatalog {
    const file = path.join(__dirname, "..", "..", "assets", "event_catalog_cn.json")
    if (!existsSync(file)) return global
    try {
        const cn = JSON.parse(readFileSync(file, "utf-8")) as EventCatalog & { shared?: string[] }
        // global's entries the CN files also have (same id and internal name) are in both apps
        const shared = new Set(cn.shared ?? [])
        const known = new Set(global.events.map(e => e.key))
        const tagged = global.events.map(e => ({ ...e, servers: shared.has(e.key) ? ["global", "cn"] : ["global"] } as CatalogEvent))
        const extra = cn.events.filter(e => !known.has(e.key)).map(e => ({ ...e, servers: ["cn"] } as CatalogEvent))
        return { ...global, families: { ...cn.families, ...global.families }, tables: { ...cn.tables, ...global.tables }, events: [...tagged, ...extra] }
    } catch (error) {
        console.error(`[cn] event_catalog_cn.json not read: ${(error as Error).message}`)
        return global
    }
}
const SCHEDULE_FILE = path.join(process.cwd(), ".database", "event_schedule.json")
const MOD_SCRIPT = path.join(__dirname, "..", "..", "scripts", "gen_event_schedule_mod.cjs")
// the same schedule for the CN client: a new CN game-file update (scripts/gen_cn_event_schedule.cjs)
const CN_SCRIPT = path.join(__dirname, "..", "..", "scripts", "gen_cn_event_schedule.cjs")
// the scripts run as worker threads, not second Node processes (the phone companion's embedded Node
// can't start one): scripts/run_script.cjs
type ScriptResult = { code: number, stdout: string, stderr: string }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runScript } = require(path.join(__dirname, "..", "..", "scripts", "run_script.cjs")) as { runScript: (file: string) => Promise<ScriptResult> }
const lastLines = (text: string, n: number) => text.trim().split("\n").slice(-n).join(" ")
let cnRunning = false, cnAgain = false
/** Rebuilds the CN client's schedule update in the background (only when the CN game files are set up). */
function rebuildCnSchedule() {
    if (!existsSync(cnCdnRoot())) return
    if (cnRunning) { cnAgain = true; return }
    cnRunning = true
    runScript(CN_SCRIPT).then(({ code, stdout, stderr }) => {
        cnRunning = false
        if (code !== 0) console.error(`[cn] schedule update failed: ${lastLines(stderr || stdout, 3)}`)
        else console.log(`[cn] ${lastLines(stdout, 1)}`)
        if (cnAgain) { cnAgain = false; rebuildCnSchedule() }
    })
}
/**
 * The CN update has yearly campaign copies only for a few years around the game clock (the CN client
 * scans them all for every event banner). Rebuilds it when the game year gets near the window's edge.
 */
function checkCnCopyWindow() {
    const w = cnCopyWindow()
    if (w === null) return
    const year = getServerDate().getUTCFullYear()
    if (year - 1 < w.from || year + 1 > w.until) {
        console.log(`[cn] game year ${year} is outside the yearly copies (${w.from}-${w.until}); rebuilding the CN schedule update`)
        rebuildCnSchedule()
    }
}
const SALT = "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy"

const fileOf = (logical: string) => {
    const h = createHash("sha1").update(logical + SALT).digest("hex")
    return `production/upload/${h.slice(0, 2)}/${h.slice(2)}`
}

type DatedRecord = Record<string, unknown>

/** The server's own records that copy a row of the game's data: [row key, record]. */
function* serverRecords(): Generator<[string, DatedRecord]> {
    const missionTables: Record<string, string> = {
        "1": "master/mission/regular_mission.orderedmap",
        "2": "master/mission/daily_mission.orderedmap",
        "3": "master/mission/event_mission.orderedmap",
        "4": "master/mission/collect_item_event_mission.orderedmap",
    }
    const missions = (missionData as unknown as { missions: Record<string, Record<string, DatedRecord>> }).missions
    for (const [category, table] of Object.entries(missionTables)) {
        const file = fileOf(table)
        for (const [id, record] of Object.entries(missions[category] ?? {})) yield [`${file}#${id}`, record]
    }

    const shopFile = fileOf("master/shop/event_item_shop.orderedmap")
    for (const byEvent of Object.values(eventShopData as unknown as Record<string, Record<string, Record<string, DatedRecord>>>)) {
        for (const rows of Object.values(byEvent)) for (const [id, record] of Object.entries(rows)) yield [`${shopFile}#${id}`, record]
    }

    const itemFile = fileOf("master/item/item.orderedmap")
    for (const [id, record] of Object.entries((itemRulesData as unknown as { items: Record<string, DatedRecord> }).items)) yield [`${itemFile}#${id}`, record]

    // boss event quests: quest id = event id * 1000 + quest number
    const adventQuestFile = fileOf("master/quest/event/advent_event_quest.orderedmap")
    for (const [questId, record] of Object.entries((adventRulesData as unknown as { quests: Record<string, DatedRecord> }).quests)) {
        const id = Number(questId)
        yield [`${adventQuestFile}#${Math.floor(id / 1000)}/${id % 1000}`, record]
    }

    const raidFile = fileOf("master/quest/event/raid_event.orderedmap")
    for (const [id, record] of Object.entries((raidData as unknown as { events: Record<string, DatedRecord> }).events)) yield [`${raidFile}#${id}`, record]

    const pointFile = fileOf("master/reward/periodic_reward_point.orderedmap")
    for (const [id, record] of Object.entries((periodicRewardData as unknown as { points: Record<string, DatedRecord> }).points)) yield [`${pointFile}#${id}`, record]

    // a login bonus group's rows are "<group>/<day>"; the group follows its first day's row
    const bonusFile = fileOf("master/bonus/login_bonus.orderedmap")
    for (const [group, record] of Object.entries((loginBonusData as unknown as { groups: Record<string, DatedRecord> }).groups)) yield [`${bonusFile}#${group}/1`, record]

    const gachaFile = fileOf("master/gacha/gacha.orderedmap")
    for (const [id, record] of Object.entries(gachaData as unknown as Record<string, DatedRecord>)) yield [`${gachaFile}#${id}`, record]
}

// untouched date fields of every server record, so a new schedule always starts from the originals
const originals = new WeakMap<DatedRecord, Record<string, string>>()

let schedule: Schedule = { entries: [] }
let lastProblems: string[] = []
let lastConflicts: string[] = []
let modStatus: { state: "idle" | "building" | "failed", message: string } = { state: "idle", message: "" }

// later steps that change the same server records (the yearly campaigns), run after every move
const serverDataSteps: ((moves: Map<string, RowMove>) => void)[] = []

/** Adds a step run after the event schedule moves the server's records (and each time it does again). */
export function addServerDataStep(step: (moves: Map<string, RowMove>) => void) {
    serverDataSteps.push(step)
}

/** The key of a server record in the moves (see serverRecords). */
export const serverRecordKey = (table: string, rowPath: string) => `${fileOf(table)}#${rowPath}`

/** Puts the server's records back to their original dates, moves the scheduled ones, then runs the later steps. */
export function applyEventScheduleToServerData(): number {
    return applyToServerData()
}

function applyToServerData() {
    const { moves, conflicts } = planRowMoves(catalog, schedule)
    lastConflicts = conflicts
    let moved = 0
    for (const [key, record] of serverRecords()) {
        let original = originals.get(record)
        if (original === undefined) {
            original = dateFields(record)
            originals.set(record, original)
        }
        if (Object.keys(original).length === 0) continue
        const move: RowMove | undefined = moves.get(key)
        remapRecordDates(record, original, move)
        if (move !== undefined) moved++
    }
    for (const step of serverDataSteps) step(moves)
    return moved
}

function saveSchedule() {
    mkdirSync(path.dirname(SCHEDULE_FILE), { recursive: true })
    writeFileSync(SCHEDULE_FILE, JSON.stringify({ entries: schedule.entries }, null, 1))
}

/** Where the game's mod is (being) updated. */
export const getScheduleModStatus = () => modStatus

/**
 * Rebuilds the game's mod from the saved schedules (events and yearly campaigns), then tells the game
 * a new download is ready.
 */
export function rebuildMod(): Promise<void> {
    modStatus = { state: "building", message: "Updating the game's data files..." }
    // the CN client's update doesn't depend on the global one: it is rebuilt either way
    rebuildCnSchedule()
    // a CN-only setup (the shared package) has no global game files to build the global mod from
    if (!existsSync(path.join(cdnDir(), "en", "entities"))) {
        modStatus = { state: "idle", message: "Schedule saved (CN game update rebuilding)." }
        return Promise.resolve()
    }
    return runScript(MOD_SCRIPT).then(({ code, stdout, stderr }) => {
        if (code !== 0) {
            modStatus = { state: "failed", message: `The game's data files could not be updated: ${lastLines(stderr || stdout, 3)}` }
            console.error(modStatus.message)
        } else {
            reloadMods()
            modStatus = { state: "idle", message: lastLines(stdout, 1) }
        }
    })
}

/**
 * Loads the saved schedule and moves the server's data to match. Call once when the server starts.
 */
export function initEventSchedule() {
    // first check after a minute: the server clock (initServerClock) is set after this runs
    setTimeout(checkCnCopyWindow, 60 * 1000).unref()
    setInterval(checkCnCopyWindow, 10 * 60 * 1000).unref()
    if (existsSync(SCHEDULE_FILE)) {
        try {
            const { schedule: loaded, problems } = parseSchedule(JSON.parse(readFileSync(SCHEDULE_FILE, "utf-8")), catalog)
            schedule = loaded
            lastProblems = problems
            for (const problem of problems) console.warn(`Event schedule: ${problem} (skipped)`)
        } catch (error) {
            console.error(`Could not read the event schedule: ${(error as Error).message}`)
        }
    }
    if (schedule.entries.length === 0) return
    const moved = applyEventScheduleToServerData()
    console.log(`Event schedule: ${schedule.entries.length} event(s) moved (${moved} server records).`)
}

export interface EventOverview {
    key: string,
    /** Which apps it is in: ["global"], ["cn"] or both. */
    servers: ("global" | "cn")[],
    family: string,
    familyLabel: string,
    id: string,
    name: string,
    rerun: boolean,
    original: { start: string, end: string, close: string },
    scheduled: { start: string, end: string, moveBanners: boolean, skipBanners: string[] } | null,
    rowCount: number,
    bannerCount: number,
    bannerType: "unit" | "armament" | null, // summon banners only
    image: string | null, // URL of the event's banner picture
    banners: { name: string, image: string | null }[], // summon banners that opened with it
    state: "upcoming" | "live" | "ended"
}

const imageUrl = (id: string | null | undefined) => id ? `/api/server/event-image/${id}.png` : null

/** Where the dashboard's copy of a game picture is (see scripts/gen_event_catalog.cjs), or null. */
export function eventImagePath(id: string): string | null {
    if (!/^[0-9a-f]{40}$/.test(id)) return null
    const file = path.join(cdnDir(), "dashboard_images", `${id}.png`)
    return existsSync(file) ? file : null
}

const iso = (ms: number) => new Date(ms).toISOString()

/** Every event with its original dates, its scheduled dates (if any) and whether it's on now. */
export function getEventOverview(): { serverDate: string, events: EventOverview[], problems: string[], conflicts: string[], mod: typeof modStatus } {
    const now = getServerDate().getTime()
    const events: EventOverview[] = []
    for (const event of catalog.events) {
        const window = eventWindow(event)
        if (window === null) continue
        const entry = schedule.entries.find(e => e.key === event.key) ?? null
        const start = entry ? Date.parse(entry.start) : window.start
        const end = entry ? Date.parse(entry.end) : window.end
        events.push({
            key: event.key,
            servers: event.servers ?? ["global"],
            family: event.family,
            familyLabel: catalog.families[event.family] ?? event.family,
            id: event.id,
            name: event.name,
            rerun: event.rerunOf !== null,
            original: { start: iso(window.start), end: iso(window.end), close: iso(window.close) },
            scheduled: entry ? { start: entry.start, end: entry.end, moveBanners: entry.moveBanners, skipBanners: entry.skipBanners ?? [] } : null,
            rowCount: event.rowCount,
            bannerCount: Object.values(event.banners).reduce((n, list) => n + list.length, 0),
            image: imageUrl(event.image),
            bannerType: event.bannerType ?? null,
            banners: (event.bannerInfo ?? []).map(b => ({ id: b.id, name: b.name, image: imageUrl(b.image) })),
            state: now < start ? "upcoming" : now <= end ? "live" : "ended"
        })
    }
    return { serverDate: iso(now), events, problems: lastProblems, conflicts: lastConflicts, mod: modStatus }
}

/**
 * Adds or replaces an event's schedule entry, then updates the server's data and the game's mod.
 *
 * @returns null when saved, or why it wasn't.
 */
export async function setEventSchedule(entry: ScheduleEntry): Promise<string | null> {
    const others = schedule.entries.filter(e => e.key !== entry.key)
    const problem = checkEntry(entry, catalog, others)
    if (problem !== null) return problem
    schedule = { entries: [...others, entry] }
    saveSchedule()
    applyToServerData()
    await rebuildMod()
    return null
}

/**
 * Adds or replaces several events' schedule entries at once (one update of the game's files).
 *
 * @returns null when saved, or why not (nothing is saved then).
 */
export async function setEventSchedules(entries: ScheduleEntry[]): Promise<string | null> {
    if (entries.length === 0) return "no events were picked"
    const keys = new Set(entries.map(e => e.key))
    if (keys.size !== entries.length) return "an event was picked twice"
    const kept = schedule.entries.filter(e => !keys.has(e.key))
    const accepted: ScheduleEntry[] = [...kept]
    for (const given of entries) {
        // a group change keeps the banners an event was already set to leave behind
        const previous = schedule.entries.find(e => e.key === given.key)
        const entry = given.skipBanners === undefined && previous?.skipBanners ? { ...given, skipBanners: previous.skipBanners } : given
        const problem = checkEntry(entry, catalog, accepted)
        if (problem !== null) return `${catalog.events.find(e => e.key === entry.key)?.name ?? entry.key}: ${problem}`
        accepted.push(entry)
    }
    schedule = { entries: accepted }
    saveSchedule()
    applyToServerData()
    await rebuildMod()
    return null
}

/**
 * Puts several events back on their original dates at once.
 *
 * @returns How many were scheduled.
 */
export async function removeEventSchedules(keys: string[]): Promise<number> {
    const before = schedule.entries.length
    schedule = { entries: schedule.entries.filter(e => !keys.includes(e.key)) }
    const removed = before - schedule.entries.length
    if (removed === 0) return 0
    saveSchedule()
    applyToServerData()
    await rebuildMod()
    return removed
}

/**
 * Removes an event's schedule entry (it goes back to its original dates).
 *
 * @returns Whether there was one.
 */
export async function removeEventSchedule(key: string): Promise<boolean> {
    const before = schedule.entries.length
    schedule = { entries: schedule.entries.filter(e => e.key !== key) }
    if (schedule.entries.length === before) return false
    saveSchedule()
    applyToServerData()
    await rebuildMod()
    return true
}
