import { getFundReceiveListSync } from "../../nya/growthFund";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SessionType } from "../../data/types";
import { getClientSerializedData, serializePlayerData } from "../../data/utils";
import { cnManaNodeList, manaBoardAwakeSync, nodeAwakeLevelsSync, payPendingAwakeStagesSync } from "../../nya/manaAwake";
import { collectPlayerDataPooledExpSync, collectPlayerPooledExpSync, dailyResetPlayerDataSync, getAccountPlayers, getPlayerActiveMissionsSync, getPlayerBoxGachasSync, getPlayerCharactersManaNodesSync, getPlayerCharactersSync, getPlayerClearedRegularMissionListSync, getPlayerDailyChallengePointListSync, getPlayerDrawnQuestsSync, getPlayerEquipmentListSync, getPlayerGachaInfoListSync, getPlayerItemsSync, getPlayerMultiSpecialExchangeCampaignsSync, getPlayerOptionsSync, getPlayerPartyGroupListSync, getPlayerPeriodicRewardPointsSync, getPlayerQuestProgressSync, getPlayerStartDashExchangeCampaignsSync, getPlayerSync, getPlayerTriggeredTutorialsSync, getSession, updatePlayerSync } from "../../data/wdfpData";
import { generateDataHeaders } from "../../utils";
import { trackActiveMissionProgress } from "../../nya/activeMissionProgress";
import { progressPlayerMissionsSync } from "../../nya/mission";
import { prepareSoloAdventEventsSync } from "../../nya/soloAdvent";
import { getPendingLoginBonusSync, settleLoginBonusSync } from "../../nya/loginBonus";
import { refillBossBoostSync } from "../../nya/bossBoost";
import { freePullCopyEntriesSync, cnKnownFreePullEntries, refreshFreePullCopiesSync } from "../../nya/campaignSchedule";
import { refillPeriodicRewardPointsSync } from "../../nya/periodicReward";
import { catchUpQuestJoinUnitsSync } from "../../nya/storyJoin";
import { COUNTER_KINDS } from "../../lib/mission";
import { addCnLoadFields, isCnRequest } from "../../lib/cnClient";

interface LoadBody {
    app_secret: string,
    graphics_device_name: string,
    device_id: number,
    access_token: string,
    storage_directory_path: string,
    app_admin: string,
    kakao_pid: string,
    keychain: number,
    viewer_id: number,
    platform_os_version: string
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/load", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as LoadBody

        // the CN client has no Kakao token (zat): its viewer id (from /tool/signup) names the account
        const cn = isCnRequest(request.originalUrl)
        const zat = body.access_token
        let viewerId = cn ? (body.viewer_id || body.keychain) : body.viewer_id
        if ((!cn && !zat) || !viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const session = cn ? null : await getSession(zat)
        if (!cn && (session === null || session.type !== SessionType.ZAT)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid zat provided."
        })

        const viewerSession = await getSession(String(viewerId))
        if (viewerSession === null || viewerSession.type !== SessionType.VIEWER) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer ID provided."
        })

        const accountId = cn ? viewerSession.accountId : session!.accountId

        const playerIds = await getAccountPlayers(accountId)
        const playerId = playerIds[0]
        const player = !isNaN(playerId) ? getPlayerSync(playerId) : null

        if (player === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        // get last login time
        dailyResetPlayerDataSync(player)

        // collect the player's pooled exp
        collectPlayerDataPooledExpSync(player)

        // active missions: catch up on everything that can be worked out from the player's data, so a
        // character, equipment or party set up some other way (or an uploaded save) is counted at login
        trackActiveMissionProgress(playerId, { recompute: [4, 5, 8, 9, 21, 23, 34, 35, 36, 57, 58, 59, 61, 62, 66, 1096, 1048], refreshAllClear: true })

        // Mission screen: a login day (counted once per real day), then pay any cleared stages. The
        // new totals go out with the player data below.
        progressPlayerMissionsSync(playerId, [{ kind: COUNTER_KINDS.LOGIN_DAYS, amount: 1 }, { kind: COUNTER_KINDS.SOLO_AUTO_COMPLETE, amount: 1_000_000 }])

        // The Purge (no multiplayer here): open events' multiplayer-only battles count as cleared as
        // host, and the day's Empress ticket is given. Before the player data, so it goes out with it.
        prepareSoloAdventEventsSync(playerId)

        // Units that join on a story stage (unit 10 after 2-9-7, 213013 after 10-15-3): a save that
        // cleared the stage before they were given gets them now
        catchUpQuestJoinUnitsSync(playerId)

        // Daily login bonus: pay today's (once per real day), before the player data so the new
        // totals go out with it. The popup is listed until the client calls /bonus/shown.
        settleLoginBonusSync(playerId)

        // Boss Boost: back to 3 after the daily reset (once per real day), before the player data
        refillBossBoostSync(playerId)
        // Hard Multi "Daily Reward Count" points
        refillPeriodicRewardPointsSync(playerId)
        // yearly seasonal free pulls: back once a real day
        refreshFreePullCopiesSync(playerId)

        // CN unit awake missions: pay stages reached before their rewards were automatic
        if (cn) payPendingAwakeStagesSync(playerId)

        const clientData = getClientSerializedData(playerId, { viewerId: viewerId })
        if (clientData === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player data."
        })
        // CN node awakening: unlocked levels per unit, and each learned node's awake level
        if (cn) {
            const unlocked = manaBoardAwakeSync(playerId), awake = nodeAwakeLevelsSync(playerId)
            const chars = clientData.user_character_list as Record<string, any>
            for (const [id, entry] of Object.entries(chars)) entry.mana_board_awake = unlocked[id] ?? {}
            const nodes = clientData.user_character_mana_node_list as Record<string, any>
            for (const id of Object.keys(nodes)) nodes[id] = cnManaNodeList(nodes[id], awake[id])
        }
        // the yearly free pull copy running now (dashboard Campaigns tab) on every regular unit banner
        clientData.gacha_campaign_list = [...cnKnownFreePullEntries(clientData.gacha_campaign_list), ...freePullCopyEntriesSync(clientData.gacha_campaign_list)]
        const pendingLoginBonus = getPendingLoginBonusSync(playerId)
        if (pendingLoginBonus !== null) {
            clientData.bonus_index_list = pendingLoginBonus.bonus_index_list
            clientData.login_bonus_received_at = pendingLoginBonus.login_bonus_received_at
        }

        // the CN client also reads its own features' fields (all off or empty here)
        if (cn) {
            (clientData as Record<string, any>).fund_receive_list = getFundReceiveListSync(playerId)
            addCnLoadFields(clientData as Record<string, any>, request.headers.host ?? "127.0.0.1:8000")
        }

        reply.header("content-type", "application/x-msgpack")
        reply.status(200).send({
            "data_headers": generateDataHeaders({
                asset_update: true,
                viewer_id: viewerId
            }),
            "data": clientData
        })
    })
}

export default routes;