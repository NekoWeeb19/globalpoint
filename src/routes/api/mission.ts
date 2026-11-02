// Handles the Mission screen (Regular, Daily and Event tabs).

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAccountPlayers, getSession } from "../../data/wdfpData";
import { getPlayerMissionProgressListSync, progressPlayerMissionsSync } from "../../nya/mission";
import { clientReportedEvents } from "../../lib/mission";
import { generateDataHeaders } from "../../utils";
import { awakeMissionProgressListSync } from "../../nya/manaAwake";

interface GetMissionProgressBody {
    api_count: number,
    viewer_id: number,
    category_list: {
        category: number
    }[]
}

interface UpdateMissionProgressBody {
    viewer_id: number,
    api_count: number,
    mission_param_list: {
        progress_value: number,
        mission_pattern: string
    }
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/get_mission_progress", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GetMissionProgressBody

        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        const playerIds = await getAccountPlayers(viewerIdSession.accountId)
        const playerId = playerIds[0]
        if (playerId === undefined || isNaN(playerId)) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        // 1 = regular, 2 = daily, 3 = event. Other categories (titles...) aren't handled yet and come back empty.
        const categories = Array.isArray(body.category_list)
            ? body.category_list.map(entry => Number(entry?.category)).filter(Number.isSafeInteger)
            : []

        let missionProgressList: any[] = []
        try {
            missionProgressList = getPlayerMissionProgressListSync(playerId, categories.filter(category => category !== 9))
            // CN unit awake missions (category 9), asked for one unit at a time
            for (const entry of Array.isArray(body.category_list) ? body.category_list as { category: number, character_id?: number }[] : [])
                if (Number(entry?.category) === 9 && Number.isSafeInteger(Number(entry.character_id)))
                    missionProgressList.push(...awakeMissionProgressListSync(playerId, Number(entry.character_id)))
        } catch (error) {
            // an empty list is what this endpoint sent before, so the Mission screen still opens
            console.error(`Could not build the mission list for player ${playerId}:`, error)
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "mission_progress_list": missionProgressList,
                "mail_arrived": false
            }
        })
    })

    fastify.post("/update_mission_progress", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as UpdateMissionProgressBody

        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // progress the client counts itself (tapping a unit in town...): added to those missions, then
        // any stage reached is paid. A title earned this way is listed in degree_list, as the recorded
        // global reply did (mission 5/49000 -> title 49000).
        const playerId = (await getAccountPlayers(viewerIdSession.accountId))[0]
        const events = clientReportedEvents((body as any).mission_param_list)
        const result = playerId !== undefined && !isNaN(playerId) && events.length > 0
            ? progressPlayerMissionsSync(playerId, events)
            : null

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "mission_info": result?.mission_info ?? [],
                "degree_list": (result?.new_degree_ids ?? []).map(degreeId => ({ "viewer_id": viewerId, "degree_id": degreeId })),
                ...(result !== null && Object.keys(result.user_info).length > 0 ? { "user_info": result.user_info } : {}),
                ...(result !== null && Object.keys(result.item_list).length > 0 ? { "item_list": result.item_list } : {}),
                "mail_arrived": false
            }
        })
    })
}

export default routes;