// Summon rates by rarity, set on the dashboard's first tab (.database/gacha_rates.json): the 5★ and 4★ chance of a
// pull for each kind of banner (3★ is the rest). Which unit or armament of that rarity comes out is still the
// banner's own weighting (featured units keep their boost). The 10th pull of a multi-pull is 4★ or better: 5★ at
// the same 5★ rate, otherwise 4★. Special pulls with their own rules (e.g. a once-per-account guaranteed 5★) keep
// them. The game's in-game Rates screen still shows the game's own table.

import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs"
import path from "path"

const FILE = path.join(process.cwd(), ".database", "gacha_rates.json")

/**
 * Banner kinds, as the game's Rates screens split them: normal (every unit banner but these, featured units or not:
 * the game's normal_rarity, 5% / 25%), fes (Star Fest and Meteor Festival, fes_rarity: "★5 ×1.5", 7.5% / 25%),
 * armament portals. (Before 2026-11-05 the kinds were standard 7.5% and featured 5%, sorted by the wrong rule:
 * settings saved then aren't read.)
 */
export const RATE_KINDS = ["normal", "fes", "armament"] as const
export type RateKind = typeof RATE_KINDS[number]
/** Percent chances of a pull's rarity; 3★ is 100 - star5 - star4. */
export interface KindRates { star5: number, star4: number }
export type GachaRates = Record<RateKind, KindRates>

/** The base game's rates, as its Rates screens show them. */
export const DEFAULT_GACHA_RATES: GachaRates = {
    normal: { star5: 5, star4: 25 },
    fes: { star5: 7.5, star4: 25 },
    armament: { star5: 5, star4: 25 },
}

let cache: { mtimeMs: number, rates: GachaRates } | null = null

const copyDefaults = (): GachaRates => JSON.parse(JSON.stringify(DEFAULT_GACHA_RATES))

/** Whether a kind's rates are usable: each 0-100 in steps of 0.1, together at most 100. */
export function isValidKindRates(rates: unknown): rates is KindRates {
    const r = rates as KindRates
    const ok = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 && Math.abs(Math.round(v * 10) - v * 10) < 1e-9
    return !!r && ok(r.star5) && ok(r.star4) && r.star5 + r.star4 <= 100 + 1e-9
}

/** The summon rates in use (the defaults for any kind never set or not usable). */
export function getGachaRates(): GachaRates {
    try {
        if (!existsSync(FILE)) return copyDefaults()
        const mtimeMs = statSync(FILE).mtimeMs
        if (cache === null || cache.mtimeMs !== mtimeMs) {
            const saved = JSON.parse(readFileSync(FILE, "utf8")) as Partial<GachaRates>
            const rates = copyDefaults()
            for (const kind of RATE_KINDS) if (isValidKindRates(saved?.[kind])) rates[kind] = { star5: saved[kind]!.star5, star4: saved[kind]!.star4 }
            cache = { mtimeMs, rates }
        }
        return JSON.parse(JSON.stringify(cache.rates))
    } catch {
        return copyDefaults()
    }
}

/** Saves the summon rates (all three kinds). Throws with a readable message when one isn't usable. */
export function setGachaRates(input: unknown): GachaRates {
    const rates = copyDefaults()
    for (const kind of RATE_KINDS) {
        const r = (input as Partial<Record<RateKind, { star5?: unknown, star4?: unknown }>>)?.[kind]
        const value = { star5: Number(r?.star5), star4: Number(r?.star4) }
        if (!isValidKindRates(value)) throw new Error(`${kind[0].toUpperCase() + kind.slice(1)} rates: 5★ and 4★ must each be 0-100% (steps of 0.1), and together at most 100%.`)
        rates[kind] = value
    }
    mkdirSync(path.dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(rates))
    cache = null
    return getGachaRates()
}

/** Back to the base game's rates. */
export function resetGachaRates(): GachaRates {
    try { if (existsSync(FILE)) unlinkSync(FILE) } catch { }
    cache = null
    return getGachaRates()
}

/**
 * A kind's rates as the draw uses them: chances out of 1000 for [5★, 4★, 3★] on a normal pull, and [5★, 4★] on a
 * multi-pull's guaranteed pull.
 */
export function rankRatesFor(kind: RateKind): { normal: number[], multiGuarantee: number[] } {
    const r = getGachaRates()[kind]
    const star5 = Math.round(r.star5 * 10), star4 = Math.round(r.star4 * 10)
    return { normal: [star5, star4, 1000 - star5 - star4], multiGuarantee: [star5, 1000 - star5] }
}
