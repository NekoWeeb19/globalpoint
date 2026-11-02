// Star Crumb and bond token exchanges (exchange/star_crumb, exchange/bond_token,
// exchange/get_bond_token_exchange_list), from assets/exchange.json (scripts/gen_exchanges.cjs).
// No database here: src/routes/api/exchange.ts reads and saves.
//
// Star Crumbs buy a unit, an armament or an item. The rules are the global client's own
// (StarCrumbExchangePossibility): a unit or armament already owned, or an item already at its max
// count, can't be exchanged ("DuplicatesOrAlreadyMax"), and the crumbs must cover the cost. Bond tokens
// buy an armament, up to its stock (BondTokenExchangePossibility: BondTokenShortage / OutOfStock).
// Both are offered only inside their master period (server date, UTC like the other master dates).

export interface StarCrumbExchange {
    kind: "character" | "item" | "equipment"
    targetId: number
    rarity: 4 | 5
    cost: number
    start: string
    end: string | null
    /** Items only. */
    maxCount?: number
}

export interface BondTokenExchange {
    cost: number
    /** How many times it can be exchanged. */
    stock: number
    start: string
    end: string | null
}

export interface ExchangeData {
    starCrumb: Record<string, StarCrumbExchange>
    bondToken: Record<string, BondTokenExchange>
}

export type ExchangeRefusal = { ok: false, message: string }

const parseDate = (value: string | null): number | null => {
    if (value === null) return null
    const ms = Date.parse(value.replace(" ", "T") + "Z")
    return isNaN(ms) ? null : ms
}

/** Whether an exchange is offered at a server time (start and end included). */
export function isOffered(entry: { start: string, end: string | null }, serverMs: number): boolean {
    const start = parseDate(entry.start), end = parseDate(entry.end)
    return start !== null && serverMs >= start && (end === null || serverMs <= end)
}

const isId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0

export interface StarCrumbOwnership {
    hasCharacter(id: number): boolean
    hasEquipment(id: number): boolean
    itemCount(id: number): number
}

/** Plans a Star Crumb exchange: what is given and the crumbs left. */
export function planStarCrumbExchange(
    data: ExchangeData,
    exchangeId: unknown,
    starCrumb: number,
    owned: StarCrumbOwnership,
    serverMs: number
): { ok: true, exchange: StarCrumbExchange, starCrumbAfter: number } | ExchangeRefusal {
    if (!isId(exchangeId)) return { ok: false, message: "Invalid request body." }
    const exchange = data.starCrumb[String(exchangeId)]
    if (exchange === undefined) return { ok: false, message: `Exchange ${exchangeId} doesn't exist.` }
    if (!isOffered(exchange, serverMs)) return { ok: false, message: `Exchange ${exchangeId} isn't offered now.` }
    if (exchange.kind === "character" && owned.hasCharacter(exchange.targetId)) return { ok: false, message: `Unit ${exchange.targetId} is already owned.` }
    if (exchange.kind === "equipment" && owned.hasEquipment(exchange.targetId)) return { ok: false, message: `Armament ${exchange.targetId} is already owned.` }
    if (exchange.kind === "item" && owned.itemCount(exchange.targetId) + 1 > (exchange.maxCount ?? Infinity)) return { ok: false, message: `Item ${exchange.targetId} is at its max count.` }
    if (starCrumb < exchange.cost) return { ok: false, message: "Not enough Star Crumbs." }
    return { ok: true, exchange, starCrumbAfter: starCrumb - exchange.cost }
}

/** Plans a bond token exchange: the tokens left and the new exchange count. */
export function planBondTokenExchange(
    data: ExchangeData,
    equipmentId: unknown,
    bondToken: number,
    exchanged: number,
    serverMs: number
): { ok: true, exchange: BondTokenExchange, bondTokenAfter: number, exchangedAfter: number } | ExchangeRefusal {
    if (!isId(equipmentId)) return { ok: false, message: "Invalid request body." }
    const exchange = data.bondToken[String(equipmentId)]
    if (exchange === undefined) return { ok: false, message: `Bond token exchange ${equipmentId} doesn't exist.` }
    if (!isOffered(exchange, serverMs)) return { ok: false, message: `Bond token exchange ${equipmentId} isn't offered now.` }
    if (exchanged >= exchange.stock) return { ok: false, message: `Bond token exchange ${equipmentId} is out of stock.` }
    if (bondToken < exchange.cost) return { ok: false, message: "Not enough bond tokens." }
    return { ok: true, exchange, bondTokenAfter: bondToken - exchange.cost, exchangedAfter: exchanged + 1 }
}

/** exchange/get_bond_token_exchange_list: every offered armament and how often it was exchanged. */
export function bondTokenExchangeList(data: ExchangeData, exchanged: (equipmentId: number) => number, serverMs: number): { equipment_id: number, exchange_count: number }[] {
    return Object.entries(data.bondToken)
        .filter(([_, exchange]) => isOffered(exchange, serverMs))
        .map(([id]) => ({ equipment_id: Number(id), exchange_count: exchanged(Number(id)) }))
}
