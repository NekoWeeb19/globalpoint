// The quest drop amount set on the dashboard's first tab (.database/drop_settings.json): every score
// drop (items, element materials, mana, EXP) and every event drop is multiplied by it. 1 = the base
// game's amounts. Reward campaigns and boosts multiply on top. (StarPoint used to give score drops 10x.)

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs"
import path from "path"

const FILE = path.join(process.cwd(), ".database", "drop_settings.json")
export const DROP_MULTIPLIER_MIN = 1
export const DROP_MULTIPLIER_MAX = 100

let cache: { mtimeMs: number, multiplier: number } | null = null

/** The quest drop multiplier (1 when it was never set). */
export function getDropMultiplier(): number {
    try {
        if (!existsSync(FILE)) return 1
        const mtimeMs = statSync(FILE).mtimeMs
        if (cache === null || cache.mtimeMs !== mtimeMs) {
            const value = Number(JSON.parse(readFileSync(FILE, "utf8")).multiplier)
            cache = { mtimeMs, multiplier: isValidDropMultiplier(value) ? value : 1 }
        }
        return cache.multiplier
    } catch {
        return 1
    }
}

export const isValidDropMultiplier = (value: number) =>
    Number.isFinite(value) && value >= DROP_MULTIPLIER_MIN && value <= DROP_MULTIPLIER_MAX

/** Saves the quest drop multiplier. Throws when it's out of range. */
export function setDropMultiplier(value: number): number {
    if (!isValidDropMultiplier(value)) throw new Error(`The drop amount must be between ${DROP_MULTIPLIER_MIN}x and ${DROP_MULTIPLIER_MAX}x.`)
    const multiplier = Math.round(value * 100) / 100
    mkdirSync(path.dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify({ multiplier }))
    cache = null
    return multiplier
}

/** A base drop count with the dashboard's drop amount applied, rounded down (never below the base). */
export function withDropAmount(count: number): number {
    return Math.max(count, Math.floor(count * getDropMultiplier()))
}
