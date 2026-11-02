import { randomInt } from "crypto"
import { FastifyRequest } from "fastify"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { parseClockConfig, parseSavedClock, serializeClock, tickedTime } from "./lib/serverClock"

// The server's current date.
let serverTime: Date | null = new Date("2024-06-02T12:00:00.000Z"); // EOS Date
// The real time when serverTime was set. Only used while the clock ticks (see src/lib/serverClock.ts).
let serverTimeSetAt = Date.now()
let serverTimeTicks = false
let serverClockFile: string | null = null

// An optional clock source (used by the banner rotation). While one is set, the server date comes
// from it, unless the date was set by hand (setServerTime), which "pins" it until it's resumed.
let serverTimeSource: (() => Date) | null = null
let serverTimePinned = false

function currentServerTime(): Date | null {
    if (serverTimeSource !== null && !serverTimePinned) return serverTimeSource()
    if (serverTime === null || !serverTimeTicks) return serverTime
    return new Date(tickedTime(serverTime.getTime(), serverTimeSetAt, Date.now()))
}

function saveServerClock() {
    if (serverClockFile === null) return
    try {
        mkdirSync(path.dirname(serverClockFile), { recursive: true })
        writeFileSync(serverClockFile, serializeClock({
            serverMs: serverTime === null ? null : serverTime.getTime(),
            realMs: serverTimeSetAt,
            pinned: serverTimePinned
        }))
    } catch (error) {
        console.error(`Could not save the server time: ${(error as Error).message}`)
    }
}

/**
 * Turns on the ticking clock if the settings ask for it, and restores the date that was saved last
 * time. Call this once when the server starts, after the banner rotation is set up.
 *
 * @returns Whether the clock ticks.
 */
export function initServerClock(env: { [key: string]: string | undefined } = process.env): boolean {
    serverTimeTicks = parseClockConfig(env).ticking
    const clockFile = path.join(process.cwd(), ".database", "server_time.json")
    // a new install (no saved clock yet) starts at SERVER_START_DATE when it's set; players change the
    // date on the dashboard from there
    const startMs = Date.parse(env.SERVER_START_DATE ?? "")
    const firstStart = !existsSync(clockFile)
    if (firstStart && !Number.isNaN(startMs)) {
        serverTime = new Date(startMs)
        serverTimePinned = true
    }
    if (!serverTimeTicks) return false

    serverClockFile = clockFile
    if (!firstStart) {
        const saved = parseSavedClock(readFileSync(serverClockFile, "utf-8"))
        if (saved === null) {
            console.warn("The saved server time could not be read, so it starts over.")
        } else {
            serverTime = saved.serverMs === null ? null : new Date(saved.serverMs)
            serverTimeSetAt = saved.realMs
            serverTimePinned = saved.pinned
        }
    } else {
        // first start with ticking on: the date counts from now, and is saved so a restart keeps it
        serverTimeSetAt = Date.now()
        saveServerClock()
    }
    const source = serverTimeSource !== null && !serverTimePinned ? "the banner rotation" : "the set date"
    console.log(`Server time ticks like a real clock (following ${source}): ${getServerDate().toISOString()}`)
    return true
}

/**
 * Whether the server date moves forward with real time.
 */
export function isServerTimeTicking(): boolean {
    return serverTimeTicks
}

/**
 * Where the server date comes from right now.
 */
export function getServerTimeMode(): "rotation" | "set" | "real" {
    if (serverTimeSource !== null && !serverTimePinned) return "rotation"
    return serverTime === null ? "real" : "set"
}

/**
 * Returns the current server time as a unix epoch.
 * 
 * @param date An optional date; The date to get the time of.
 * @returns The unix epoch.
 */
export function getServerTime(
    date: Date = new Date()
): number {
    return Math.floor((currentServerTime() ?? date).getTime() / 1000) //1710116388//
}

/**
 * A stored date as a unix epoch, as it is (unlike getServerTime(date), which returns the server date
 * whenever one is set). Used for the EXP pool's timestamp, which is kept on the server-date clock.
 */
export function epochOf(date: Date): number {
    return Math.floor(date.getTime() / 1000)
}

/**
 * Gets the current server time as a Date.
 * 
 * @returns The current server time as a date.
 */
export function getServerDate(): Date {
    return currentServerTime() ?? new Date()
}

export function setServerTime(date: Date | null) {
    serverTime = date;
    serverTimeSetAt = Date.now(); // with ticking on, the date counts up from here
    serverTimePinned = true; // a date set by hand overrides the clock source until it's resumed
    saveServerClock()
}

/**
 * Sets (or clears, with null) the function that provides the server date.
 */
export function setServerTimeSource(source: (() => Date) | null) {
    serverTimeSource = source
    serverTimePinned = false
}

/**
 * Hands the server date back to the clock source after it was set by hand.
 */
export function resumeServerTimeSource() {
    serverTimePinned = false
    saveServerClock()
}

/**
 * Whether the server date was set by hand, overriding the clock source.
 */
export function isServerTimePinned(): boolean {
    return serverTimeSource !== null && serverTimePinned
}

/**
 * Converts a server time value (unix epoch in seconds) into a Date.
 * 
 * @param serverTime The unix epoch value.
 * @returns The date.
 */
export function getDateFromServerTime(serverTime: number): Date {
    return new Date(serverTime * 1000)
}

/**
 * Generates an IdpAlias to identify a particular device.
 * 
 * @param appId 
 * @param idpId 
 * @param serialNo 
 * @returns The generated IdpAlias
 */
export function generateIdpAlias(
    appId: string,
    deviceId: string,
    serialNo: string
): string {
    return `${appId}:${deviceId}:${serialNo}`
}

/**
 * Generates a random viewer ID using the crypto library.
 * 
 * @returns A number between 100,000,000 and 999,999,999
 */
export function generateViewerId(): number {
    return randomInt(100000000, 999999999)
}

export interface DataHeaders {
    force_update?: boolean
    asset_update?: boolean
    short_udid?: number
    viewer_id?: number
    servertime?: number
    result_code?: number
    udid?: string
}

/**
 * Generates a default data headers object, which is used in communication with the client.
 * 
 * @param customValues A partial DataHeaders object with custom fields to replace the default ones.
 * @returns A DataHeaders object.
 */
export function generateDataHeaders(
    customValues: Partial<DataHeaders> = {},
    fields: (keyof DataHeaders)[] = ['force_update', 'asset_update', 'short_udid', 'viewer_id', 'servertime', 'result_code'],
): Record<string, any> {
    const defaultHeaders: DataHeaders = {
        force_update: false,
        asset_update: false,
        short_udid: 0,
        viewer_id: 0,
        servertime: getServerTime(), //1651514014,//getServerTime(),
        result_code: 1
    }
    const headers: Record<string, any> = {}

    for (const field of fields) {
        const customValue = customValues[field]
        const defaultValue = defaultHeaders[field]
        headers[field] = customValue === undefined ? defaultValue : customValue
    }

    return headers
}

export enum Platform {
    ANDROID,
    IOS
}

export function getRequestPlatformSync(
    request: FastifyRequest
): Platform {
    // check user agent
    if ((request.headers["user-agent"] || '').includes('iOS;'))
        return Platform.IOS;

    // check requestedby header
    if ((request.headers["requestedby"] || '') === 'ios')
        return Platform.IOS;

    return Platform.ANDROID
}