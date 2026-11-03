// Handles claiming active (step-up) mission rewards.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAccountPlayers, getPlayerSync, getSession } from "../../data/wdfpData";
import { ActiveMissionClaimRequest } from "../../lib/activeMission";
import { claimPlayerActiveMissionsSync } from "../../nya/activeMission";
import { generateDataHeaders, epochOf } from "../../utils";

interface ReceiveActiveMissionBody {
    viewer_id: number,
    api_count: number,
    active_mission_list: ActiveMissionClaimRequest[]
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/receive", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ReceiveActiveMissionBody | undefined

        const viewerId = body?.viewer_id
        if (!body || !viewerId || isNaN(viewerId) || !Array.isArray(body.active_mission_list)) return reply.status(400).send({
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

        const result = claimPlayerActiveMissionsSync(playerId, body.active_mission_list)

        for (const skipped of result.skipped) {
            console.warn(`[active_mission/receive] Skipped mission ${skipped.mission_id} stage ${skipped.stage}: ${skipped.reason}.`)
        }

        const userInfo: Record<string, number | undefined> = { ...result.user_info }
        if (result.expChanged) {
            const player = getPlayerSync(playerId)
            if (player) userInfo["exp_pooled_time"] = epochOf(player.expPooledTime)
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "active_mission_list": result.active_mission_list,
                "user_info": userInfo,
                "item_list": result.item_list,
                ...(result.character_list ? { "character_list": result.character_list, "joined_character_id_list": result.joined_character_id_list } : {}),
                ...(result.equipment_list ? { "equipment_list": result.equipment_list } : {}),
                "mail_arrived": false
            }
        })
    })
}

export default routes;
