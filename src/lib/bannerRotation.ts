// Banner rotation: steps the server's date through the game's own banner schedule, so the
// summon screen shows a different set of banners as time goes by.
//
// How it works: the game decides which banners to show from the server's date, so moving the date
// moves the banners. Each "step" is the moment a banner starts in assets/gacha.json, in
// chronological order. The server stays on one step for a number of real hours, then moves on to
// the next one, and wraps back to the first step after the last one.
//
// Settings (in the .env file):
//   BANNER_ROTATION="true"             Turns the rotation on. Anything else leaves the clock alone.
//   BANNER_ROTATION_HOURS="24"         Real hours to stay on each step (default 24).
//   BANNER_ROTATION_START="2021-09-08" Optional. The first date to rotate from. It's only used the
//                                      first time, before a saved position exists.
//   SERVER_TIME_TICKS="true"           Optional (see src/lib/serverClock.ts). The date counts up
//                                      from each step's start like a real clock, instead of staying
//                                      fixed for the whole step.
//
// The position is saved to .database/banner_rotation.json, so it survives restarts. It keeps
// counting while the server is off, like a real banner schedule would.
//
// The dashboard has a panel to watch and control the rotation. Setting the time by hand pauses the
// rotation until it's resumed there (or at /api/server/rotation/resume).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import gachas from "../../assets/gacha.json";
import { getServerDate, isServerTimePinned, resumeServerTimeSource, setServerTimeSource } from "../utils";
import { parseClockConfig } from "./serverClock";

export interface RotationBanner {
    type: number, // 0 = unit banner, 1 = weapon banner
    startDate: string,
    endDate: string
}

export type RotationBanners = { [id: string]: RotationBanner }

export interface RotationConfig {
    enabled: boolean,
    stepHours: number,
    startFrom: Date | null,
    warnings: string[]
}

export interface LiveBanner {
    id: number,
    type: number,
    startDate: string,
    endDate: string
}

export interface BannerRotationStatus {
    enabled: true,
    step: number, // 1-based
    totalSteps: number,
    stepHours: number,
    ticking: boolean, // the date counts up during a step
    serverDate: string,
    nextChangeAt: string, // when the rotation moves on (real time)
    liveBanners: LiveBanner[]
}

export interface BannerRotation {
    getDate: () => Date,
    skip: (delta: number) => void,
    goTo: (time: number) => void,
    status: (date?: Date) => BannerRotationStatus // pass a date to describe that date instead of the rotation's own
}

export interface BannerRotationOptions {
    banners: RotationBanners,
    stepHours: number,
    startFrom?: Date | null,
    stateFile?: string | null, // where to save the position; null to not save
    ticking?: boolean, // the date counts up from the step's start in real time (default false)
    now?: () => number // the real time in ms; only changed by tests
}

const HOUR_MS = 60 * 60 * 1000

// The server date sits one hour after a banner's start moment, so that banner is live.
const STEP_OFFSET_MS = HOUR_MS

const parseBannerDate = (value: string): number => Date.parse(value.replace(" ", "T") + "Z")

/**
 * Reads the rotation settings from environment variables.
 */
export function parseRotationConfig(env: { [key: string]: string | undefined }): RotationConfig {
    const warnings: string[] = []
    const enabled = ["1", "true", "on", "yes"].includes((env.BANNER_ROTATION ?? "").trim().toLowerCase())

    let stepHours = 24
    const rawHours = env.BANNER_ROTATION_HOURS
    if (rawHours !== undefined && rawHours.trim() !== "") {
        const parsed = Number(rawHours)
        if (Number.isFinite(parsed) && parsed > 0) {
            stepHours = parsed
        } else {
            warnings.push(`BANNER_ROTATION_HOURS must be a number above 0 (got "${rawHours}"). Using 24.`)
        }
    }

    let startFrom: Date | null = null
    const rawStart = env.BANNER_ROTATION_START?.trim()
    if (rawStart !== undefined && rawStart !== "") {
        const parsed = new Date(`${rawStart}T00:00:00.000Z`)
        if (/^\d{4}-\d{2}-\d{2}$/.test(rawStart) && !isNaN(parsed.getTime()) && parsed.toISOString().startsWith(rawStart)) {
            startFrom = parsed
        } else {
            warnings.push(`BANNER_ROTATION_START must be a real date like 2021-09-08 (got "${rawStart}"). Starting from the first banner.`)
        }
    }

    return { enabled, stepHours, startFrom, warnings }
}

/**
 * Builds the list of steps: the start moments of the banners (as ms timestamps), oldest first.
 * By default it begins at the first unit banner, which skips the weapon banner that has been
 * "open" since 2018.
 */
export function buildRotationSteps(banners: RotationBanners, startFrom: Date | null): number[] {
    const entries = Object.values(banners)
        .map(banner => ({ type: banner.type, start: parseBannerDate(banner.startDate) }))
        .filter(entry => !isNaN(entry.start))
    if (entries.length === 0) return []

    let from: number
    if (startFrom !== null) {
        from = startFrom.getTime()
    } else {
        const unitStarts = entries.filter(entry => entry.type === 0).map(entry => entry.start)
        from = Math.min(...(unitStarts.length > 0 ? unitStarts : entries.map(entry => entry.start)))
    }

    return Array.from(new Set(entries.map(entry => entry.start).filter(start => start >= from)))
        .sort((a, b) => a - b)
}

interface SavedPosition {
    stepIndex: number,
    stepStartedAt: number // real time in ms
}

/**
 * Creates a rotation. Nothing is wired into the server clock here; see initBannerRotation.
 */
export function createBannerRotation(options: BannerRotationOptions): BannerRotation {
    const now = options.now ?? Date.now
    const stepMs = options.stepHours * HOUR_MS
    const stateFile = options.stateFile ?? null
    const steps = buildRotationSteps(options.banners, options.startFrom ?? null)
    if (steps.length === 0) throw new Error("No banners were found to rotate through.")

    const wrap = (index: number) => ((index % steps.length) + steps.length) % steps.length

    function loadPosition(): SavedPosition | null {
        if (stateFile === null || !existsSync(stateFile)) return null
        try {
            const raw = JSON.parse(readFileSync(stateFile, "utf-8"))
            if (Number.isInteger(raw.stepIndex) && Number.isFinite(raw.stepStartedAt)) {
                return { stepIndex: raw.stepIndex, stepStartedAt: raw.stepStartedAt }
            }
        } catch (error) {
            console.error(`Could not read the saved banner rotation position: ${(error as Error).message}`)
        }
        return null
    }

    function savePosition() {
        if (stateFile === null) return
        try {
            mkdirSync(path.dirname(stateFile), { recursive: true })
            writeFileSync(stateFile, JSON.stringify(position))
        } catch (error) {
            console.error(`Could not save the banner rotation position: ${(error as Error).message}`)
        }
    }

    const saved = loadPosition()
    let position: SavedPosition = saved ?? { stepIndex: 0, stepStartedAt: now() }
    position.stepIndex = wrap(position.stepIndex) // the banner data may have changed since it was saved
    if (saved === null) savePosition()

    // Moves the position forward by however many steps have passed in real time.
    function advance() {
        const elapsed = now() - position.stepStartedAt
        if (elapsed < 0) {
            // the computer's clock was moved backwards; start this step over
            position = { stepIndex: position.stepIndex, stepStartedAt: now() }
            savePosition()
        } else if (elapsed >= stepMs) {
            const stepsPassed = Math.floor(elapsed / stepMs)
            position = {
                stepIndex: wrap(position.stepIndex + stepsPassed),
                stepStartedAt: position.stepStartedAt + stepsPassed * stepMs
            }
            savePosition()
        }
    }

    const ticking = options.ticking === true
    const getDate = () => {
        advance()
        // ticking: real time spent on this step is added on (it never reaches the next step's
        // length, since advance() has just moved on if it had)
        const elapsed = ticking ? Math.max(0, now() - position.stepStartedAt) : 0
        return new Date(steps[position.stepIndex] + STEP_OFFSET_MS + elapsed)
    }

    return {
        getDate,
        skip: (delta: number) => {
            position = { stepIndex: wrap(position.stepIndex + delta), stepStartedAt: now() }
            savePosition()
        },
        goTo: (time: number) => {
            // the latest step that started at or before the time (the first step if it's earlier than all of them)
            let stepIndex = 0
            for (let i = 0; i < steps.length && steps[i] <= time; i++) stepIndex = i
            position = { stepIndex, stepStartedAt: now() }
            savePosition()
        },
        status: (describeDate?: Date) => {
            const rotationDate = getDate() // also moves the position forward if a step has passed
            const date = describeDate ?? rotationDate
            const time = date.getTime()
            const liveBanners: LiveBanner[] = Object.entries(options.banners)
                .filter(([_, banner]) => parseBannerDate(banner.startDate) <= time && time <= parseBannerDate(banner.endDate))
                .map(([id, banner]) => ({ id: Number(id), type: banner.type, startDate: banner.startDate, endDate: banner.endDate }))
                .sort((a, b) => a.id - b.id)
            return {
                enabled: true,
                step: position.stepIndex + 1,
                totalSteps: steps.length,
                stepHours: options.stepHours,
                ticking,
                serverDate: date.toISOString(),
                nextChangeAt: new Date(position.stepStartedAt + stepMs).toISOString(),
                liveBanners
            }
        }
    }
}

// ---- wiring into the server ----

let active: BannerRotation | null = null

/**
 * Turns the rotation on if the settings ask for it. Call this once when the server starts.
 *
 * @returns Whether the rotation is running.
 */
export function initBannerRotation(env: { [key: string]: string | undefined } = process.env): boolean {
    const config = parseRotationConfig(env)
    for (const warning of config.warnings) console.warn(warning)
    if (!config.enabled) return false

    try {
        active = createBannerRotation({
            banners: gachas as unknown as RotationBanners,
            stepHours: config.stepHours,
            startFrom: config.startFrom,
            stateFile: path.join(process.cwd(), ".database", "banner_rotation.json"),
            ticking: parseClockConfig(env).ticking
        })
    } catch (error) {
        console.error(`Banner rotation could not start: ${(error as Error).message}`)
        return false
    }

    const rotation = active
    setServerTimeSource(() => rotation.getDate())

    const status = rotation.status()
    console.log(`Banner rotation is on: step ${status.step} of ${status.totalSteps}, ${config.stepHours} hour(s) per step, server date ${status.serverDate}`)
    return true
}

/**
 * The rotation's status, or null if it isn't turned on. `paused` is true while a date that was
 * set by hand is overriding it, and then `serverDate` and `liveBanners` describe that date.
 */
export function getBannerRotationStatus(): (BannerRotationStatus & { paused: boolean }) | null {
    if (active === null) return null
    const paused = isServerTimePinned()
    // while paused, the server date is the one that was set by hand, so describe that date
    return { ...active.status(paused ? getServerDate() : undefined), paused }
}

/**
 * Moves the rotation forward or backward by some steps, restarts the timer for that step, and
 * resumes the rotation if it was paused.
 *
 * @returns The new status, or null if the rotation isn't turned on.
 */
export function skipBannerRotation(delta: number): (BannerRotationStatus & { paused: boolean }) | null {
    if (active === null) return null
    active.skip(delta)
    resumeServerTimeSource()
    return getBannerRotationStatus()
}

/**
 * Moves the rotation to the banner that started at or before a date (or the first one if the date
 * is earlier than all of them), restarts the timer for that step, and resumes the rotation if it
 * was paused.
 *
 * @returns The new status, or null if the rotation isn't turned on.
 */
export function goToBannerRotation(date: Date): (BannerRotationStatus & { paused: boolean }) | null {
    if (active === null) return null
    active.goTo(date.getTime())
    resumeServerTimeSource()
    return getBannerRotationStatus()
}

/**
 * Resumes the rotation after a date was set by hand.
 *
 * @returns The new status, or null if the rotation isn't turned on.
 */
export function resumeBannerRotation(): (BannerRotationStatus & { paused: boolean }) | null {
    if (active === null) return null
    resumeServerTimeSource()
    return getBannerRotationStatus()
}
