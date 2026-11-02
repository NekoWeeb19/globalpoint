import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAccountPlayers, getPlayerSingleQuestProgressSync, getPlayerSync, getSession, insertPlayerQuestProgressSync, updatePlayerQuestProgressSync } from "../../data/wdfpData";
import { getQuestFromCategorySync } from "../../lib/assets";
import { givePlayerRewardSync } from "../../lib/quest";
import { generateDataHeaders, epochOf, getServerTime } from "../../utils";
import { QuestCategory } from "../../lib/types";
import { trackActiveMissionProgress } from "../../nya/activeMissionProgress";
import { progressPlayerMissionsSync } from "../../nya/mission";
import { emptyMissionRewardResult } from "../../lib/mission";
import { giveQuestJoinUnitsSync } from "../../nya/storyJoin";

interface FinishBody {
    party_id: number,
    quest_id: number,
    viewer_id: number,
    category: number,
    api_count: number
}

const routes = async (fastify: FastifyInstance) => {
    // the CN client sends /finish_with_skip when a story is skipped from its summary; same request
    for (const route of ["/finish", "/finish_with_skip"]) fastify.post(route, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as FinishBody

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

        // get player
        const playerIds = await getAccountPlayers(viewerIdSession.accountId)
        const playerId = playerIds[0]
        const playerData = !isNaN(playerId) ? getPlayerSync(playerId) : null

        if (playerData === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        const questSection = body.category
        const questId = body.quest_id

        // get quest data & check if it is the right type
        const questData = getQuestFromCategorySync(questSection, questId)
        if (questData === null || ("sPlusReward" in questData)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid quest ID provided."
        })

        // get quest progress
        const questProgress = getPlayerSingleQuestProgressSync(playerId, questSection, questId);
        const finished = questProgress !== null ? questProgress.finished : false
        const rewardResult = !finished && questData.clearReward !== undefined ? givePlayerRewardSync(playerId, questData.clearReward) : null
        // units that join on this stage (e.g. unit 10 after 2-9-7), on the first clear
        const joined = !finished ? giveQuestJoinUnitsSync(playerId, questSection, questId) : { character_list: [], joined_character_id_list: [] }

        if (!finished) {
            // update quest progress
            if (questProgress === null) {
                // insert if it doesn't already exist.
                insertPlayerQuestProgressSync(playerId, questSection, {
                    questId: questId,
                    finished: true
                })
            } else {
                // simply update the quest progress if it already exists.
                updatePlayerQuestProgressSync(playerId, questSection, {
                    questId: questId,
                    finished: true
                })
            }
        }
        // active missions: a character story was finished, or a main/EX quest (the chapter missions count those)
        const activeMissionList = !finished ? trackActiveMissionProgress(playerId, {
            recompute: [21, 1096, ...(questSection === QuestCategory.MAIN || questSection === QuestCategory.EX ? [57] : [])]
        }) : []

        // Mission screen: pay any cleared stages (e.g. "read N unit episodes"), as the recorded reply did
        const missionRewards = !finished ? progressPlayerMissionsSync(playerId) : emptyMissionRewardResult()
        const missionExpChanged = missionRewards.added.exp_pool > 0

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": !finished ? {
                ...(missionRewards.mission_info.length > 0 ? { "mission_info": missionRewards.mission_info } : {}),
                "user_info": {
                    "free_vmoney": playerData.freeVmoney + (rewardResult?.user_info.free_vmoney || 0) + missionRewards.added.free_vmoney,
                    "free_mana": playerData.freeMana + (rewardResult?.user_info.free_mana || 0) + missionRewards.added.free_mana,
                    ...(missionExpChanged ? {
                        "exp_pool": playerData.expPool + missionRewards.added.exp_pool,
                        "exp_pooled_time": epochOf(playerData.expPooledTime)
                    } : {})
                },
                "character_list": [...(rewardResult?.character_list || []), ...joined.character_list, ...missionRewards.character_list],
                "joined_character_id_list": [...(rewardResult?.joined_character_id_list || []), ...joined.joined_character_id_list],
                "equipment_list": [...(rewardResult?.equipment_list || []), ...missionRewards.equipment_list],
                "items": rewardResult?.items || {},
                ...(Object.keys(missionRewards.item_list).length > 0 ? { "item_list": missionRewards.item_list } : {}),
                ...(activeMissionList.length > 0 ? { "active_mission_list": activeMissionList } : {})
            } : [],
            
        })
    })
}

export default routes;
