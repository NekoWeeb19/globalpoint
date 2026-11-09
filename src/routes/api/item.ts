// item/use_item (stamina items) and item/sell (items for mana). The rules are in src/lib/item.ts.
//
// Neither route was recorded on global. The requests are the global client's own
// (ItemUseItemRealRemote / ItemSellRealRemote), and the replies use the fields every action reply
// carries (user_info, item_list, mail_arrived), as the Chinese fork does (routes/api/item.ts). Game
// errors go out as a result code in data_headers, which the client turns into its own message.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { addStaminaSync, currentPlayerStamina, realStaminaOn, staminaUserInfo } from "../../nya/stamina";
import itemRulesData from "../../../assets/item_rules.json"
import getDatabase, { Database } from "../../data"
import { getAccountPlayers, getPlayerItemSync, getPlayerSync, getSession, updatePlayerItemSync, updatePlayerSync } from "../../data/wdfpData";
import { generateDataHeaders, getServerDate, getServerTime } from "../../utils";
import { ItemRefusal, ItemRules, parseUseItems, planItemSale, planItemUse } from "../../lib/item";
import { COUNTER_KINDS } from "../../lib/mission";
import { withMissionRewards } from "../../nya/mission";

const rules = itemRulesData as ItemRules

const bad = (reply: FastifyReply, message = "Invalid request body.") => reply.status(400).send({ "error": "Bad Request", "message": message })

function ok(reply: FastifyReply, viewerId: number, data: unknown) {
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({ "data_headers": generateDataHeaders({ viewer_id: viewerId }), "data": data })
}

/** A refusal with a result code goes to the client (it shows its own message); others are a 400. */
function refuse(reply: FastifyReply, viewerId: number, refusal: ItemRefusal, label: string, playerId: number) {
    console.log(`[item] Player ${playerId}: ${label} refused: ${refusal.message}`)
    if (refusal.resultCode === undefined) return bad(reply, refusal.message)
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({ "data_headers": generateDataHeaders({ viewer_id: viewerId, result_code: refusal.resultCode }), "data": {} })
}

/** The viewer's player id, or null. */
async function viewerPlayer(viewerId: unknown): Promise<number | null> {
    if (!viewerId || isNaN(Number(viewerId))) return null
    const session = await getSession(String(viewerId))
    if (!session) return null
    const playerId = (await getAccountPlayers(session.accountId))[0]
    return playerId === undefined || isNaN(playerId) || getPlayerSync(playerId) === null ? null : playerId
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/use_item", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, items: unknown }
        const playerId = await viewerPlayer(body?.viewer_id)
        const requests = parseUseItems(body?.items)
        if (playerId === null || requests === null) return bad(reply)

        const result = getDatabase(Database.WDFP_DATA).transaction(() => {
            const player = getPlayerSync(playerId)!
            // real stamina (src/nya/stamina.ts): items add to the stamina now, refill included
            const real = realStaminaOn()
            const staminaBefore = real ? currentPlayerStamina(player) : player.stamina
            const plan = planItemUse(rules, requests, id => getPlayerItemSync(playerId, id) ?? 0, staminaBefore, getServerDate().getTime())
            if (!plan.ok) return plan
            const itemList: Record<string, number> = {}
            for (const spend of plan.spend) {
                const after = (getPlayerItemSync(playerId, spend.id) ?? 0) - spend.count
                updatePlayerItemSync(playerId, spend.id, after)
                itemList[String(spend.id)] = after
            }
            if (real) {
                const after = addStaminaSync(playerId, plan.staminaAfter - staminaBefore)!
                return { ok: true as const, itemList, stamina: after.stamina, staminaBefore, healTime: after.staminaHealTime, real }
            }
            const healTime = getServerDate()
            updatePlayerSync({ id: playerId, stamina: plan.staminaAfter, staminaHealTime: healTime })
            return { ok: true as const, itemList, stamina: plan.staminaAfter, staminaBefore: player.stamina, healTime, real }
        })()
        if (!result.ok) return refuse(reply, body.viewer_id, result, "use_item", playerId)

        console.log(`[item] Player ${playerId}: used ${requests.map(r => `${r.count}x ${r.id}`).join(", ")}, stamina ${result.staminaBefore} -> ${result.stamina}.`)
        return ok(reply, body.viewer_id, {
            "user_info": result.real ? staminaUserInfo({ stamina: result.stamina, staminaHealTime: result.healTime }) : {
                "stamina": result.stamina,
                "stamina_heal_time": getServerTime(result.healTime),
            },
            "item_list": result.itemList,
            "mail_arrived": false,
        })
    })

    fastify.post("/sell", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, item_id: unknown, sell_number: unknown }
        const playerId = await viewerPlayer(body?.viewer_id)
        if (playerId === null) return bad(reply)

        const result = getDatabase(Database.WDFP_DATA).transaction(() => {
            const player = getPlayerSync(playerId)!
            const owned = typeof body.item_id === "number" ? getPlayerItemSync(playerId, body.item_id) ?? 0 : 0
            const plan = planItemSale(rules, body.item_id, body.sell_number, owned, player.freeMana, getServerDate().getTime())
            if (!plan.ok) return plan
            updatePlayerItemSync(playerId, body.item_id as number, plan.countAfter)
            updatePlayerSync({ id: playerId, freeMana: player.freeMana + plan.mana })
            return { ...plan, freeMana: player.freeMana + plan.mana }
        })()
        if (!result.ok) return refuse(reply, body.viewer_id, result, "sell", playerId)

        console.log(`[item] Player ${playerId}: sold ${body.sell_number}x ${body.item_id} for ${result.mana} mana.`)
        // "Obtain a total of N mana" counts mana from selling (as in the Chinese fork)
        return ok(reply, body.viewer_id, withMissionRewards(playerId, {
            "user_info": { "free_mana": result.freeMana },
            "item_list": { [String(body.item_id)]: result.countAfter },
            "mail_arrived": false,
        }, result.mana > 0 ? [{ kind: COUNTER_KINDS.TOTAL_MANA, amount: result.mana }] : []))
    })
}

export default routes;
