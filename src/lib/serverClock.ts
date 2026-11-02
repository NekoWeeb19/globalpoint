// Ticking server time: makes the server date move forward like a real clock.
//
// Without it, a date set on the dashboard stays frozen at that exact moment, and the banner
// rotation sits on one fixed date per step. With it, the server date keeps counting from the moment
// it was set: set 2024-06-02 12:00, wait 3 hours, and the server says 2024-06-02 15:00.
//
// Settings (in the .env file):
//   SERVER_TIME_TICKS="true"   Turns ticking on. Anything else keeps the old frozen behaviour.
//
// While ticking is on, the date set by hand is saved to .database/server_time.json, so it keeps
// counting across restarts (including while the server is off), like a real clock would.
//
// Everything in this file is plain logic with no side effects; src/utils.ts does the wiring.

export interface ClockConfig {
    ticking: boolean
}

/**
 * The server date at one real moment. The current server date is worked out from it.
 * serverMs is null when the server uses the real time (after a reset with no rotation).
 */
export interface ClockAnchor {
    serverMs: number | null,
    realMs: number // the real time (Date.now()) when serverMs was set
}

export interface SavedClock extends ClockAnchor {
    pinned: boolean // the date was set by hand, overriding the banner rotation
}

/**
 * Reads the clock settings from environment variables.
 */
export function parseClockConfig(env: { [key: string]: string | undefined }): ClockConfig {
    return { ticking: ["1", "true", "on", "yes"].includes((env.SERVER_TIME_TICKS ?? "").trim().toLowerCase()) }
}

/**
 * The server date (ms) for an anchor at a real moment. If the computer's clock is earlier than the
 * anchor (it was moved backwards), the date stays at the anchor instead of going back in time.
 */
export function tickedTime(serverMs: number, realMs: number, nowMs: number): number {
    return serverMs + Math.max(0, nowMs - realMs)
}

/**
 * Reads a saved clock (the contents of .database/server_time.json).
 *
 * @returns The saved clock, or null if the text isn't a valid one.
 */
export function parseSavedClock(text: string): SavedClock | null {
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        return null
    }
    if (typeof raw !== "object" || raw === null) return null
    const value = raw as { [key: string]: unknown }
    const serverMs = value.serverMs
    const realMs = value.realMs
    if (serverMs !== null && !(typeof serverMs === "number" && Number.isFinite(serverMs))) return null
    if (!(typeof realMs === "number" && Number.isFinite(realMs))) return null
    if (typeof value.pinned !== "boolean") return null
    return { serverMs: serverMs as number | null, realMs, pinned: value.pinned }
}

export function serializeClock(clock: SavedClock): string {
    return JSON.stringify({ serverMs: clock.serverMs, realMs: clock.realMs, pinned: clock.pinned })
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The server time with its date kept and its time of day set to the real one (UTC, whole seconds),
 * so the server's day turns over at the same moment as the real daily reset.
 */
export function withRealTimeOfDay(serverMs: number, realMs: number): number {
    const serverDay = Math.floor(serverMs / DAY_MS) * DAY_MS
    const realTime = Math.floor((realMs - Math.floor(realMs / DAY_MS) * DAY_MS) / 1000) * 1000
    return serverDay + realTime
}
