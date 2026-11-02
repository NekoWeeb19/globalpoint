// Handles mail.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSession } from "../../data/wdfpData";
import { generateDataHeaders } from "../../utils";

interface ItemListBody {
    api_count: number,
    viewer_id: number,
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/item_list", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ItemListBody

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
                "payment_item_list": []
            }
        })
    })

    // "Check Lodestar Beads & Mana" > Detail (CN client): paid beads and mana bought, by store product
    // id -> count. Nothing is ever bought with real money here, so both are empty.
    fastify.post("/detail_items", async (request: FastifyRequest, reply: FastifyReply) => {
        const viewerId = Number((request.body as { viewer_id?: number } | undefined)?.viewer_id)
        if (!viewerId || !(await getSession(String(viewerId)))) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": { "mana_detail_items": {}, "vmoney_detail_items": {} }
        })
    })
}

export default routes;