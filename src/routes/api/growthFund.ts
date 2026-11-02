// The CN client's Growth Fund claim (growth_fund/receive_fund_bonus { bonus_ids }), see
// src/nya/growthFund.ts. Each asked reward is paid once its goal is reached (rank, or the chapter's
// last quest cleared); the reply carries the new fund_receive_list and what was paid.
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import getDatabase, { Database } from "../../data";
import { getPlayerQuestProgressSync, getPlayerSync } from "../../data/wdfpData";
import { generateDataHeaders } from "../../utils";
import { ClientError, viewer_id_to_player_id } from "../../nya/utils";
import { fundBonuses, getFundReceiveListSync, markFundReceivedSync } from "../../nya/growthFund";
import { payRewardListSync } from "../../nya/mission";
import { getRankByPt } from "../../nya/player";
import { QuestCategory } from "../../lib/types";
import type { MissionReward } from "../../lib/mission";

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/receive_fund_bonus", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, bonus_ids?: unknown }
        let playerId: number
        try {
            playerId = await viewer_id_to_player_id(body.viewer_id)
        } catch (e) {
            if (e instanceof ClientError) return reply.status(400).send({ error: "Bad Request", message: e.message })
            throw e
        }
        const player = getPlayerSync(playerId)
        if (player === null) return reply.status(400).send({ error: "Bad Request", message: "No player." })
        const rank = getRankByPt(player.rankPoint)?.rank ?? 0
        const progress = getPlayerQuestProgressSync(playerId)
        const cleared = (category: QuestCategory, questId: number) =>
            (progress[String(category)] ?? []).some(q => q.questId === questId && q.finished)

        const bonuses = fundBonuses()
        const taken = new Set(getFundReceiveListSync(playerId))
        const rewards: MissionReward[] = []
        const paidIds: number[] = []
        for (const raw of Array.isArray(body.bonus_ids) ? body.bonus_ids : []) {
            const id = Number(raw)
            const bonus = bonuses[String(id)]
            if (bonus === undefined || taken.has(id)) continue
            const reached = bonus.kind === 0 ? rank >= bonus.goal
                : cleared(bonus.kind === 1 ? QuestCategory.MAIN : QuestCategory.EX, bonus.goal)
            if (!reached) continue
            rewards.push(...bonus.rewards)
            paidIds.push(id)
            taken.add(id)
        }
        const paid = getDatabase(Database.WDFP_DATA).transaction(() => {
            const result = payRewardListSync(playerId, rewards, "growth fund")
            for (const id of paidIds) markFundReceivedSync(playerId, id)
            return result
        })()
        if (paidIds.length > 0) console.log(`[growth fund] Player ${playerId} took ${paidIds.join(", ")}.`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: body.viewer_id }),
            data: {
                fund_receive_list: [...taken].sort((a, b) => a - b),
                item_list: paid.item_list,
                ...(Object.keys(paid.user_info).length > 0 ? { user_info: paid.user_info } : {}),
                mail_arrived: false,
            },
        })
    })
}

export default routes;
