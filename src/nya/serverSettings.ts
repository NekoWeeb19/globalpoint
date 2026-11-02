// Settings changed on the dashboard's first tab (.database/server_settings.json):
// - the paid beads given with the everyday login bonus (overrides LOGIN_BONUS_PAID_BEADS in .env)
// - which of the three never-ending mails (Bread, Mana, EXP x1500) are in the mailbox (all on by default)

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs"
import path from "path"
import { loginPaidBeadsSetting } from "../lib/loginBonus"

const FILE = path.join(process.cwd(), ".database", "server_settings.json")
export const PAID_BEADS_MAX = 100000
export type InfiniteMail = "bread" | "mana" | "exp"
export const INFINITE_MAILS: readonly InfiniteMail[] = ["bread", "mana", "exp"]

interface Saved { dailyPaidBeads?: number, infiniteMails?: Partial<Record<InfiniteMail, boolean>> }

let cache: { mtimeMs: number, saved: Saved } | null = null
function read(): Saved {
    try {
        if (!existsSync(FILE)) return {}
        const mtimeMs = statSync(FILE).mtimeMs
        if (cache === null || cache.mtimeMs !== mtimeMs) cache = { mtimeMs, saved: JSON.parse(readFileSync(FILE, "utf8")) ?? {} }
        return cache.saved
    } catch {
        return {}
    }
}
function write(saved: Saved) {
    mkdirSync(path.dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(saved, null, 1))
    cache = null
}

const validBeads = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= PAID_BEADS_MAX

/** Paid beads with the everyday login bonus: the dashboard's value, else LOGIN_BONUS_PAID_BEADS, else 150. */
export function dailyPaidBeads(): number {
    const saved = read().dailyPaidBeads
    return validBeads(saved) ? saved : loginPaidBeadsSetting(process.env.LOGIN_BONUS_PAID_BEADS)
}

/** Whether a never-ending mail is in the mailbox (on unless turned off on the dashboard). */
export function infiniteMailOn(mail: InfiniteMail): boolean {
    return read().infiniteMails?.[mail] !== false
}

export interface ServerSettings { dailyPaidBeads: number, fromEnv: boolean, infiniteMails: Record<InfiniteMail, boolean>, max: number }

export function getServerSettings(): ServerSettings {
    const saved = read()
    return {
        dailyPaidBeads: dailyPaidBeads(),
        fromEnv: !validBeads(saved.dailyPaidBeads),
        infiniteMails: { bread: infiniteMailOn("bread"), mana: infiniteMailOn("mana"), exp: infiniteMailOn("exp") },
        max: PAID_BEADS_MAX,
    }
}

/** Saves the given settings (others unchanged). Throws when a value is out of range. */
export function setServerSettings(change: { dailyPaidBeads?: unknown, infiniteMails?: unknown }): ServerSettings {
    const saved = { ...read() }
    if (change.dailyPaidBeads !== undefined) {
        const n = Number(change.dailyPaidBeads)
        if (!validBeads(n)) throw new Error(`The daily paid beads must be a whole number from 0 to ${PAID_BEADS_MAX}.`)
        saved.dailyPaidBeads = n
    }
    if (change.infiniteMails !== undefined && typeof change.infiniteMails === "object" && change.infiniteMails !== null) {
        const mails = { ...(saved.infiniteMails ?? {}) }
        for (const key of INFINITE_MAILS) {
            const value = (change.infiniteMails as Record<string, unknown>)[key]
            if (typeof value === "boolean") mails[key] = value
        }
        saved.infiniteMails = mails
    }
    write(saved)
    return getServerSettings()
}
