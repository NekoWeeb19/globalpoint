// Using and selling items (item/use_item, item/sell), from the global client's own item table
// (assets/item_rules.json, built by scripts/gen_items.cjs). No database here: src/routes/api/item.ts
// reads and saves.
//
// The global client sends item/use_item as { items: [{ id, number }] } and item/sell as
// { item_id, sell_number }, and handles these result codes itself: 2057 (an item used outside its
// period), 2102 (stamina already at the maximum) and 2054 (an item sold outside its period).
// Only stamina items (effect kind 2) can be used on global; the Chinese fork's choice packs
// (kind 22) and percent stamina items (kind 3) aren't in the global table.

export interface ItemRule {
    name: string
    effectKind: number | null
    category: number | null
    /** Mana for one. */
    salePrice: number
    sellable: boolean
    /** Master table dates (UTC). */
    start: string
    end: string | null
    /** Stamina recovered by one (stamina items only). */
    stamina?: number
}

export interface ItemRules {
    items: Record<string, ItemRule>
}

export const ITEM_EFFECT_KINDS = Object.freeze({ STAMINA: 2 })
/** Ability souls: the game always leaves 3 of each when selling. */
export const ABILITY_SOUL_CATEGORY = 5
export const ABILITY_SOUL_KEEP = 3
/** Stamina can't go above this with items (the Chinese fork's max_stamina_overflow). */
export const MAX_STAMINA_OVERFLOW = 999
/** The highest number the client can hold (an AS3 int). */
export const CLIENT_INT_MAX = 2_147_483_647

export const ITEM_RESULT_CODES = Object.freeze({
    USE_OUT_OF_PERIOD: 2057,
    STAMINA_ALREADY_MAX: 2102,
    SELL_OUT_OF_PERIOD: 2054,
})

/** A refusal: a result code the client shows its own message for, or a bad request. */
export type ItemRefusal = { ok: false, resultCode?: number, message: string }

const parseDate = (value: string | null): number | null => {
    if (value === null) return null
    const ms = Date.parse(value.replace(" ", "T") + "Z")
    return isNaN(ms) ? null : ms
}

/** Whether an item can be used or sold at a server time (start and end included). */
export function isItemInPeriod(rule: ItemRule, serverMs: number): boolean {
    const start = parseDate(rule.start)
    const end = parseDate(rule.end)
    return start !== null && serverMs >= start && (end === null || serverMs <= end)
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0

/** item/use_item's items list, merged per item id; null if anything in it is malformed. */
export function parseUseItems(items: unknown): { id: number, count: number }[] | null {
    if (!Array.isArray(items) || items.length === 0) return null
    const counts = new Map<number, number>()
    for (const entry of items) {
        if (entry === null || typeof entry !== "object") return null
        const { id, number } = entry as { id?: unknown, number?: unknown }
        if (!isCount(id) || !isCount(number)) return null
        const total = (counts.get(id) ?? 0) + number
        if (!Number.isSafeInteger(total)) return null
        counts.set(id, total)
    }
    return [...counts].map(([id, count]) => ({ id, count }))
}

export interface UsePlan {
    ok: true
    /** What to take away, per item id. */
    spend: { id: number, count: number }[]
    staminaAfter: number
}

/**
 * Plans using stamina items. `owned` is how many the player has of each item. Stamina goes up by
 * what the items recover, up to MAX_STAMINA_OVERFLOW.
 */
export function planItemUse(
    rules: ItemRules,
    requests: { id: number, count: number }[],
    owned: (id: number) => number,
    stamina: number,
    serverMs: number
): UsePlan | ItemRefusal {
    let recovery = 0
    for (const request of requests) {
        const rule = rules.items[String(request.id)]
        if (rule === undefined) return { ok: false, message: `Unknown item ${request.id}.` }
        if (rule.effectKind !== ITEM_EFFECT_KINDS.STAMINA || rule.stamina === undefined) return { ok: false, message: `Item ${request.id} can't be used.` }
        if (!isItemInPeriod(rule, serverMs)) return { ok: false, resultCode: ITEM_RESULT_CODES.USE_OUT_OF_PERIOD, message: `Item ${request.id} is out of its period.` }
        if (owned(request.id) < request.count) return { ok: false, message: `Not enough of item ${request.id}.` }
        recovery += rule.stamina * request.count
        if (!Number.isSafeInteger(recovery)) return { ok: false, message: "Too much stamina." }
    }
    if (stamina >= MAX_STAMINA_OVERFLOW) return { ok: false, resultCode: ITEM_RESULT_CODES.STAMINA_ALREADY_MAX, message: "Stamina is already at the maximum." }
    return { ok: true, spend: requests, staminaAfter: Math.min(stamina + recovery, MAX_STAMINA_OVERFLOW) }
}

export interface SalePlan {
    ok: true
    countAfter: number
    mana: number
}

/** Plans selling `count` of an item the player has `owned` of, for mana. */
export function planItemSale(
    rules: ItemRules,
    itemId: unknown,
    count: unknown,
    owned: number,
    freeMana: number,
    serverMs: number
): SalePlan | ItemRefusal {
    if (!isCount(itemId) || !isCount(count)) return { ok: false, message: "Invalid request body." }
    const rule = rules.items[String(itemId)]
    if (rule === undefined) return { ok: false, message: `Unknown item ${itemId}.` }
    if (!rule.sellable) return { ok: false, message: `Item ${itemId} can't be sold.` }
    if (!isItemInPeriod(rule, serverMs)) return { ok: false, resultCode: ITEM_RESULT_CODES.SELL_OUT_OF_PERIOD, message: `Item ${itemId} is out of its period.` }
    if (owned < count) return { ok: false, message: `Not enough of item ${itemId}.` }
    if (rule.category === ABILITY_SOUL_CATEGORY && owned - count < ABILITY_SOUL_KEEP) return { ok: false, message: `${ABILITY_SOUL_KEEP} ability souls must stay.` }
    const mana = rule.salePrice * count
    if (!Number.isSafeInteger(mana) || freeMana + mana > CLIENT_INT_MAX) return { ok: false, message: "Too much mana." }
    return { ok: true, countAfter: owned - count, mana }
}
