// Enemy strength set on the dashboard's first tab (.database/enemy_settings.json): every enemy's HP and attack
// are multiplied in the CN game update (scripts/enemy_scaling.cjs, applied by scripts/gen_cn_event_schedule.cjs).
// 1 = the base game. Saving rebuilds the update; the game takes it at its next start.

import { mkdirSync, writeFileSync } from "fs"
import path from "path"
import { rebuildCnUpdate } from "./eventSchedule"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ES = require(path.join(__dirname, "..", "..", "scripts", "enemy_scaling.cjs")) as {
    FILE: string, MIN: number, MAX: number
    readEnemyScaling: (dataDir: string) => { hp: number, atk: number }
    valid: (value: unknown) => boolean
}
const DIR = path.join(process.cwd(), ".database")
export const ENEMY_MULTIPLIER_MIN = ES.MIN
export const ENEMY_MULTIPLIER_MAX = ES.MAX

/** The saved multipliers ({ hp, atk }; 1 when never set). */
export function getEnemyScaling(): { hp: number, atk: number } {
    return ES.readEnemyScaling(DIR)
}

/** Saves the multipliers and rebuilds the CN update when they changed. Throws when one is out of range. */
export function setEnemyScaling(hp: number, atk: number): { hp: number, atk: number, rebuilding: boolean } {
    const round = (n: number) => Math.round(n * 100) / 100
    const next = { hp: round(hp), atk: round(atk) }
    for (const [what, v] of [["HP", next.hp], ["Attack", next.atk]] as const)
        if (!ES.valid(v)) throw new Error(`${what} must be between ${ES.MIN}x and ${ES.MAX}x.`)
    const before = getEnemyScaling()
    mkdirSync(DIR, { recursive: true })
    writeFileSync(path.join(DIR, ES.FILE), JSON.stringify(next))
    const rebuilding = before.hp !== next.hp || before.atk !== next.atk
    if (rebuilding) rebuildCnUpdate()
    return { ...next, rebuilding }
}
