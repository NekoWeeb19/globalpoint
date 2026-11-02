// The CN client's pass screen ("The Way of Practice", src/nya/passCard.ts): Pass_card/get_pass_card
// (points, premium, taken rewards) and Pass_card/receive_all (take unlocked rewards). Reply shapes from
// the CN 1.8.1 client (pinball.remote.passCard) and the Chinese fork (routes/api/passCard.ts).
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import getDatabase, { Database } from "../../data";
import { generateDataHeaders } from "../../utils";
import { ClientError, viewer_id_to_player_id } from "../../nya/utils";
import { getPassDefinition, getPassPointSync, getPassRewardDefinition, getPassRewardRecordsSync, markPassRewardReceivedSync } from "../../nya/passCard";
import { payRewardListSync } from "../../nya/mission";
import type { MissionReward } from "../../lib/mission";

interface PassCardBody {
    viewer_id: number
    pass_card_id: number
    /** reward ids to take both rewards of, only the free one, only the premium one */
    all_receive?: number[]
    reward1_receive?: number[]
    reward2_receive?: number[]
}

function send(reply: FastifyReply, viewerId: number, data: object) {
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({ data_headers: generateDataHeaders({ viewer_id: viewerId }), data })
}
const bad = (reply: FastifyReply, message: string) => reply.status(400).send({ error: "Bad Request", message })

async function playerOf(body: PassCardBody, reply: FastifyReply): Promise<number | null> {
    if (!Number.isSafeInteger(body?.pass_card_id) || getPassDefinition(body.pass_card_id) === null) { bad(reply, "Unknown pass."); return null }
    try {
        return await viewer_id_to_player_id(body.viewer_id)
    } catch (e) {
        if (e instanceof ClientError) { bad(reply, e.message); return null }
        throw e
    }
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/get_pass_card", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as PassCardBody
        const playerId = await playerOf(body, reply)
        if (playerId === null) return
        return send(reply, body.viewer_id, {
            point: getPassPointSync(playerId, body.pass_card_id),
            is_buy: true, // the premium track is open to everyone
            all_received_record: getPassRewardRecordsSync(playerId, body.pass_card_id),
        })
    })

    fastify.post("/receive_all", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as PassCardBody
        const playerId = await playerOf(body, reply)
        if (playerId === null) return
        const passId = body.pass_card_id
        const pass = getPassDefinition(passId)!
        const level = Math.floor(getPassPointSync(playerId, passId) / Math.max(1, pass.levelPoints))

        // reward id -> which rewards to take
        const wanted = new Map<number, { free: boolean, premium: boolean }>()
        const add = (ids: unknown, free: boolean, premium: boolean) => {
            if (!Array.isArray(ids)) return
            for (const id of ids) {
                if (!Number.isSafeInteger(id)) continue
                const w = wanted.get(id) ?? { free: false, premium: false }
                wanted.set(id, { free: w.free || free, premium: w.premium || premium })
            }
        }
        add(body.all_receive, true, true)
        add(body.reward1_receive, true, false)
        add(body.reward2_receive, false, true)

        const taken = new Map(getPassRewardRecordsSync(playerId, passId).map(r => [r.reward_id, r]))
        const rewards: MissionReward[] = []
        const marks: [number, boolean, boolean][] = []
        for (const [rewardId, w] of wanted) {
            const definition = getPassRewardDefinition(rewardId)
            if (definition === null || definition.pass !== passId || definition.level > level) continue
            const free = w.free && definition.free !== null && taken.get(rewardId)?.is_received_1 !== 1
            const premium = w.premium && definition.premium !== null && taken.get(rewardId)?.is_received_2 !== 1
            if (free) rewards.push(definition.free!)
            if (premium) rewards.push(definition.premium!)
            if (free || premium) marks.push([rewardId, free, premium])
        }

        const paid = getDatabase(Database.WDFP_DATA).transaction(() => {
            const result = payRewardListSync(playerId, rewards, "pass")
            for (const [rewardId, free, premium] of marks) markPassRewardReceivedSync(playerId, passId, rewardId, free, premium)
            return result
        })()
        if (marks.length > 0) console.log(`[pass] Player ${playerId} took ${marks.length} reward(s) of pass ${passId}.`)
        return send(reply, body.viewer_id, {
            all_received_record: getPassRewardRecordsSync(playerId, passId),
            item_list: paid.item_list,
            character_list: paid.character_list,
            equipment_list: paid.equipment_list,
            ...(Object.keys(paid.user_info).length > 0 ? { user_info: paid.user_info } : {}),
            degree_list: paid.new_degree_ids.map(degreeId => ({ viewer_id: body.viewer_id, degree_id: degreeId })),
            mail_arrived: false,
        })
    })
}

export default routes;
