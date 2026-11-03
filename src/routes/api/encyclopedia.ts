// Handles the insertion of mana into characters.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSession } from "../../data/wdfpData";
import { generateDataHeaders } from "../../utils";
import encyclopedia from "../../../assets/encyclopedia.json";
import { cnTableIds, isCnRequest } from "../../lib/cnClient";

// the CN client's entries (cn_ids.json "encyclopedia", entry*100+page), all unlocked and read like global's list;
// global's list alone leaves the CN-only entries locked
let cnEncyclopedia: Record<string, { read: boolean }> | null = null
function encyclopediaFor(cn: boolean): Record<string, { read: boolean }> {
    if (!cn) return encyclopedia
    if (cnEncyclopedia === null) {
        const ids = cnTableIds("encyclopedia")
        cnEncyclopedia = ids === null ? encyclopedia : Object.fromEntries([...ids].map(id => [String(id), { read: true }]))
    }
    return cnEncyclopedia
}

interface IndexBody {
    api_count: number,
    viewer_id: number,
}

interface ReadKeywordBody {
    encyclopedia_ids: number[],
    viewer_id: number
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/read_keyword", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ReadKeywordBody

        const viewerId = body.viewer_id
        const encyclopediaIds = body.encyclopedia_ids
        if (isNaN(viewerId) || encyclopediaIds === undefined) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        const encyclopediaList: Record<string, object> = {}
        for (const id of encyclopediaIds) {
            encyclopediaList[id] = {
                "read": true
            }
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "encyclopedia_list": encyclopediaList
            }
        })
    })

    fastify.post("/index", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as IndexBody

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

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "encyclopedia_list": encyclopediaFor(isCnRequest(request.originalUrl)),
                "mail_arrived": false
            }
        })
    })
}

export default routes;