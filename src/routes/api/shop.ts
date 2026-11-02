// Handles the insertion of mana into characters.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { buyEnhancementSync, enhancementSalesListSync, EQUIPMENT_ENHANCEMENT_SHOP_TYPE } from "../../nya/equipmentEnhancement";
import { getPlayerShopPurchasesSync, recordShopPurchaseSync } from "../../nya/shopPurchases";
import { deserializeClientDate } from "../../data/utils";
import { getAccountPlayers, getPlayerItemSync, getPlayerSync, getSession, updatePlayerItemSync, updatePlayerSync } from "../../data/wdfpData";
import { getBossCoinShopItemsSync, getEventShopItemsSync, getGenericShopItemsSync, getShopItemSync } from "../../lib/assets";
import { CharacterReward, CharacterShopItemReward, CurrencyReward, CurrencyShopItemReward, EquipmentItemReward, EquipmentItemShopItemReward, Reward, RewardType, ShopItemRewardType, ShopItems, ShopItemUserCostType, ShopType } from "../../lib/types";
import { generateDataHeaders, getServerDate, epochOf, getServerTime } from "../../utils";
import { givePlayerRewardsSync } from "../../lib/quest";
import { trackActiveMissionProgress } from "../../nya/activeMissionProgress";
import { withMissionRewards } from "../../nya/mission";
import { addPassPointSync, getPassPointPack, openPassIdSync } from "../../nya/passCard";
import { isCnRequest } from "../../lib/cnClient";
import { COUNTER_KINDS, CounterEvent } from "../../lib/mission";

interface GetSalesListBody {
    equipment_enhancement_shop_category_ids: number[],
    boss_coin_shop_category_ids: number[],
    browse_treasure_flag: boolean,
    shop_types: ShopType[],
    event_list: {
        event_type: number,
        event_ids: number[]
    }[],
    viewer_id: number
}

interface BuyBody {
    shop_type: number,
    api_count: number,
    shop_item_id: number,
    number: number,
    viewer_id: number
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/buy", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as BuyBody

        const viewerId = body.viewer_id
        const shopType = body.shop_type
        const rawPurchaseAmount = body.number
        const shopItemId = body.shop_item_id
        if (isNaN(viewerId) || isNaN(shopType) || isNaN(rawPurchaseAmount) || isNaN(shopItemId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const purchaseAmount = Math.max(1, rawPurchaseAmount)

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerIds = await getAccountPlayers(viewerIdSession.accountId)
        const playerId = playerIds[0]
        const player = isNaN(playerId) ? null : getPlayerSync(playerId)

        if (player === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        // Augment Armament (shop type 10): raises the armament's augment level (src/nya/equipmentEnhancement.ts)
        if (shopType === EQUIPMENT_ENHANCEMENT_SHOP_TYPE) {
            const result = buyEnhancementSync(playerId, shopItemId, purchaseAmount)
            if (!result.ok) return reply.status(400).send({ "error": "Bad Request", "message": result.message })
            recordShopPurchaseSync(playerId, shopType, shopItemId, purchaseAmount)
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({ "data_headers": generateDataHeaders({ viewer_id: viewerId }), "data": result.data })
        }

        // CN pass point packs (special pack shop, type 3): paid beads for points in the open pass
        // ("The Way of Practice" level-up). The client asks for the pass again afterwards.
        const pointPack = shopType === ShopType.SPECIAL_PACK && isCnRequest(request.originalUrl) ? getPassPointPack(shopItemId) : null
        if (pointPack !== null) {
            const passId = openPassIdSync(getServerDate().getTime())
            if (passId === null) return reply.status(400).send({ "error": "Bad Request", "message": "No pass is open." })
            // paid beads only (the client's purchase dialog takes them from "Paid")
            const cost = pointPack.beads * purchaseAmount
            if (cost > player.vmoney) return reply.status(400).send({ "error": "Bad Request", "message": "Not enough paid beads." })
            updatePlayerSync({ id: playerId, vmoney: player.vmoney - cost })
            const point = addPassPointSync(playerId, passId, pointPack.points * purchaseAmount)
            recordShopPurchaseSync(playerId, shopType, shopItemId, purchaseAmount)
            console.log(`[pass] Player ${playerId}: bought ${purchaseAmount}x ${pointPack.name} for ${cost} beads; pass ${passId} now ${point} points.`)
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId }),
                "data": {
                    "user_info": { "free_vmoney": player.freeVmoney, "vmoney": player.vmoney - cost },
                    "item_list": {},
                    "mail_arrived": false
                }
            })
        }

        // get the shop item's data
        const shopItemData = getShopItemSync(shopType, shopItemId)
        if (shopItemData === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Shop item with specified id does not exist."
        })

        // keep track of various stats
        const itemList: Record<string, number> = {}
        let freeVmoney = player.freeVmoney
        let freeMana = player.freeMana
        let bondTokens = player.bondToken

        // verify user costs
        const userCost = shopItemData.userCost
        if (userCost !== undefined) {
            switch (userCost.type) {
                case ShopItemUserCostType.MANA:
                    freeMana -= (userCost.amount * purchaseAmount)
                    break;
                case ShopItemUserCostType.BEADS:
                    freeVmoney -= (userCost.amount * purchaseAmount)
                    break;
                case ShopItemUserCostType.AMITY_SCROLL:
                    bondTokens -= (userCost.amount * purchaseAmount)
            }

            if (0 > freeVmoney) return reply.status(400).send({
                "error": "Bad Request",
                "message": `Not enough beads to purchase shop item.`
            })
            if (0 > freeMana) return reply.status(400).send({
                "error": "Bad Request",
                "message": `Not enough mana to purchase shop item.`
            })
            if (0 > bondTokens) return reply.status(400).send({
                "error": "Bad Request",
                "message": `Not enough amity scrolls to purchase shop item.`
            })
        }

        // verify cost items
        {
            for (const cost of shopItemData.costs) {
                const itemId = cost.id
                const itemAmount = getPlayerItemSync(playerId, itemId) ?? 0
                const newItemAmount = itemAmount - (cost.amount * purchaseAmount)
                if (0 > newItemAmount) return reply.status(400).send({
                    "error": "Bad Request",
                    "message": `Not enough of item with id ${itemId} to purchase shop item.`
                })

                itemList[itemId] = newItemAmount
            }

            // deduct cost item
            for (const [itemId, newAmount] of Object.entries(itemList)) {
                updatePlayerItemSync(playerId, itemId, newAmount)
            }
        }

        // update player
        updatePlayerSync({
            id: playerId,
            freeMana: freeMana,
            freeVmoney: freeVmoney,
            bondToken: bondTokens
        })

        // build rewards array
        const rewards: Reward[] = []
        for (const reward of shopItemData.rewards) {
            switch (reward.type) {
                case ShopItemRewardType.ITEM: {
                    const shopReward = reward as EquipmentItemShopItemReward
                    rewards.push({
                        name: "",
                        type: RewardType.ITEM,
                        id: shopReward.id,
                        count: shopReward.count * purchaseAmount
                    } as EquipmentItemReward)
                    break;
                }
                case ShopItemRewardType.EXP: {
                    const shopReward = reward as CurrencyShopItemReward
                    rewards.push({
                        name: "",
                        type: RewardType.EXP,
                        count: shopReward.count * purchaseAmount
                    } as CurrencyReward)
                    break;
                }
                case ShopItemRewardType.MANA:{
                    const shopReward = reward as CurrencyShopItemReward
                    rewards.push({
                        name: "",
                        type: RewardType.MANA,
                        count: shopReward.count * purchaseAmount
                    } as CurrencyReward)
                    break;
                }
                case ShopItemRewardType.CHARACTER: {
                    const shopReward = reward as CharacterShopItemReward
                    for (let i = 0; i < purchaseAmount; i++) {
                        rewards.push({
                            name: "",
                            type: RewardType.CHARACTER,
                            id: shopReward.id
                        } as CharacterReward)
                    }
                    break;
                }
                case ShopItemRewardType.EQUIPMENT: {
                    const shopReward = reward as EquipmentItemShopItemReward
                    rewards.push({
                        name: "",
                        type: RewardType.EQUIPMENT,
                        id: shopReward.id,
                        count: shopReward.count * purchaseAmount
                    } as EquipmentItemReward)
                    break;
                }

            }
        }
        // give rewards
        const rewardResult = givePlayerRewardsSync(playerId, rewards)

        // active missions: items bought in the treasure shop
        const missionCounters: Record<number, number> = {}
        if (shopType === ShopType.TREASURE) missionCounters[45] = purchaseAmount
        // ...and equipment bought with boss coins
        if (shopType === ShopType.BOSS_COIN && shopItemData.rewards.some(reward => reward.type === ShopItemRewardType.EQUIPMENT)) {
            missionCounters[64] = purchaseAmount
        }
        const activeMissionList = Object.keys(missionCounters).length > 0
            ? trackActiveMissionProgress(playerId, { add: missionCounters })
            : []

        // Mission screen: mana spent at The Trove, and mana obtained from the shop
        const missionEvents: CounterEvent[] = []
        if (shopType === ShopType.TREASURE && userCost?.type === ShopItemUserCostType.MANA) {
            missionEvents.push({ kind: COUNTER_KINDS.TROVE_MANA_SPENT, amount: userCost.amount * purchaseAmount })
        }
        // "Spend N mana" (campaign missions): any mana paid in a shop
        if (userCost?.type === ShopItemUserCostType.MANA && userCost.amount * purchaseAmount > 0) {
            missionEvents.push({ kind: COUNTER_KINDS.MANA_SPENT, amount: userCost.amount * purchaseAmount })
        }
        for (const reward of shopItemData.rewards) {
            if (reward.type === ShopItemRewardType.MANA) {
                missionEvents.push({ kind: COUNTER_KINDS.TOTAL_MANA, amount: (reward as CurrencyShopItemReward).count * purchaseAmount })
            }
        }

        reply.header("content-type", "application/x-msgpack")
        recordShopPurchaseSync(playerId, shopType, shopItemId, purchaseAmount)

        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": withMissionRewards(playerId, {
                "user_info": {
                    "free_mana": freeMana + (rewardResult?.user_info.free_mana ?? 0),
                    "exp_pool": player.expPool + (rewardResult?.user_info.exp_pool ?? 0),
                    "exp_pooled_time": epochOf(player.expPooledTime),
                    "bond_token": bondTokens
                },
                "joined_character_id_list": rewardResult?.joined_character_id_list ?? [],
                "character_list": rewardResult?.character_list ?? [],
                "equipment_list": rewardResult?.equipment_list ?? [],
                "item_list": {
                    ...itemList,
                    ...(rewardResult?.items ?? {})
                },
                "mail_arrived": false,
                ...(activeMissionList.length > 0 ? { "active_mission_list": activeMissionList } : {})
            }, missionEvents)
        })
    })

    fastify.post("/get_sales_list", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GetSalesListBody

        const viewerId = body.viewer_id
        const shopTypes = body.shop_types
        const bossCoinShopCategoryIds = body.boss_coin_shop_category_ids
        const eventList = body.event_list
        if (isNaN(viewerId) || shopTypes === undefined || bossCoinShopCategoryIds === undefined || eventList === undefined) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerIds = await getAccountPlayers(viewerIdSession.accountId)
        const playerId = playerIds[0]

        if (isNaN(playerId)) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        let toParseShopItems: Record<number, ShopItems> = {}

        // shop types
        for (const type of shopTypes) {
            const items = getGenericShopItemsSync(type)
            const existing = toParseShopItems[type] ?? {}
            toParseShopItems[type] = items === null ? existing : { ...existing, ...items }
        }

        // event list
        for (const event of eventList) {
            const type = event.event_type
            for (const eventId of event.event_ids) {
                const items = getEventShopItemsSync(type, eventId)
                const existing = toParseShopItems[ShopType.EVENT_ITEM] ?? {}
                toParseShopItems[ShopType.EVENT_ITEM] = items === null ? existing : { ...existing, ...items }
            }
        }

        // boss coin shop category ids
        for (const category of bossCoinShopCategoryIds) {
            const items = getBossCoinShopItemsSync(category)
            const existing = toParseShopItems[ShopType.BOSS_COIN] ?? {}
            toParseShopItems[ShopType.BOSS_COIN] = items === null ? existing : { ...existing, ...items }
        }

        // parse shop items
        const salesList: Object[] = []

        const now: number = getServerDate().getTime()
        const bought = getPlayerShopPurchasesSync(playerId)
        for (const [shopType, items] of Object.entries(toParseShopItems)) {
            for (const [itemId, item] of Object.entries(items)) {
                const from = deserializeClientDate(item.availableFrom)
                const until = item.availableUntil === null ? null : deserializeClientDate(item.availableUntil)

                if ((now >= from.getTime()) && (until === null || (until.getTime() > now))) {
                    const counts = bought.get(`${shopType}:${itemId}`) ?? { today: 0, month: 0, total: 0 }
                    salesList.push({
                        "shop_item_id": Number(itemId),
                        "stock_quantity": -1, // Change if you want a limited quantity of items. -1 = infinite.
                        "today_purchase_num": counts.today,
                        "this_month_purchase_num": counts.month,
                        "total_purchase_num": counts.total,
                        "group_info": {
                            "group_total_stock_quantity": -1,
                            "group_total_purchase_num": 0,
                            "multi_stage": false
                        },
                        "shop_type": Number(shopType)
                    })
                }
            }
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "sales_list": (shopTypes as number[]).includes(EQUIPMENT_ENHANCEMENT_SHOP_TYPE)
                    ? [...salesList, ...enhancementSalesListSync(playerId, body.equipment_enhancement_shop_category_ids ?? [])]
                    : salesList
            }
        })
    })
}

/** Registered at the API prefix itself (the path isn't under /shop). */
export const howToGetRoutes = async (fastify: FastifyInstance) => {
    // the item details' "How to Get": open shop entries that give the item (the trove, general and star
    // grain shops; event and boss coin shops are listed by their own screens). Box summons aren't
    // looked through (box_gacha_id_list stays empty), so the item's own "how to get" text is shown.
    fastify.post("/how_to_get/get_list", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, item_id: number }
        const viewerId = Number(body?.viewer_id), itemId = Number(body?.item_id)
        const viewerIdSession = isNaN(viewerId) ? null : await getSession(viewerId.toString())
        if (!viewerIdSession || isNaN(itemId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })
        const playerId = (await getAccountPlayers(viewerIdSession.accountId))[0]
        const bought = getPlayerShopPurchasesSync(playerId)
        const now = getServerDate().getTime()
        const salesList: Object[] = []
        for (const shopType of [ShopType.TREASURE, ShopType.GENERAL, ShopType.STAR_GRAIN]) {
            for (const [shopItemId, item] of Object.entries(getGenericShopItemsSync(shopType) ?? {})) {
                if (!(item.rewards as { type?: number, id?: number }[]).some(reward => (reward.type ?? 0) === 0 && Number(reward.id) === itemId)) continue
                const until = item.availableUntil === null ? null : deserializeClientDate(item.availableUntil).getTime()
                if (now < deserializeClientDate(item.availableFrom).getTime() || (until !== null && until <= now)) continue
                const counts = bought.get(`${shopType}:${shopItemId}`) ?? { today: 0, month: 0, total: 0 }
                salesList.push({
                    "shop_item_id": Number(shopItemId),
                    "stock_quantity": -1,
                    "today_purchase_num": counts.today,
                    "this_month_purchase_num": counts.month,
                    "total_purchase_num": counts.total,
                    "shop_type": shopType,
                })
            }
        }
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "box_gacha_id_list": [],
                "unselected_lineup_shop_sales_list": [],
                "shop_sales_list": salesList,
            }
        })
    })
}

export default routes;