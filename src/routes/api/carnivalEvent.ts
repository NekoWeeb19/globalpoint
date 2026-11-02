// Handles the Hanifolk Carnival screen (/carnival_event/index and /carnival_event/get_party).
// There is no recorded global traffic for these; the request and reply shapes follow the Chinese
// StarPoint fork (src/routes/api/carnivalEvent.ts), whose other event endpoints match this server's.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAccountPlayers, getSession } from "../../data/wdfpData";
import { getCarnivalPartyGroupListSync, getCarnivalRecordsSync } from "../../nya/carnival";
import { generateDataHeaders } from "../../utils";

interface IndexBody {
    event_id: number,
    viewer_id: number,
    api_count: number
}

interface GetPartyBody {
    viewer_id: number,
    api_count: number
}

async function resolvePlayer(viewerId: number, reply: FastifyReply): Promise<number | null> {
    if (!viewerId || isNaN(viewerId)) {
        reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." })
        return null
    }
    const session = await getSession(viewerId.toString())
    if (!session) {
        reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." })
        return null
    }
    const playerId = (await getAccountPlayers(session.accountId))[0]
    if (playerId === undefined || isNaN(playerId)) {
        reply.status(500).send({ "error": "Internal Server Error", "message": "No player bound to account." })
        return null
    }
    return playerId
}

const routes = async (fastify: FastifyInstance) => {
    // opening the carnival: each folder's records, and the carnival parties
    fastify.post("/index", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as IndexBody
        const playerId = await resolvePlayer(body?.viewer_id, reply)
        if (playerId === null) return reply

        const eventId = Number(body.event_id)
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: body.viewer_id }),
            "data": {
                "records": Number.isSafeInteger(eventId) ? getCarnivalRecordsSync(playerId, eventId) : [],
                "user_party_group_list": getCarnivalPartyGroupListSync(playerId)
            }
        })
    })

    fastify.post("/get_party", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GetPartyBody
        const playerId = await resolvePlayer(body?.viewer_id, reply)
        if (playerId === null) return reply

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: body.viewer_id }),
            "data": {
                "user_party_group_list": getCarnivalPartyGroupListSync(playerId)
            }
        })
    })
}

export default routes;
