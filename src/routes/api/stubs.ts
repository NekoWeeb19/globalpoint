// Handles endpoints whose real response is empty for a player with no bonus, social, or lounge data.
// The responses below match the recorded game traffic in docs/routes:
//   /bonus/shown      -> docs/routes/bonus_shown.md
//   /sns/get          -> docs/routes/sns_get.md
//   /follow/lists     -> docs/routes/follow_lists.md
//   /lounge/get_list  -> docs/routes/lounge_get_list.md
//   /story_movie/view -> empty (CN: a story replayed from the archives)
//
// These are registered at the API prefix itself (not their own prefix), so each path is written out in full.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAccountPlayers, getSession } from "../../data/wdfpData";
import { confirmLoginBonusShownSync } from "../../nya/loginBonus";
import { generateDataHeaders } from "../../utils";

interface ViewerBody {
    viewer_id: number
}

/**
 * Registers a POST route that checks the viewer's session and replies with a fixed `data` value.
 */
const registerStaticRoute = (fastify: FastifyInstance, path: string, data: Object | Object[], onCall?: (accountId: number) => Promise<void>) => {
    fastify.post(path, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ViewerBody | undefined

        const viewerId = body?.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        if (onCall) await onCall(viewerIdSession.accountId)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": data
        })
    })
}

const routes = async (fastify: FastifyInstance) => {
    // the login bonus popup was shown: stop listing it at /load (src/nya/loginBonus.ts)
    registerStaticRoute(fastify, "/bonus/shown", [], async accountId => {
        const playerId = (await getAccountPlayers(accountId))[0]
        if (!isNaN(playerId)) confirmLoginBonusShownSync(playerId)
    })
    registerStaticRoute(fastify, "/sns/get", [])
    registerStaticRoute(fastify, "/follow/lists", {
        "follow_info": [],
        "followed_count": 0
    })
    registerStaticRoute(fastify, "/lounge/get_list", {
        "lounge_list": []
    })
    // CN: a story replayed from the archives ({ quest_category, story_kind, story_id }); nothing to save
    registerStaticRoute(fastify, "/story_movie/view", {})
}

export default routes;
