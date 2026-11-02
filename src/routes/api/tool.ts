import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SessionType } from "../../data/types";
import { deleteAccountSync, generateViewerIdSession, getAccount, getAccountSessionsOfType, getPlayerFromAccountIdSync, getSession, insertDefaultPlayerSync } from "../../data/wdfpData";
import { generateDataHeaders } from "../../utils";
import { isCnRequest } from "../../lib/cnClient";
import { cnSignup } from "./cn";
import { chosenAccount } from "../../nya/activeAccounts";

interface GetHeaderResponseBody {
    viewer_id: number
}

interface SignupBody {
    app_secret: string
    access_token: string
    storage_directory_path: string
    app_admin: string
    kakao_pid: string,
    device_id: number,
    idp_code: string
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/get_header_response", (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GetHeaderResponseBody

        reply.header("content-type", "application/x-msgpack")

        reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: body.viewer_id
            }),
            "data": []
        })
    })

    // "Unregister" a guest in the game's settings: deletes the account and all of its save data.
    // Request (seen from the game): { idp_code: "Guest", retry_count, api_count, viewer_id }.
    // The game then starts again as a brand-new guest.
    fastify.post("/unregister", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, idp_code?: string, api_count?: number }

        const viewerId = body?.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession || viewerIdSession.type !== SessionType.VIEWER) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        const accountId = viewerIdSession.accountId
        const deletedPlayers = deleteAccountSync(accountId)
        console.log(`[unregister] Account ${accountId} (viewer ${viewerId}) deleted with player(s) ${deletedPlayers.join(", ") || "none"}.`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": []
        })
    })

    fastify.post("/signup", async (request: FastifyRequest, reply: FastifyReply) => {
        // the CN client signs up without a Kakao token (src/routes/api/cn.ts)
        if (isCnRequest(request.originalUrl)) return cnSignup(request, reply)
        const body = request.body as SignupBody
        
        const zat = body.access_token
        if (!zat) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const udid = request.headers['udid']
        if (!udid) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid headers."
        })

        const session = await getSession(zat)
        if (session === null || session.type !== SessionType.ZAT) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid zat provided."
        })

        // the dashboard's Players tab can switch the global app to another account
        const chosen = chosenAccount("global")
        const accountId = chosen != null && await getAccount(chosen) !== null ? chosen : session.accountId
        if (accountId !== session.accountId) console.log(`[active account] global sign-in of account ${session.accountId} plays on account ${accountId}`)

        // Create the player data if it doesn't exist.
        const accountPlayer = getPlayerFromAccountIdSync(accountId)
        if (accountPlayer === null) {    
            // create new player account
            insertDefaultPlayerSync(accountId)
        }

        // generate viewer id
        const viewerIds = await getAccountSessionsOfType(accountId, SessionType.VIEWER)
        const viewerId = !viewerIds[0] ? await generateViewerIdSession(accountId) : viewerIds[0]

        reply.header("content-type", "application/x-msgpack")
        reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: Number.parseInt(viewerId.token),
                udid: String(udid)
            }, ['short_udid', 'viewer_id', 'udid', 'servertime', 'result_code']),
            "data": []
        })
    })
}

export default routes;