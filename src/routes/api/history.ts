// history/receive: the Item Log (src/nya/receiveHistory.ts).
// history/score_attack_event_battle: the Score Attack battles of an event, newest first
// (src/nya/scoreAttack.ts). Not recorded on global: the request ({ event_id }) and the reply
// (data.history[i].*) are the global client's own, and the Chinese fork answers the same way
// (routes/api/history.ts).

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import scoreAttackJson from "../../../assets/score_attack.json"
import { getAccountPlayers, getPlayerSync, getSession } from "../../data/wdfpData";
import { generateDataHeaders } from "../../utils";
import { ScoreAttackData } from "../../lib/scoreAttack";
import { getScoreAttackHistorySync } from "../../nya/scoreAttack";
import { receiveHistoryPageSync } from "../../nya/receiveHistory";

const scoreAttackData = scoreAttackJson as unknown as ScoreAttackData
const scoreAttackEvents = new Set(Object.values(scoreAttackData.quests).map(quest => quest.eventId))

const bad = (reply: FastifyReply, message = "Invalid request body.") => reply.status(400).send({ "error": "Bad Request", "message": message })

/** The viewer's player id, or null. */
async function viewerPlayer(viewerId: unknown): Promise<number | null> {
    if (!viewerId || isNaN(Number(viewerId))) return null
    const session = await getSession(String(viewerId))
    if (!session) return null
    const playerId = (await getAccountPlayers(session.accountId))[0]
    return playerId === undefined || isNaN(playerId) || getPlayerSync(playerId) === null ? null : playerId
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/score_attack_event_battle", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, event_id: unknown }
        const playerId = await viewerPlayer(body?.viewer_id)
        const eventId = body?.event_id
        if (playerId === null || typeof eventId !== "number" || !scoreAttackEvents.has(eventId)) return bad(reply)
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: body.viewer_id }),
            "data": { "history": getScoreAttackHistorySync(playerId, eventId) },
        })
    })

    // the Item Log: gifts claimed and units/weapons summoned (src/nya/receiveHistory.ts).
    // Request { page } (from 1), reply { history, total_count }.
    fastify.post("/receive", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, page?: unknown }
        const playerId = await viewerPlayer(body?.viewer_id)
        if (playerId === null) return bad(reply)
        const page = Number.isSafeInteger(body.page) && (body.page as number) > 0 ? body.page as number : 1
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: body.viewer_id }),
            "data": receiveHistoryPageSync(playerId, page),
        })
    })
}

export default routes;
