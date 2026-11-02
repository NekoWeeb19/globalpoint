// Armament augmentation ("Augment Armament", shop type 10): offers that raise an armament's augment
// level in stages (assets/equipment_enhancement_shop.json and _cn.json, from
// scripts/gen_equipment_enhancement.cjs). Rules as in the Chinese fork: each armament's offers form
// stages; only the current stage (the first whose max level is above the armament's level) is offered,
// with as many levels left as that stage allows; buying N adds N levels, needs the armament owned and
// awakened to the stage's level, and spends the stage's cost items N times.

import { readFileSync } from "fs"
import path from "path"
import { getPlayerEquipmentListSync, getPlayerEquipmentSync, getPlayerItemSync, updatePlayerEquipmentSync, updatePlayerItemSync } from "../data/wdfpData"
import { inCnRequest } from "../lib/cnClient"
import { getServerDate } from "../utils"

export const EQUIPMENT_ENHANCEMENT_SHOP_TYPE = 10

export interface EnhancementOffer {
    costs: { id: number, amount: number }[]
    availableFrom: string
    availableUntil: string | null
    category: number
    groupId: number
    stage: number
    equipmentId: number
    maxLevel: number
    requireAwakening: number
}

const cache = new Map<string, Record<string, EnhancementOffer>>()
function offers(): Record<string, EnhancementOffer> {
    const file = inCnRequest() ? "equipment_enhancement_shop_cn.json" : "equipment_enhancement_shop.json"
    let data = cache.get(file)
    if (data === undefined) {
        try { data = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "assets", file), "utf8")) as Record<string, EnhancementOffer> } catch { data = {} }
        cache.set(file, data)
    }
    return data
}

const parse = (date: string) => Date.parse(date.replace(" ", "T") + "Z")
const isOpen = (offer: EnhancementOffer, now: number) =>
    parse(offer.availableFrom) <= now && (offer.availableUntil === null || now < parse(offer.availableUntil))

/** Each armament's stages (open offers), lowest stage first, keyed "category:group:armament". */
function stagesByArmament(now: number): Map<string, [string, EnhancementOffer][]> {
    const groups = new Map<string, [string, EnhancementOffer][]>()
    for (const [id, offer] of Object.entries(offers())) {
        if (!isOpen(offer, now)) continue
        const key = `${offer.category}:${offer.groupId}:${offer.equipmentId}`
        const list = groups.get(key) ?? []
        list.push([id, offer])
        groups.set(key, list)
    }
    for (const list of groups.values()) list.sort((a, b) => a[1].stage - b[1].stage)
    return groups
}

/** The sales list entries for the asked sections (one per armament: its current stage). */
export function enhancementSalesListSync(playerId: number, categories: number[]): Object[] {
    const now = getServerDate().getTime()
    const owned = getPlayerEquipmentListSync(playerId)
    const result: Object[] = []
    for (const stages of stagesByArmament(now).values()) {
        const first = stages[0][1]
        if (categories.length > 0 && !categories.includes(first.category)) continue
        const equipment = owned[String(first.equipmentId)]
        const level = equipment === undefined ? -1 : equipment.enhancementLevel ?? 0
        const maxLevel = stages[stages.length - 1][1].maxLevel
        let target = stages[0]
        let stock = first.maxLevel
        let bought = 0
        if (level >= 0) {
            const next = stages.find(([, offer]) => offer.maxLevel > level)
            target = next ?? stages[stages.length - 1]
            stock = next === undefined ? 0 : next[1].maxLevel - level
            bought = level
        }
        result.push({
            "shop_item_id": Number(target[0]),
            "stock_quantity": stock,
            "today_purchase_num": 0,
            "this_month_purchase_num": null,
            "total_purchase_num": bought,
            "group_info": {
                "group_total_stock_quantity": maxLevel - bought,
                "group_total_purchase_num": bought,
                "multi_stage": stages.length > 1,
            },
            "shop_type": EQUIPMENT_ENHANCEMENT_SHOP_TYPE,
        })
    }
    return result
}

/** Buys `amount` levels of an offer. Returns the reply data, or why it can't be bought. */
export function buyEnhancementSync(playerId: number, offerId: number, amount: number): { ok: true, data: Record<string, unknown> } | { ok: false, message: string } {
    const offer = offers()[String(offerId)]
    if (offer === undefined) return { ok: false, message: "Shop item with specified id does not exist." }
    const now = getServerDate().getTime()
    const stages = stagesByArmament(now).get(`${offer.category}:${offer.groupId}:${offer.equipmentId}`)
    if (!stages) return { ok: false, message: "This augmentation isn't offered now." }
    const equipment = getPlayerEquipmentSync(playerId, offer.equipmentId)
    if (equipment === null) return { ok: false, message: "You don't own this armament." }
    const level = equipment.enhancementLevel ?? 0
    const current = stages.find(([, stage]) => stage.maxLevel > level)
    if (current === undefined || current[0] !== String(offerId)) return { ok: false, message: "This isn't the armament's current augmentation stage." }
    if (!Number.isInteger(amount) || amount <= 0 || level + amount > offer.maxLevel) return { ok: false, message: "That goes past this stage's maximum level." }
    if (equipment.level < offer.requireAwakening) return { ok: false, message: "The armament isn't awakened enough." }

    const itemList: Record<string, number> = {}
    for (const cost of offer.costs) {
        const left = (getPlayerItemSync(playerId, cost.id) ?? 0) - cost.amount * amount
        if (left < 0) return { ok: false, message: `Not enough of item ${cost.id}.` }
        itemList[cost.id] = left
    }
    for (const [itemId, left] of Object.entries(itemList)) updatePlayerItemSync(playerId, itemId, left)
    updatePlayerEquipmentSync(playerId, offer.equipmentId, { enhancementLevel: level + amount })
    return {
        ok: true,
        data: {
            "equipment_list": [{
                "equipment_id": offer.equipmentId,
                "protection": equipment.protection,
                "level": equipment.level,
                "enhancement_level": level + amount,
                "stack": equipment.stack,
            }],
            "item_list": itemList,
            "mail_arrived": false,
        },
    }
}
