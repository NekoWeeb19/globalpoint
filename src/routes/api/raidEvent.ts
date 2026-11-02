// Handles Raid Event: Sagas of Conquest (/event/raid). There is no recorded global traffic for most of
// these; the request and reply shapes follow the Chinese StarPoint fork (src/routes/api/raidEvent.ts),
// whose other event endpoints match this server's. Each player has their own raid boss here.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAccountPlayers, getSession } from "../../data/wdfpData";
import { clientSerializeDate } from "../../data/utils";
import { getQuestFromCategorySync } from "../../lib/assets";
import { BattleQuest, QuestCategory } from "../../lib/types";
import { getRaidBossSync, getRaidPartyGroupListSync, getRaidQuestEventId, getRaidSummarySync } from "../../nya/raid";
import { generateDataHeaders, getServerDate } from "../../utils";
import { insertActiveQuest } from "./singleBattleQuest";
import { withMissionRewards } from "../../nya/mission";
import { raidMissionEvents } from "../../lib/mission";

interface EventIdBody {
    event_id: number,
    viewer_id: number,
    api_count: number
}

interface BattleStartBody {
    quest_id: number,
    party_group_id?: number,
    play_id: string,
    use_auto_start_point?: boolean,
    is_auto_start_mode: boolean,
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
    // opening the raid: the boss, kills per stage, and the kill-count rewards reached since last time
    fastify.post("/summary", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as EventIdBody
        const playerId = await resolvePlayer(body?.viewer_id, reply)
        if (playerId === null) return reply

        const summary = getRaidSummarySync(playerId, Number(body.event_id), clientSerializeDate(getServerDate()))
        if (summary === null) return reply.status(400).send({ "error": "Bad Request", "message": "Invalid raid event id." })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: body.viewer_id }),
            // event mission "Join the event": opening the raid counts
            "data": withMissionRewards(playerId, { ...summary, "mail_arrived": false }, raidMissionEvents(Number(body.event_id), "join"))
        })
    })

    fastify.post("/get_boss", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as EventIdBody
        const playerId = await resolvePlayer(body?.viewer_id, reply)
        if (playerId === null) return reply

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: body.viewer_id }),
            "data": {
                "raid_boss": getRaidBossSync(playerId, Number(body.event_id)) ?? { "hp_percentage": 100, "total_kill_count": 0 }
            }
        })
    })

    fastify.post("/party", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, api_count: number }
        const playerId = await resolvePlayer(body?.viewer_id, reply)
        if (playerId === null) return reply

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: body.viewer_id }),
            "data": { "user_party_group_list": getRaidPartyGroupListSync(playerId) }
        })
    })

    // raid battles start here, then finish through /single_battle_quest/finish
    fastify.post("/battle/start", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as BattleStartBody
        const playerId = await resolvePlayer(body?.viewer_id, reply)
        if (playerId === null) return reply

        const questId = Number(body.quest_id)
        const questData = getQuestFromCategorySync(QuestCategory.RAID_EVENT, questId) as BattleQuest | null
        if (questData === null || !("rankPointReward" in questData) || getRaidQuestEventId(questId) === null) return reply.status(400).send({
            "error": "Bad Request", "message": "Quest doesn't exist."
        })

        insertActiveQuest(playerId, {
            questId: questId,
            category: QuestCategory.RAID_EVENT,
            useBoostPoint: false,
            useBossBoostPoint: false,
            isAutoStartMode: body.is_auto_start_mode === true
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: body.viewer_id }),
            "data": {}
        })
    })
}

export default routes;
