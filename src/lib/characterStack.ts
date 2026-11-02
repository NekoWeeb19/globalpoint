// Spare copies of a unit ("stack"): converting them to EXP, and uncapping with them, one unit or all at
// once. The select-all rules follow the Chinese StarPoint fork (src/lib/character-growth/commands/
// bulk-stack-to-exp.ts and bulk-over-limit.ts).

/** EXP each converted copy gives, by rarity (this server's /expod/stack_to_exp values). */
export const STACK_CONVERT_EXP: Readonly<Record<number, number>> = Object.freeze({ 1: 500, 2: 500, 3: 500, 4: 2000, 5: 10000 })
/** Items (STACK_CONVERT_ITEM_ID) each converted copy gives, by rarity. */
export const STACK_CONVERT_ITEMS: Readonly<Record<number, number>> = Object.freeze({ 1: 2, 2: 2, 3: 2, 4: 10, 5: 30 })
export const STACK_CONVERT_ITEM_ID = 990008

export interface StackedCharacter {
    characterId: number
    rarity: number
    stack: number
    overLimitStep: number
    /** Locked by the player. */
    protection: boolean
}

export interface StackConversion {
    characterId: number
    count: number
    exp: number
    items: number
}

/** What converting `count` copies of a unit gives, or null for an unknown rarity. */
export function stackConversion(characterId: number, rarity: number, count: number): StackConversion | null {
    const exp = STACK_CONVERT_EXP[rarity], items = STACK_CONVERT_ITEMS[rarity]
    if (exp === undefined || items === undefined) return null
    return { characterId, count, exp: exp * count, items: items * count }
}

/**
 * Select all → convert to EXP: every spare copy of every unit that is already fully uncapped (copies
 * can't uncap it further) and isn't locked.
 */
export function selectBulkConversions(characters: readonly StackedCharacter[], maxOverLimits: Readonly<Record<number, number>>): StackConversion[] {
    const out: StackConversion[] = []
    for (const c of characters) {
        const max = maxOverLimits[c.rarity]
        if (max === undefined || c.protection || c.stack <= 0 || c.overLimitStep < max) continue
        const conversion = stackConversion(c.characterId, c.rarity, c.stack)
        if (conversion !== null) out.push(conversion)
    }
    return out
}

export interface StackOverLimit {
    characterId: number
    overLimitStep: number
    stack: number
}

/** Select all → uncap: every unit with spare copies is uncapped with them, up to its maximum. */
export function selectBulkOverLimits(characters: readonly StackedCharacter[], maxOverLimits: Readonly<Record<number, number>>): StackOverLimit[] {
    const out: StackOverLimit[] = []
    for (const c of characters) {
        const max = maxOverLimits[c.rarity]
        if (max === undefined || c.stack <= 0 || c.overLimitStep >= max) continue
        const count = Math.min(c.stack, max - c.overLimitStep)
        out.push({ characterId: c.characterId, overLimitStep: c.overLimitStep + count, stack: c.stack - count })
    }
    return out
}
