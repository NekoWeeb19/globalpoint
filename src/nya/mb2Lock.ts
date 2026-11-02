// Mana Board 2 opens per unit from a date (assets/mb2_dates.json: { "<character id>": "YYYY-MM-DD hh:mm:ss" UTC }).
// Before its date on the server clock a unit is shown with one mana board: the server leaves its second
// bond token out of what it sends, and refuses to open board 2. A unit whose board 2 was already opened,
// or whose second token was earned, keeps it (a save never loses progress).
// Proof of concept: only the units listed in the file are locked.

import { existsSync, readFileSync, statSync } from "fs"
import path from "path"
import { getServerDate } from "../utils"

const FILE = path.join(__dirname, "..", "..", "assets", "mb2_dates.json")

let cache: { mtimeMs: number, dates: Map<number, number> } | null = null
function dates(): Map<number, number> {
    try {
        if (!existsSync(FILE)) return new Map()
        const mtimeMs = statSync(FILE).mtimeMs
        if (cache === null || cache.mtimeMs !== mtimeMs) {
            const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, string>
            const map = new Map<number, number>()
            for (const [id, text] of Object.entries(raw)) {
                if (id.startsWith("_")) continue
                const ms = Date.parse(String(text).replace(" ", "T") + "Z")
                if (!isNaN(ms)) map.set(Number(id), ms)
            }
            cache = { mtimeMs, dates: map }
        }
        return cache.dates
    } catch {
        return new Map()
    }
}

/** Whether a unit's Mana Board 2 isn't out yet on the server clock. */
export function mb2Locked(characterId: number, serverMs = getServerDate().getTime()): boolean {
    const opens = dates().get(Number(characterId))
    return opens !== undefined && serverMs < opens
}

/**
 * The bond tokens to show the client for a unit: without board 2's while its MB2 is locked, unless the
 * player already opened board 2 or earned its token.
 */
export function visibleBondTokens<T extends { manaBoardIndex: number, status: number }>(characterId: number, tokens: T[], manaBoardIndex: number): T[] {
    if (!mb2Locked(characterId)) return tokens
    const second = tokens.find(t => t.manaBoardIndex === 2)
    if (second === undefined || manaBoardIndex >= 2 || second.status > 0) return tokens
    return tokens.filter(t => t.manaBoardIndex !== 2)
}
