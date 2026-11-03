// Wiring for the yearly seasonal campaigns (src/lib/campaignSchedule.ts): keeps the choices in
// .database/campaign_schedule.json, makes the server's copy of the chosen login bonuses yearly,
// picks the free pull for a banner (a yearly copy that is on wins), resets the copies' free pulls
// once a real day, adds the chosen reward campaign runs' yearly copies to the server's reward
// campaigns (stamina campaigns are only shown and charged by the game itself, so they only go in the
// mod), and has the game's mod (scripts/gen_event_schedule_mod.cjs) rebuilt so the game
// shows the same.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import seasonalData from "../../assets/seasonal_campaigns.json"
import loginBonusData from "../../assets/login_bonus.json"
import gachaData from "../../assets/gacha.json"
import rewardCampaignData from "../../assets/reward_campaign.json"
import staminaCampaignData from "../../assets/stamina_campaign.json"
import getDatabase, { Database } from "../data"
import {
    activeFreePullCopy, CampaignRun, campaignCopyId, campaignRuns, CampaignSchedule, currentOrNextRun, describeRun,
    isWindowOn, KnownRuns, runCopies, TimedCampaign, yearlyClash, FreePullBannerInfo, FreePullCampaign, freePullClash,
    freePullCopies, FreePullCopy, isFreePullBanner, parseCampaignSchedule, SEASONAL_FREE_PULLS,
    SEASONAL_LOGIN_BONUSES, yearlyLoginServerColumns, yearlyPart, CN_SEASONAL_LOGIN_BONUSES, CN_SEASONAL_FREE_PULLS, cnFreePullCopyId, isFreePullCopyId, withCnDates, parseUtcText, keepLongerOnOverlap, runLength, YearlyWindow
} from "../lib/campaignSchedule"
import { cnCampaigns, cnLoginGroup, cnOnlyLoginGroups, setCnLoginGroup, setCnSharedRewardRows } from "./cnCampaigns"
import { cnBuiltFreePullCopies, cnCopyWindow, cnTableIds, inCnRequest } from "../lib/cnClient"
import { LoginBonusGroup, isLoginBonusGroupOpen } from "../lib/loginBonus"
import { dayNumber } from "../lib/mission"
import { getGachaCampaignIdSync } from "../lib/assets"
import { getServerDate } from "../utils"
import { formatMasterDate, parseMasterDate } from "../lib/eventSchedule"
import { addServerDataStep, applyEventScheduleToServerData, cnEventWindows, getScheduleModStatus, rebuildMod, serverRecordKey } from "./eventSchedule"

interface SeasonalData {
    loginBonuses: Record<string, { start: string, end: string, days: number, image: string | null }>,
    freePulls: FreePullCampaign[]
}

const seasonal = seasonalData as unknown as SeasonalData
const groups = (loginBonusData as unknown as { groups: Record<string, LoginBonusGroup> }).groups
const gachas = gachaData as unknown as Record<string, FreePullBannerInfo>
const SCHEDULE_FILE = path.join(process.cwd(), ".database", "campaign_schedule.json")

// the server's reward campaigns (read by the quest finish, src/routes/api/singleBattleQuest.ts): the
// game's own rows, then the yearly copies of the chosen runs
const rewardRows = (rewardCampaignData as unknown as { campaigns: TimedCampaign[] }).campaigns
const ownRewardCount = rewardRows.length
const ownRewardRows: readonly TimedCampaign[] = rewardRows.slice()
const staminaRows = (staminaCampaignData as unknown as { campaigns: TimedCampaign[] }).campaigns
const tables = {
    reward: { rows: ownRewardRows, runs: campaignRuns(ownRewardRows) },
    stamina: { rows: staminaRows, runs: campaignRuns(staminaRows) },
}
const knownRuns: KnownRuns = { reward: tables.reward.runs.map(r => r.key), stamina: tables.stamina.runs.map(r => r.key) }

/** A run's name for messages: "Stamina campaign of 2022-12-26". */
const runName = (kind: "reward" | "stamina", run: CampaignRun) => `${kind === "stamina" ? "Stamina" : "Reward"} campaign of ${run.start.slice(0, 10)}`

let schedule: CampaignSchedule = { yearlyLoginBonuses: [], yearlyFreePulls: [], yearlyRewardRuns: [], yearlyStaminaRuns: [] }
let lastProblems: string[] = []
let copies: FreePullCopy[] = []

/** Makes the chosen login bonuses yearly in the server's copy (run after the event schedule moved them). */
function applyLoginBonuses(moves: Map<string, unknown>) {
    for (const id of Object.keys(SEASONAL_LOGIN_BONUSES)) {
        const group = groups[id]
        if (group === undefined) continue
        // the event schedule has just put start and end back (or moved them); the yearly window is ours
        group.yearlyFrom = null
        group.yearlyUntil = null
        if (!schedule.yearlyLoginBonuses.includes(id) || group.end === null) continue
        if (moves.has(serverRecordKey("master/bonus/login_bonus.orderedmap", `${id}/1`))) {
            // moved dates are already written in UTC
            group.yearlyFrom = yearlyPart(group.start)
            group.yearlyUntil = yearlyPart(group.end)
            group.end = null
            continue
        }
        const columns = yearlyLoginServerColumns(group.start, group.end)
        if (columns === null) continue
        Object.assign(group, columns)
    }
    applyCnSeasonalLoginDates(moves)
    // the CN copies follow CN's dates, which each CN update build writes (this step runs again after it)
    refreshCopies()
}

/** A date from .database/cn_event_windows.json (ISO) as the login bonus groups write it ("YYYY-MM-DD hh:mm:ss" UTC). */
/** Whether UTC-text dates are on at a moment. */
const utcOn = (w: { start: string, end: string }, ms: number) => { const s = parseUtcText(w.start), e = parseUtcText(w.end); return s !== null && e !== null && ms >= s && ms <= e }
const groupDate = (isoText: string) => isoText.slice(0, 19).replace("T", " ")

/**
 * The CN client gets each shared seasonal login bonus on CN's own dates (its CN calendar: global reused many of
 * them at other times, e.g. CN's Golden Week bonus gw2020 ran as global's December "Lunar New Year"), yearly
 * from those dates when chosen. A bonus the event schedule moved follows the move, like global's.
 */
function applyCnSeasonalLoginDates(moves: Map<string, unknown>) {
    const cnDates = cnEventWindows()
    for (const id of Object.keys(SEASONAL_LOGIN_BONUSES)) {
        const group = groups[id], cn = cnDates?.[`login:${id}`]
        if (group === undefined || cn === undefined || moves.has(serverRecordKey("master/bonus/login_bonus.orderedmap", `${id}/1`))) {
            setCnLoginGroup(id, null)
            continue
        }
        const copy: LoginBonusGroup = { ...group, start: groupDate(cn.start), end: groupDate(cn.end), yearlyFrom: null, yearlyUntil: null }
        if (schedule.yearlyLoginBonuses.includes(id)) {
            copy.yearlyFrom = yearlyPart(copy.start)
            copy.yearlyUntil = yearlyPart(copy.end!)
            copy.end = null
        }
        setCnLoginGroup(id, copy)
    }
}

// the CN-only groups' own dates (applyLoginBonuses changes the groups in place)
const cnLoginOriginal = new Map(Object.entries(cnOnlyLoginGroups()).map(([id, g]) => [id, { start: g.start, end: g.end, yearlyFrom: g.yearlyFrom, yearlyUntil: g.yearlyUntil }]))

/** Makes the chosen CN-only login bonuses yearly (their dates are already the server's UTC). */
function applyCnLoginBonuses() {
    const cnGroups = cnOnlyLoginGroups()
    for (const id of Object.keys(CN_SEASONAL_LOGIN_BONUSES)) {
        const group = cnGroups[id], original = cnLoginOriginal.get(id)
        if (group === undefined || original === undefined) continue
        Object.assign(group, original)
        if (!schedule.yearlyLoginBonuses.includes(id) || group.end === null) continue
        group.yearlyFrom = yearlyPart(group.start)
        group.yearlyUntil = yearlyPart(group.end)
        group.end = null
    }
}

// The CN client's free pull copies: the CN-only campaigns' and the shared ones', all on CN's dates (the global
// client gets `copies`, on global's). Shared campaigns are on CN's own dates in the CN game (scripts/
// gen_cn_event_schedule.cjs builds the same copies into its tables).
let cnCopies: FreePullCopy[] = []
const allFreePulls = () => [...seasonal.freePulls, ...cnCampaigns.freePulls] as FreePullCampaign[]
const cnWindow = (key: string) => cnEventWindows()?.[key] ?? null
/** The shared seasonal free pulls on CN's dates (global's when CN's data hasn't one). */
const cnSharedPulls = () => seasonal.freePulls.map(p => withCnDates(p, cnWindow(`freePull:${p.id}`)))
/** Every free pull the CN game has, on its dates: the originals CN copies skip years for. */
const cnAllFreePulls = () => [...cnSharedPulls(), ...cnCampaigns.freePulls] as FreePullCampaign[]

/** A reward/stamina table's rows and runs on CN's dates (the rows CN's data hasn't one for keep global's). */
function cnTable(kind: "reward" | "stamina") {
    const rows = tables[kind].rows.map(row => withCnDates(row, cnWindow(`${kind}:${row.id}`)))
    return { rows, runs: campaignRuns(rows) }
}
/** A global run's CN counterpart: the CN run its first row is in. */
const cnRunOf = (runs: readonly CampaignRun[], run: CampaignRun) => runs.find(r => r.ids.includes(run.ids[0])) ?? run

/** The CN client's reward campaign rows (shared rows on CN's dates, and the chosen runs' copies). */
const cnRewardRows: TimedCampaign[] = []

/**
 * The chosen free pulls' yearly copies, no two at once (keepLongerOnOverlap: the longer campaign keeps a year):
 * on CN's dates for the CN client (cn), on global's for the global one.
 */
function chosenPullCopies(cn: boolean): Map<number, FreePullCopy[]> {
    const pulls = cn ? cnAllFreePulls() : seasonal.freePulls
    const parse = cn ? parseUtcText : parseMasterDate
    const picks = schedule.yearlyFreePulls.flatMap(id => {
        const campaign = pulls.find(c => c.id === id)
        return campaign === undefined ? [] : [{ key: id, length: runLength(campaign, parse), copies: freePullCopies(campaign, pulls) }]
    })
    return keepLongerOnOverlap(picks, parse)
}

/** The chosen reward/stamina runs' yearly copies, no two at once: on CN's dates (cn) or global's. Keyed by global's run key. */
function chosenRunCopies(kind: "reward" | "stamina", cn: boolean): Map<string, YearlyWindow[]> {
    const keys = kind === "reward" ? schedule.yearlyRewardRuns : schedule.yearlyStaminaRuns
    const cnT = cnTable(kind)
    const parse = cn ? parseUtcText : parseMasterDate
    const picks = keys.flatMap(key => {
        const run = tables[kind].runs.find(r => r.key === key)
        if (run === undefined) return []
        const own = cn ? cnRunOf(cnT.runs, run) : run
        return [{ key, length: runLength(own, parse), copies: runCopies(own, cn ? cnT.runs : tables[kind].runs) }]
    })
    return keepLongerOnOverlap(picks, parse)
}

function refreshCopies() {
    applyCnLoginBonuses()
    cnCopies = [...chosenPullCopies(true)].flatMap(([id, list]) =>
        id in CN_SEASONAL_FREE_PULLS ? list.map(copy => ({ ...copy, id: cnFreePullCopyId(copy.year, copy.originalId) })) : list)
    copies = [...chosenPullCopies(false)].flatMap(([id, list]) => id in CN_SEASONAL_FREE_PULLS ? [] : list)
    // reward campaign copies: same rows, new dates and ids (the dates are read like the game's own rows)
    rewardRows.length = ownRewardCount
    cnRewardRows.length = 0
    cnRewardRows.push(...cnTable("reward").rows)
    for (const [rows, kept] of [[rewardRows, chosenRunCopies("reward", false)], [cnRewardRows, chosenRunCopies("reward", true)]] as const) {
        for (const [key, windows] of kept) {
            const run = tables.reward.runs.find(r => r.key === key)!
            for (const window of windows) for (const id of run.ids) {
                const index = ownRewardRows.findIndex(row => row.id === id)
                rows.push({ ...ownRewardRows[index], id: campaignCopyId(window.year, index), start: window.start, end: window.end })
            }
        }
    }
    setCnSharedRewardRows(cnRewardRows)
}

function readSchedule() {
    if (!existsSync(SCHEDULE_FILE)) return
    try {
        const parsed = parseCampaignSchedule(JSON.parse(readFileSync(SCHEDULE_FILE, "utf-8")), knownRuns)
        schedule = parsed.schedule
        lastProblems = parsed.problems
        for (const problem of parsed.problems) console.warn(`Yearly campaigns: ${problem} (skipped)`)
    } catch (error) {
        console.error(`Could not read the yearly campaigns: ${(error as Error).message}`)
    }
}

/** Loads the saved choices and applies them. Call once when the server starts, after initEventSchedule. */
export function initCampaignSchedule() {
    readSchedule()
    addServerDataStep(applyLoginBonuses)
    refreshCopies()
    if (schedule.yearlyLoginBonuses.length > 0) applyEventScheduleToServerData()
    const total = schedule.yearlyLoginBonuses.length + schedule.yearlyFreePulls.length + schedule.yearlyRewardRuns.length + schedule.yearlyStaminaRuns.length
    if (total > 0) {
        console.log(`Yearly campaigns: ${schedule.yearlyLoginBonuses.length} login bonus(es), ${schedule.yearlyFreePulls.length} free pull(s), ${schedule.yearlyRewardRuns.length} reward and ${schedule.yearlyStaminaRuns.length} stamina campaign(s) repeat every year.`)
    }
}

/**
 * The free pull campaign for a banner at a server time: a yearly copy that is running wins (on any
 * regular unit banner), otherwise the game's own campaign for the banner. null when there is none.
 */
export function resolveFreePullCampaignId(gachaId: number, serverMs = getServerDate().getTime()): number | null {
    const gacha = gachas[String(gachaId)]
    if (gacha !== undefined && isFreePullBanner(gacha)) {
        const copy = activeFreePullCopy(copiesForClient(), serverMs, copyDateParser())
        if (copy !== null) return copy.id
    }
    return getGachaCampaignIdSync(gachaId)
}

/**
 * The /load gacha_campaign_list entries for the yearly free pull copy running now: one per regular
 * unit banner (count 1 = today's pull is still there), on top of the player's saved entries. The
 * client shows a banner's free pull only when this list has an entry for it.
 */
/**
 * A player's saved free pull entries, without the yearly copies the CN client's update doesn't have: a save
 * moved from another setup (or a schedule changed since) can name copies this update lacks, and an unknown
 * campaign id stops the CN client with C8601. The global client and non-copy campaigns pass unchanged.
 */
export function cnKnownFreePullEntries<T extends { campaign_id: number }>(list: T[]): T[] {
    if (!inCnRequest()) return list
    return list.filter(entry => !isFreePullCopyId(entry.campaign_id) || cnUpdateHasCopy(entry.campaign_id))
}

/**
 * Whether the CN client's update has a yearly free pull copy. The update builder (scripts/gen_cn_event_schedule.cjs)
 * decides which years get a copy, also counting CN's own free pulls as clashes, so the server's list can name a
 * copy the update skipped (e.g. on the clock set to a free pull's original year): such a copy is never offered.
 */
function cnUpdateHasCopy(id: number): boolean {
    const built = cnBuiltFreePullCopies()
    if (built !== null) return built.has(id)
    // an update from before the copies were recorded: global copies are year * 100 + id, in the copy window
    const window = cnCopyWindow()
    const year = Math.floor(id / 100)
    return window !== null && id < 1_000_000 && year >= window.from && year <= window.until
}

/** The yearly copies the requesting client can be given (the CN client: only the ones in its update). */
/** How the requesting client's copies' dates read: global's are Japan time, the CN client's UTC. */
const copyDateParser = () => inCnRequest() ? parseUtcText : parseMasterDate

function copiesForClient(): FreePullCopy[] {
    if (!inCnRequest()) return copies
    // cnCopies holds the shared campaigns' copies too, on CN's dates
    return cnCopies.filter(copy => cnUpdateHasCopy(copy.id))
}

export function freePullCopyEntriesSync(saved: { gacha_id: number, campaign_id: number, count: number }[], serverMs = getServerDate().getTime()) {
    const cn = inCnRequest()
    const copy = activeFreePullCopy(copiesForClient(), serverMs, copyDateParser())
    if (copy === null) return []
    const have = new Set(saved.filter(e => e.campaign_id === copy.id).map(e => e.gacha_id))
    // only banners the client's own tables have (CN has most of global's plus its own)
    const cnBanners = cn ? cnTableIds("gacha") : null
    const hasBanner = (id: string, gacha: unknown) => cn ? cnBanners === null || cnBanners.has(Number(id)) : !(gacha as { cn?: boolean }).cn
    return Object.entries(gachas)
        .filter(([id, gacha]) => isFreePullBanner(gacha) && hasBanner(id, gacha) && !have.has(Number(id)))
        .map(([id]) => ({ gacha_id: Number(id), campaign_id: copy.id, count: 1 }))
}

/**
 * The yearly copies' free pulls come back once a real day (reset 05:00 UTC, like the daily missions).
 * Call at /load before the player data is read. The game's own campaigns are not changed.
 */
export function refreshFreePullCopiesSync(playerId: number, realMs = Date.now()): void {
    const db = getDatabase(Database.WDFP_DATA)
    const today = dayNumber(realMs)
    db.transaction(() => {
        const row = db.prepare(`SELECT last_day FROM players_free_pull_reset WHERE player_id = ?`).get(playerId) as { last_day: number } | undefined
        if (row !== undefined && row.last_day >= today) return
        db.prepare(`UPDATE players_gacha_campaigns SET count = 1 WHERE player_id = ? AND campaign_id >= 100000 AND count < 1`).run(playerId)
        db.prepare(`INSERT INTO players_free_pull_reset (player_id, last_day) VALUES (?, ?)
            ON CONFLICT (player_id) DO UPDATE SET last_day = excluded.last_day`).run(playerId, today)
    })()
}

const iso = (ms: number) => new Date(ms).toISOString()
const imageUrl = (id: string | null | undefined) => id ? `/api/server/event-image/${id}.png` : null

export interface RunOverview {
    key: string,
    name: string,
    description: string,
    original: { start: string, end: string },
    cn: { start: string, end: string } | null, // its own dates in CN's data (when the CN game runs it)
    yearly: boolean,
    skippedYears: number[], // years with no copy (one of the game's runs of this kind is on then)
    next: { start: string, end: string } | null,
    active: boolean // on now (its original run, or a copy when it repeats)
}

export interface CampaignOverview {
    serverDate: string,
    loginBonuses: {
        id: string, name: string, app: "both" | "cn", image: string | null, days: number,
        original: { start: string, end: string },
        cn: { start: string, end: string } | null,
        yearly: boolean,
        open: boolean,
        next: { start: string, end: string } | null // the run on now or coming next (when yearly)
    }[],
    freePulls: {
        id: number, name: string, app: "both" | "cn", gameName: string, kind: number,
        original: { start: string, end: string },
        cn: { start: string, end: string } | null,
        yearly: boolean,
        skippedYears: number[], // years with no copy (a game campaign runs then)
        next: { start: string, end: string } | null,
        active: boolean
    }[],
    rewardRuns: RunOverview[],
    staminaRuns: RunOverview[],
    bannerCount: number,
    problems: string[],
    mod: ReturnType<typeof getScheduleModStatus>
}

/** Everything the dashboard's Campaigns tab shows. */
export function getCampaignOverview(): CampaignOverview {
    const now = getServerDate().getTime()
    const cnDates = cnEventWindows() ?? {}
    const cnOf = (key: string) => cnDates[key] ?? null
    // the CN-dated rows (withCnDates, the CN game's own campaigns) are UTC text
    const utcIso = (text: string) => { const ms = parseUtcText(text); return ms === null ? text : iso(ms) }
    const masterIso = (text: string) => {
        const ms = Date.parse(text.replace(" ", "T") + "+09:00") // global's data: Japan time
        return isNaN(ms) ? text : iso(ms)
    }
    const loginBonuses: CampaignOverview["loginBonuses"] = Object.entries(SEASONAL_LOGIN_BONUSES).flatMap(([id, name]) => {
        const info = seasonal.loginBonuses[id]
        if (info === undefined) return []
        const yearly = schedule.yearlyLoginBonuses.includes(id)
        const cn = cnOf(`login:${id}`)
        // the CN game runs it on CN's dates (applyCnSeasonalLoginDates): its runs and "on now" follow those
        const run = !yearly ? null : cn ? currentOrNextRun(formatMasterDate(Date.parse(cn.start)), formatMasterDate(Date.parse(cn.end)), now) : currentOrNextRun(info.start, info.end, now)
        const group = cnLoginGroup(id) ?? groups[id]
        return [{
            id, name, app: "both", image: imageUrl(info.image), days: info.days,
            original: { start: masterIso(info.start), end: masterIso(info.end) },
            cn,
            yearly,
            open: group !== undefined && isLoginBonusGroupOpen(group, now),
            next: run === null ? null : { start: iso(run.start), end: iso(run.end) }
        }]
    })
    // the CN game's own seasonal login bonuses (CN client only)
    for (const [id, name] of Object.entries(CN_SEASONAL_LOGIN_BONUSES)) {
        const info = cnCampaigns.loginInfo[id], group = cnOnlyLoginGroups()[id]
        if (info === undefined || group === undefined || info.start === null || info.end === null) continue
        const yearly = schedule.yearlyLoginBonuses.includes(id)
        const run = yearly ? currentOrNextRun(formatMasterDate(parseUtcText(info.start)!), formatMasterDate(parseUtcText(info.end)!), now) : null
        loginBonuses.push({
            id, name, app: "cn", image: imageUrl(info.image), days: info.days,
            original: { start: utcIso(info.start), end: utcIso(info.end) },
            cn: cnOf(`login:${id}`),
            yearly,
            open: isLoginBonusGroupOpen(group, now),
            next: run === null ? null : { start: iso(run.start), end: iso(run.end) }
        })
    }
    const active = activeFreePullCopy(copies, now)
    const cnActive = activeFreePullCopy(cnCopies, now, parseUtcText)
    // the CN game's free pulls, shared ones included, are on CN's dates: their repeats and "on now" follow those
    const cnPulls = cnAllFreePulls()
    // a chosen one's copies after overlaps (a year another chosen, longer campaign keeps is skipped)
    const keptPulls = chosenPullCopies(true)
    const freePulls = [
        ...Object.entries(SEASONAL_FREE_PULLS).map(([id, name]) => [id, name, "both"] as const),
        ...Object.entries(CN_SEASONAL_FREE_PULLS).map(([id, name]) => [id, name, "cn"] as const),
    ].flatMap(([idText, name, app]) => {
        const id = Number(idText)
        const original = (app === "cn" ? cnCampaigns.freePulls : seasonal.freePulls).find(c => c.id === id) as FreePullCampaign | undefined
        const campaign = cnPulls.find(c => c.id === id)
        if (original === undefined || campaign === undefined) return []
        const yearly = schedule.yearlyFreePulls.includes(id)
        const own = (yearly ? keptPulls.get(id) : undefined) ?? freePullCopies(campaign, cnPulls)
        const years = new Set(own.map(c => c.year))
        const firstYear = Number(campaign.start.slice(0, 4))
        const skippedYears: number[] = []
        for (let year = firstYear + 1; year <= firstYear + 6; year++) if (!years.has(year)) skippedYears.push(year)
        const next = own.find(c => Date.parse(c.end.replace(" ", "T") + "Z") >= now)
        return [{
            id, name, app, gameName: campaign.name, kind: campaign.kind,
            original: app === "cn" ? { start: utcIso(original.start), end: utcIso(original.end) } : { start: masterIso(original.start), end: masterIso(original.end) },
            cn: cnOf(`freePull:${id}`),
            yearly, skippedYears,
            next: next === undefined ? null : { start: utcIso(next.start), end: utcIso(next.end) },
            active: (active !== null && active.originalId === id) || (cnActive !== null && cnActive.originalId === id)
        }]
    })
    const runOverview = (kind: "reward" | "stamina"): RunOverview[] => {
        const table = tables[kind]
        const cnT = cnTable(kind)
        const keptRuns = chosenRunCopies(kind, true)
        const chosen = kind === "reward" ? schedule.yearlyRewardRuns : schedule.yearlyStaminaRuns
        return table.runs.map(run => {
            const yearly = chosen.includes(run.key)
            // the CN game runs it on its CN dates: its repeats and "on now" follow those
            const cnRun = cnRunOf(cnT.runs, run)
            const own = (yearly ? keptRuns.get(run.key) : undefined) ?? runCopies(cnRun, cnT.runs)
            const years = new Set(own.map(c => c.year))
            const firstYear = Number(cnRun.start.slice(0, 4))
            const skippedYears: number[] = []
            for (let year = firstYear + 1; year <= firstYear + 6; year++) if (!years.has(year)) skippedYears.push(year)
            const next = own.find(c => Date.parse(c.end.replace(" ", "T") + "Z") >= now)
            const rows = table.rows.filter(row => run.ids.includes(row.id))
            return {
                key: run.key, name: runName(kind, run), description: describeRun(kind, rows),
                original: { start: masterIso(run.start), end: masterIso(run.end) },
                cn: run.ids.map(i => cnOf(`${kind}:${i}`)).find(w => w !== null) ?? null,
                yearly, skippedYears,
                next: next === undefined ? null : { start: utcIso(next.start), end: utcIso(next.end) },
                active: utcOn(cnRun, now) || (yearly && own.some(c => utcOn(c, now)))
            }
        })
    }
    return {
        serverDate: iso(now), loginBonuses, freePulls,
        rewardRuns: runOverview("reward"), staminaRuns: runOverview("stamina"),
        bannerCount: Object.values(gachas).filter(isFreePullBanner).length,
        problems: lastProblems, mod: getScheduleModStatus()
    }
}

/**
 * Saves which seasonal campaigns repeat every year, then updates the server's data and the game's mod.
 *
 * @returns null when saved, or why it wasn't.
 */
export async function setCampaignSchedule(raw: unknown): Promise<string | null> {
    const { schedule: next, problems } = parseCampaignSchedule(raw, knownRuns)
    if (problems.length > 0) return problems[0]
    // picks whose copies would run at the same time are fine: the longer one keeps those years (keepLongerOnOverlap)
    schedule = next
    lastProblems = []
    mkdirSync(path.dirname(SCHEDULE_FILE), { recursive: true })
    writeFileSync(SCHEDULE_FILE, JSON.stringify(schedule, null, 1))
    refreshCopies()
    applyEventScheduleToServerData()
    await rebuildMod()
    return null
}
