// exchange/star_crumb, exchange/bond_token and exchange/get_bond_token_exchange_list. The rules are in
// src/lib/exchange.ts.
//
// None of these was recorded on global. The requests are the global client's own ({ exchange_id },
// { equipment_id }, and no fields for the list); the list reply is the array the client reads
// (data[i].equipment_id / exchange_count), and the exchange replies use the fields every action
// reply carries (user_info, character_list, equipment_list, item_list), as the Chinese fork does
// (routes/api/exchange.ts).

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import exchangeData from "../../../assets/exchange.json"
import getDatabase, { Database } from "../../data"
import { readFileSync } from "fs"
import path from "path"
import { inCnRequest } from "../../lib/cnClient"
import { getAccountPlayers, getPlayerItemSync, getPlayerSync, getSession, playerOwnsCharacterSync, playerOwnsEquipmentSync, updatePlayerSync } from "../../data/wdfpData";
import { generateDataHeaders, getServerDate } from "../../utils";
import { bondTokenExchangeList, ExchangeData, planBondTokenExchange, planStarCrumbExchange } from "../../lib/exchange";
import { givePlayerRewardsSync } from "../../lib/quest";
import { CharacterReward, EquipmentItemReward, RewardType } from "../../lib/types";

const globalData = exchangeData as unknown as ExchangeData
// the CN client numbers its exchange rows differently: its own copy (scripts/gen_cn_exchanges.cjs)
let cnData: ExchangeData | null = null
function exchangesFor(): ExchangeData {
    if (!inCnRequest()) return globalData
    try { cnData ??= JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "assets", "exchange_cn.json"), "utf8")) } catch { return globalData }
    return cnData ?? globalData
}

const bad = (reply: FastifyReply, message = "Invalid request body.") => reply.status(400).send({ "error": "Bad Request", "message": message })

function ok(reply: FastifyReply, viewerId: number, body: unknown) {
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({ "data_headers": generateDataHeaders({ viewer_id: viewerId }), "data": body })
}

/** The viewer's player id, or null. */
async function viewerPlayer(viewerId: unknown): Promise<number | null> {
    if (!viewerId || isNaN(Number(viewerId))) return null
    const session = await getSession(String(viewerId))
    if (!session) return null
    const playerId = (await getAccountPlayers(session.accountId))[0]
    return playerId === undefined || isNaN(playerId) || getPlayerSync(playerId) === null ? null : playerId
}

/** How many times the player exchanged bond tokens for an armament. */
function bondTokenExchangedSync(playerId: number, equipmentId: number): number {
    const row = getDatabase(Database.WDFP_DATA).prepare(`SELECT exchange_count FROM players_bond_token_exchange WHERE player_id = ? AND equipment_id = ?`).get(playerId, equipmentId) as { exchange_count: number } | undefined
    return row?.exchange_count ?? 0
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/star_crumb", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, exchange_id: unknown }
        const playerId = await viewerPlayer(body?.viewer_id)
        if (playerId === null) return bad(reply)

        const result = getDatabase(Database.WDFP_DATA).transaction(() => {
            const player = getPlayerSync(playerId)!
            const plan = planStarCrumbExchange(exchangesFor(), body.exchange_id, player.starCrumb, {
                hasCharacter: id => playerOwnsCharacterSync(playerId, id),
                hasEquipment: id => playerOwnsEquipmentSync(playerId, id),
                itemCount: id => getPlayerItemSync(playerId, id) ?? 0,
            }, getServerDate().getTime())
            if (!plan.ok) return plan
            updatePlayerSync({ id: playerId, starCrumb: plan.starCrumbAfter })
            const { kind, targetId } = plan.exchange
            const reward = kind === "character" ? { type: RewardType.CHARACTER, id: targetId } as CharacterReward
                : { type: kind === "equipment" ? RewardType.EQUIPMENT : RewardType.ITEM, id: targetId, count: 1 } as EquipmentItemReward
            const given = givePlayerRewardsSync(playerId, [reward])
            if (given === null) throw new Error(`Couldn't give ${kind} ${targetId}.`)
            return { ok: true as const, plan, given }
        })()
        if (!result.ok) {
            console.log(`[exchange] Player ${playerId}: star crumb exchange ${String(body.exchange_id)} refused: ${result.message}`)
            return bad(reply, result.message)
        }

        const { exchange, starCrumbAfter } = result.plan
        console.log(`[exchange] Player ${playerId}: ${exchange.cost} Star Crumbs -> ${exchange.kind} ${exchange.targetId} (${starCrumbAfter} left).`)
        return ok(reply, body.viewer_id, {
            "user_info": { "star_crumb": starCrumbAfter },
            "character_list": result.given.character_list,
            "joined_character_id_list": result.given.joined_character_id_list,
            "equipment_list": result.given.equipment_list,
            "item_list": result.given.items,
            "mail_arrived": false,
        })
    })

    fastify.post("/bond_token", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, equipment_id: unknown }
        const playerId = await viewerPlayer(body?.viewer_id)
        if (playerId === null) return bad(reply)

        const db = getDatabase(Database.WDFP_DATA)
        const result = db.transaction(() => {
            const player = getPlayerSync(playerId)!
            const equipmentId = body.equipment_id
            const exchanged = typeof equipmentId === "number" ? bondTokenExchangedSync(playerId, equipmentId) : 0
            const plan = planBondTokenExchange(exchangesFor(), equipmentId, player.bondToken, exchanged, getServerDate().getTime())
            if (!plan.ok) return plan
            updatePlayerSync({ id: playerId, bondToken: plan.bondTokenAfter })
            db.prepare(`INSERT INTO players_bond_token_exchange (equipment_id, exchange_count, player_id) VALUES (?, ?, ?)
                ON CONFLICT (equipment_id, player_id) DO UPDATE SET exchange_count = excluded.exchange_count`).run(equipmentId, plan.exchangedAfter, playerId)
            const given = givePlayerRewardsSync(playerId, [{ type: RewardType.EQUIPMENT, id: equipmentId as number, count: 1 } as EquipmentItemReward])
            if (given === null) throw new Error(`Couldn't give armament ${equipmentId}.`)
            return { ok: true as const, plan, given }
        })()
        if (!result.ok) {
            console.log(`[exchange] Player ${playerId}: bond token exchange ${String(body.equipment_id)} refused: ${result.message}`)
            return bad(reply, result.message)
        }

        console.log(`[exchange] Player ${playerId}: ${result.plan.exchange.cost} bond tokens -> armament ${body.equipment_id} (${result.plan.bondTokenAfter} left).`)
        return ok(reply, body.viewer_id, {
            "user_info": { "bond_token": result.plan.bondTokenAfter },
            "equipment_list": result.given.equipment_list,
            "mail_arrived": false,
        })
    })

    fastify.post("/get_bond_token_exchange_list", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number }
        const playerId = await viewerPlayer(body?.viewer_id)
        if (playerId === null) return bad(reply)
        return ok(reply, body.viewer_id, bondTokenExchangeList(exchangesFor(), id => bondTokenExchangedSync(playerId, id), getServerDate().getTime()))
    })
}

export default routes;
