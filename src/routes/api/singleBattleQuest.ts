import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { deletePlayerRushEventPlayedPartyListSync, getAccountPlayers, getPlayerRushEventSync, getPlayerSingleQuestProgressSync, getPlayerSync, getSession, insertPlayerQuestProgressSync, insertPlayerRushEventClearedFolderSync, insertPlayerRushEventPlayedPartySync, updatePlayerQuestProgressSync, updatePlayerRushEventSync, updatePlayerSync } from "../../data/wdfpData";
import { getQuestFromCategorySync, getRushEventFolderClearRewards } from "../../lib/assets";
import { getCharactersEvolutionImgLevels, givePlayerCharactersExpSync } from "../../lib/character";
import { questElement, givePlayerRewardsSync, givePlayerRewardSync, givePlayerScoreRewardsSync } from "../../lib/quest";
import { BattleQuest, EquipmentItemReward, PlayerRewardResult, QuestCategory, RewardType } from "../../lib/types";
import { generateDataHeaders, epochOf, getServerDate, getServerTime } from "../../utils";
import { rushEventFolderMaxRounds } from "./rushEvent";
import { RushEventBattleType, UserRushEventPlayedParty } from "../../data/types";
import { getSerializedPlayerRushEventPlayedPartiesSync } from "../../lib/rush";
import { givePlayerRankPoint } from "../../nya/player";
import { trackActiveMissionProgress } from "../../nya/activeMissionProgress";
import { ProgressTrigger } from "../../lib/activeMissionProgress";
import { manaAwakeData } from "../../nya/activeMissionData";
import { inCnRequest } from "../../lib/cnClient";
import { progressPlayerMissionsSync, questStaminaCost } from "../../nya/mission";
import { finishCarnivalBattleSync } from "../../nya/carnival";
import { finishRaidBattleSync } from "../../nya/raid";
import { refundEntryItemSync, spendEntryItemSync } from "../../nya/soloAdvent";
import { battleMissionEvents } from "../../lib/mission";
import { giveQuestJoinUnitsSync } from "../../nya/storyJoin";
import { spendBoostPoint } from "../../lib/bossBoost";
import { campaignRates, itemDropMultiplier, RewardCampaign } from "../../lib/rewardCampaign";
import rewardCampaignData from "../../../assets/reward_campaign.json";
import { rewardCampaignsFor } from "../../nya/cnCampaigns";
import eventDropData from "../../../assets/event_drops.json";
import cnEventDropData from "../../../assets/event_drops_cn.json";
import { EventDropData, eventDropItems, eventDrops } from "../../lib/eventDrops";
import { givePeriodicDropSync } from "../../nya/periodicReward";
import scoreAttackJson from "../../../assets/score_attack.json";
import { borderRewardItems, mainCharacterIds, newlyPassedBorders, ScoreAttackData, scoreAttackCleared, scoreAttackGrade } from "../../lib/scoreAttack";
import { recordScoreAttackBattleSync } from "../../nya/scoreAttack";
const scoreAttackData = scoreAttackJson as unknown as ScoreAttackData
const eventDropRules = eventDropData as unknown as EventDropData
// the CN client's own treasure hunts (CN's events, items and dates)
const cnEventDropRules = cnEventDropData as unknown as EventDropData

const rewardCampaigns = rewardCampaignData.campaigns as RewardCampaign[]
import { refillBossBoostSync } from "../../nya/bossBoost";

interface StartBody {
    quest_id: number
    use_boss_boost_point: boolean
    use_boost_point: boolean
    category: number
    viewer_id: number
    play_id: string
    is_auto_start_mode: boolean
    party_id: number
    api_count: number
}

interface QuestStatistics {
    clear_phase: number,
    party: {
        unison_characters: ({ id: (number | null) } | null)[],
        characters: ({ id: (number | null) } | null)[],
        equipments: ({ id: (number | null) } | null)[],
        ability_soul_ids: (number | null)[]
    }
}

export interface FinishBody {
    is_restored: boolean
    continue_count: number
    elapsed_time_ms: number
    quest_id: number
    category: number
    score: number
    viewer_id: number
    add_mana: number
    is_accomplished: boolean
    statistics: QuestStatistics
    api_count: number
}

interface PlayContinueBody {
    api_count: number,
    payment_type: number,
    quest_id: number,
    viewer_id: number,
    paly_id: string,
    category: number
}

interface AbortBody {
    api_count: number,
    finish_kind: number,
    statistics: QuestStatistics,
    viewer_id: number,
    quest_id: number,
    play_id: string,
    category: number
}

interface ReturnRushEvent {
    rush_battle_reward_list: {
        kind: number,
        kind_id: number,
        number: number
    }[],
    rush_battle_played_party_list: Record<number, UserRushEventPlayedParty> | null,
    endless_battle_played_party_list: Record<number, UserRushEventPlayedParty> | null,
    is_out_of_period: boolean
}

export interface ActiveQuest {
    questId: number,
    category: QuestCategory,
    useBossBoostPoint: boolean
    useBoostPoint: boolean
    isAutoStartMode: Boolean
    /** The entry ticket spent at the start (given back on abort). */
    entryItem?: { id: number, count: number }
    /** A co-op battle (/multi_battle_quest/start), hosted by the player: counts as multiplayer. */
    coop?: boolean
}

const continueVmoneyCost = 50;

const activeQuests: Record<number, ActiveQuest> = {}

export function insertActiveQuest(playerId: number, quest: ActiveQuest) {
    activeQuests[playerId] = quest
}

/** Marks the player's started battle as a co-op one (called by /multi_battle_quest/start). */
export function markActiveQuestCoop(playerId: number): boolean {
    const quest = activeQuests[playerId]
    if (quest === undefined) return false
    quest.coop = true
    return true
}

const routes = async (fastify: FastifyInstance) => {

    fastify.post("/finish", async (request: FastifyRequest, reply: FastifyReply) => {
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
        // Boss Boost refills at the daily reset (a battle may run past it), before the points are read
        if (!isNaN(playerId)) refillBossBoostSync(playerId)
        const playerData = !isNaN(playerId) ? getPlayerSync(playerId) : null

        if (playerData === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        // get active quest data
        const activeQuestData = activeQuests[playerId]
        if (activeQuestData === undefined) return reply.status(400).send({
            "error": "Bad Request",
            "message": "No active quest to finish."
        })

        // get quest data
        const questCategory = activeQuestData.category
        const questId = activeQuestData.questId
        const questData = getQuestFromCategorySync(questCategory, questId) as BattleQuest | null
        if (questData === null || !('rankPointReward' in questData)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Quest doesn't exist."
        })

        // delete the active quest data from global record
        delete activeQuests[playerId]

        // reward campaigns ("2x drops"...) running at the server date for this quest
        const campaign = campaignRates(rewardCampaignsFor(rewardCampaigns), getServerDate().getTime(), questCategory, questId)
        const rewardMana = Math.floor(questData.manaReward * campaign.mana)
        const rewardPoolExp = Math.floor(questData.poolExpReward * campaign.exp)
        if (campaign.ids.length > 0) console.log(`[campaign] Quest ${questId}: items x${campaign.items}, EXP x${campaign.exp}, mana x${campaign.mana} (campaigns ${campaign.ids.join(", ")}).`)

        // Score Attack: graded by score instead of time, and cleared once the score reaches the first border
        const scoreAttack = questCategory === QuestCategory.SCORE_ATTACK_EVENT ? scoreAttackData.quests[String(questId)] : undefined
        const scoreAttackBorders = scoreAttack === undefined ? [] : scoreAttackData.borders[String(questId)] ?? []

        // calculate clear rank
        const clearTime = body.elapsed_time_ms
        const clearRank = scoreAttack !== undefined ? scoreAttackGrade(scoreAttack.scores, body.score)
            : questData.sPlusRankTime >= clearTime ? 5
            : questData.sRankTime >= clearTime ? 4
                : questData.aRankTime >= clearTime ? 3
                    : questData.bRankTime >= clearTime ? 2
                        : 1


        // boost points: one is spent only when there is one (it used to go below 0); a boost doubles
        // the score drops (givePlayerScoreRewardsSync)
        const boost = spendBoostPoint(playerData.boostPoint, activeQuestData.useBoostPoint)
        const bossBoost = spendBoostPoint(playerData.bossBoostPoint, activeQuestData.useBossBoostPoint)
        let newBoostPoint = boost.points
        let newBossBoostPoint = bossBoost.points
        let useBoostPoint = boost.used || bossBoost.used

        // check current quest progress
        const questProgress = getPlayerSingleQuestProgressSync(playerId, questCategory, questId);
        const questPreviouslyCompleted = questProgress !== null
        const questAccomplished = scoreAttack !== undefined ? scoreAttackCleared(scoreAttackBorders, body.score) : body.is_accomplished

        // Score Attack: every battle goes into the event's history; the borders passed for the first
        // time pay their rewards (read before the new high score is saved below)
        let scoreAttackEvent: { main_character_ids: Record<number, number>, reward_ids: number[] } | null = null
        let scoreAttackRewards: PlayerRewardResult | null = null
        if (scoreAttack !== undefined) {
            recordScoreAttackBattleSync(playerId, scoreAttack.eventId, {
                categoryId: questCategory, questId, elapsedTimeMs: clearTime, score: body.score, clearRank,
                party: body.statistics?.party, zones: (body.statistics as { zones?: unknown } | undefined)?.zones,
            })
            const passed = questAccomplished ? newlyPassedBorders(scoreAttackBorders, questProgress?.highScore ?? 0, body.score) : []
            const items = borderRewardItems(passed)
            scoreAttackRewards = items.size > 0 ? givePlayerRewardsSync(playerId, [...items].map(([id, count]) => ({ type: RewardType.ITEM, id, count } as EquipmentItemReward))) : null
            scoreAttackEvent = { main_character_ids: mainCharacterIds(body.statistics?.party), reward_ids: passed.map(border => border.id) }
            console.log(`[score attack] Player ${playerId}: quest ${questId} score ${body.score}, grade ${clearRank}, ${passed.length} new border(s)${items.size > 0 ? ` -> ${[...items].map(([id, n]) => `${n}x ${id}`).join(", ")}` : ""}.`)
        }

        const clearReward = !questPreviouslyCompleted && questData.clearReward !== undefined ? givePlayerRewardSync(playerId, questData.clearReward) : null
        // units that join on this stage, on the first clear
        const joined = !questPreviouslyCompleted && questAccomplished ? giveQuestJoinUnitsSync(playerId, questCategory, questId) : { character_list: [], joined_character_id_list: [] }
        const sPlusClearReward = (clearRank === 5) && (questProgress?.clearRank !== 5) && (questData.sPlusReward !== undefined) ? givePlayerRewardSync(playerId, questData.sPlusReward) : null
        if (questAccomplished) {
            // update quest progress
            if (questPreviouslyCompleted) {
                // simply update the quest progress if it already exists.
                updatePlayerQuestProgressSync(playerId, questCategory, {
                    questId: questId,
                    finished: true,
                    bestElapsedTimeMs: questProgress.bestElapsedTimeMs === undefined || questProgress.bestElapsedTimeMs === null ? clearTime : Math.min(clearTime, questProgress.bestElapsedTimeMs),
                    clearRank: questProgress.clearRank === undefined ? clearRank : Math.max(clearRank, questProgress.clearRank),
                    highScore: questProgress.highScore === undefined ? body.score : Math.max(body.score, questProgress.highScore)
                })
            } else {
                // insert if it doesn't already exist.
                insertPlayerQuestProgressSync(playerId, questCategory, {
                    questId: questId,
                    finished: true,
                    bestElapsedTimeMs: clearTime,
                    clearRank: clearRank,
                    highScore: body.score
                })
            }
        }

        // active missions: a cleared quest (main, EX, boss, daily, Yuragi...) and a practice battle challenge
        const missionTrigger: ProgressTrigger = {}
        if (questAccomplished) {
            missionTrigger.quest = { category: questCategory, questId: questId }
            if (questCategory === QuestCategory.MAIN || questCategory === QuestCategory.EX) missionTrigger.recompute = [57, 66]
        }
        if (questCategory === QuestCategory.PRACTICE) missionTrigger.add = { 65: 1 }
        // CN unit awake missions: the party, knockouts, power flips and combo of this battle
        if (inCnRequest()) {
            const party = (body.statistics as any)?.party ?? {}
            const ids = (list: unknown) => Array.isArray(list) ? list.map((entry: any) => Number(entry?.id)).filter(id => Number.isSafeInteger(id) && id > 0) : []
            const mains = ids(party.characters), unisons = ids(party.unison_characters)
            const zones: any[] = Array.isArray((body.statistics as any)?.zones) ? (body.statistics as any).zones : []
            const sum = (field: string) => zones.reduce((total, zone) => total + (Number(zone?.[field]) || 0), 0)
            const units = manaAwakeData()?.units ?? {}
            missionTrigger.battle = {
                accomplished: questAccomplished === true,
                category: questCategory,
                questId: questId,
                isMulti: activeQuestData.coop === true,
                leaderId: mains[0] ?? null,
                memberIds: [...mains, ...unisons],
                races: [...new Set([...mains, ...unisons].flatMap(id => units[String(id)]?.races ?? []))],
                knockedOut: sum("encoffinment_count") > 0,
                clearTimeMs: Number(clearTime) || 0,
                powerFlips: sum("use_power_flip_count"),
                maxCombo: Number((body.statistics as any)?.max_combo_count) || 0,
            }
            if (questAccomplished) missionTrigger.add = { ...(missionTrigger.add ?? {}), 1002: rewardMana + (Number(body.add_mana) || 0) }
        }
        const activeMissionList = missionTrigger.quest !== undefined || missionTrigger.add !== undefined || missionTrigger.battle !== undefined
            ? trackActiveMissionProgress(playerId, missionTrigger)
            : []

        const beforeRankPoint = playerData.rankPoint
        const { rankPoint: newRankPoint, stamina: newStamina } = givePlayerRankPoint(playerData, questData.rankPointReward);
        // update player. Mana and exp are added to a fresh read: the first-clear and S+ rewards above
        // were already saved, and adding to playerData (read before them) overwrote them.
        const currentPlayer = getPlayerSync(playerId) ?? playerData
        updatePlayerSync({
            id: playerId,
            freeMana: currentPlayer.freeMana + rewardMana + body.add_mana,
            expPool: currentPlayer.expPool + rewardPoolExp,
            rankPoint: newRankPoint,
            stamina: newStamina,
            boostPoint: newBoostPoint,
            bossBoostPoint: newBossBoostPoint
        })

        // reward score rewards
        const scoreRewardsResult = givePlayerScoreRewardsSync(playerId, questData.scoreRewardGroupId, questData.scoreRewardGroup, useBoostPoint, campaign.items, questElement(questCategory, questId))

        // treasure hunt / collect item events: extra items for a cleared battle while one is open
        // (drop boosts and "more drops" campaigns count, like the score drops)
        const dropRules = inCnRequest() ? cnEventDropRules : eventDropRules
        const additionalDrops = questAccomplished
            ? eventDrops(dropRules, questCategory, questId, getServerDate().getTime(),
                (section, id) => getPlayerSingleQuestProgressSync(playerId, section, id)?.finished === true,
                itemDropMultiplier(campaign.items, useBoostPoint))
            : []
        const additionalItems = eventDropItems(dropRules, additionalDrops)
        const additionalResult = additionalItems.size > 0
            ? givePlayerRewardsSync(playerId, [...additionalItems].map(([id, count]) => ({ type: RewardType.ITEM, id, count } as EquipmentItemReward)))
            : null
        // Hard Multi: a cleared co-op battle spends one "Daily Reward Count" point for the event's bonus drop
        const periodicResult = questAccomplished && questCategory === QuestCategory.HARD_MULTI_EVENT && activeQuestData.coop === true
            ? givePeriodicDropSync(playerId, questId)
            : null

        if (additionalDrops.length > 0) console.log(`[event drops] Player ${playerId}: quest ${questCategory}/${questId} dropped ${[...additionalItems].map(([id, n]) => `${n}x ${id}`).join(", ")}.`)

        // reward character exp
        const bodyPartyStatistics = body.statistics.party
        const partyCharacterIds = [...bodyPartyStatistics.characters, ...bodyPartyStatistics.unison_characters]
        const partyCharacterIdsArray: number[] = []
        for (const value of partyCharacterIds.values()) {
            if (value !== null && value.id !== null) partyCharacterIdsArray.push(value.id);
        }
        const addExpAmount = Math.ceil(questData.characterExpReward * campaign.exp)

        const rewardCharacterExpResult = givePlayerCharactersExpSync(
            playerId,
            partyCharacterIdsArray,
            addExpAmount,
            questData.fixedParty !== undefined
        )

        const dataHeaders = generateDataHeaders({
            viewer_id: viewerId
        })

        // handle event quest-specific data & rewards
        let rushEventData: ReturnRushEvent | null = null
        let rushEventRewardsResult: PlayerRewardResult | null = null

        if (questCategory === QuestCategory.RUSH_EVENT) {
            // rush event

            const rushEventId = questData.rushEventId
            const rushEventFolderId = questData.rushEventFolderId
            const rushEventRound = questData.rushEventRound

            if (rushEventFolderId !== undefined && rushEventRound !== undefined && rushEventId !== undefined) {
                // update rush event data
                const rushEventBattleType = rushEventRound === 0 ? RushEventBattleType.ENDLESS : RushEventBattleType.FOLDER

                // map character ids
                const characterIds = bodyPartyStatistics.characters.map(val => val?.id ?? null)
                const unisonCharacterIds = bodyPartyStatistics.unison_characters.map(val => val?.id ?? null)

                // get evolution image levels
                const evolutionImgLevels: (number | null)[] = getCharactersEvolutionImgLevels(playerId, characterIds)
                const unisonEvolutionImgLevels: (number | null)[] = getCharactersEvolutionImgLevels(playerId, unisonCharacterIds)

                let round: number = questId

                // update endless battle stats
                if (rushEventBattleType === RushEventBattleType.ENDLESS) {
                    // get player rush event data
                    const playerRushEventData = getPlayerRushEventSync(playerId, rushEventId)

                    const playerNextRound = playerRushEventData?.endlessBattleNextRound ?? 1
                    const playerMaxRound = playerRushEventData?.endlessBattleMaxRound ?? 1
                    const playerBestClearTime = playerRushEventData?.endlessBattleMaxRoundTime ?? Number.MAX_SAFE_INTEGER
                    round = playerNextRound

                    if ((playerNextRound >= playerMaxRound && playerBestClearTime >= clearTime) || (playerNextRound > playerMaxRound)) {
                        updatePlayerRushEventSync(playerId, {
                            eventId: rushEventId,
                            endlessBattleMaxRound: playerNextRound,
                            endlessBattleMaxRoundTime: clearTime,
                            endlessBattleMaxRoundCharacterIds: characterIds,
                            endlessBattleMaxRoundCharacterEvolutionImgLvls: evolutionImgLevels
                        })
                    }

                } else if (rushEventBattleType === RushEventBattleType.FOLDER && (rushEventRound >= (rushEventFolderMaxRounds[rushEventFolderId] ?? 0))) {
                    // mark folder as complete since this is the final round
                    insertPlayerRushEventClearedFolderSync(playerId, rushEventId, rushEventFolderId)
                    // update the active folder value
                    updatePlayerRushEventSync(playerId, {
                        eventId: rushEventId,
                        activeRushBattleFolderId: null
                    })
                    // delete played parties
                    deletePlayerRushEventPlayedPartyListSync(playerId, rushEventId, rushEventBattleType)
                }

                // insert played party
                insertPlayerRushEventPlayedPartySync(playerId, rushEventId, {
                    characterIds: characterIds,
                    unisonCharacterIds: unisonCharacterIds,
                    equipmentIds: bodyPartyStatistics.equipments.map(val => val?.id ?? null),
                    abilitySoulIds: bodyPartyStatistics.ability_soul_ids,
                    evolutionImgLevels: evolutionImgLevels,
                    unisonEvolutionImgLevels: unisonEvolutionImgLevels,
                    battleType: rushEventBattleType,
                    round: round
                })

                // get serialized parties
                const serializedPlayedParties = getSerializedPlayerRushEventPlayedPartiesSync(playerId, rushEventId)

                // set rush event data
                rushEventData = {
                    "rush_battle_reward_list": [],
                    "rush_battle_played_party_list": serializedPlayedParties.folderParties,
                    "endless_battle_played_party_list": serializedPlayedParties.endlessParties,
                    "is_out_of_period": false
                }

                // give rewards if allowed
                if (rushEventRound >= (rushEventFolderMaxRounds[rushEventFolderId] ?? 0)) {
                    const rewards = getRushEventFolderClearRewards(rushEventId, rushEventFolderId) ?? []
                    rushEventRewardsResult = givePlayerRewardsSync(playerId, rewards)

                    rushEventData.rush_battle_reward_list = rewards.map(reward => {
                        const itemReward = reward as EquipmentItemReward
                        return {
                            "kind": 1,
                            "kind_id": itemReward.id,
                            "number": itemReward.count
                        }
                    })
                }
            }
        }

        // Raid Event: a cleared raid stage hurts the player's raid boss (rewards are paid at /event/raid/summary)
        const raidEventData = questAccomplished && questCategory === QuestCategory.RAID_EVENT
            ? finishRaidBattleSync(playerId, questId, {
                characterIds: bodyPartyStatistics.characters.map(value => value?.id ?? null),
                unisonCharacterIds: bodyPartyStatistics.unison_characters.map(value => value?.id ?? null),
                equipmentIds: bodyPartyStatistics.equipments.map(value => value?.id ?? null),
                abilitySoulIds: bodyPartyStatistics.ability_soul_ids ?? [null, null, null],
            })
            : null

        // Hanifolk Carnival: save the folder's score and pay the total-score rewards reached
        const carnivalResult = questAccomplished && questCategory === QuestCategory.CARNIVAL_EVENT
            ? finishCarnivalBattleSync(
                playerId,
                questId,
                clearTime,
                bodyPartyStatistics.characters.map(value => value?.id ?? null),
                bodyPartyStatistics.unison_characters.map(value => value?.id ?? null)
            )
            : null

        // Mission screen: clears (solo, Kaleidoscope...) and in-battle actions (dashes, combo, skills,
        // mana...), then pay any cleared stages. This runs after every save above, so the mission
        // rewards aren't overwritten.
        const missionRewards = progressPlayerMissionsSync(playerId, battleMissionEvents({
            accomplished: questAccomplished === true,
            // co-op battles are always hosted by the player, with COM partners
            isMulti: activeQuestData.coop === true,
            isHost: activeQuestData.coop === true,
            guestStandIn: activeQuestData.coop === true,
            questCategory: questCategory,
            questId: questId,
            clearRank: clearRank,
            score: body.score,
            questMana: rewardMana,
            fieldMana: body.add_mana,
            statistics: body.statistics,
            clearTimeMs: clearTime,
            staminaCost: questStaminaCost(questCategory, questId),
        }))

        // the player's totals after everything above was saved (rewards, drops, overflow exp, missions).
        // Adding the pieces by hand counted the score exp twice and showed lost clear rewards.
        const finalPlayer = getPlayerSync(playerId) ?? playerData

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": dataHeaders,
            "data": {
                ...(missionRewards.mission_info.length > 0 ? { "mission_info": missionRewards.mission_info } : {}),
                "user_info": {
                    "free_mana": finalPlayer.freeMana,
                    "exp_pool": finalPlayer.expPool,
                    "exp_pooled_time": epochOf(playerData.expPooledTime),
                    "free_vmoney": finalPlayer.freeVmoney,
                    "rank_point": newRankPoint,
                    "stamina": newStamina,
                    "stamina_heal_time": getServerTime(playerData.staminaHealTime),
                    "boost_point": newBoostPoint,
                    "boss_boost_point": newBossBoostPoint
                },
                "add_exp_list": rewardCharacterExpResult.add_exp_list,
                "character_list": [
                    ...rewardCharacterExpResult.character_list,
                    ...(clearReward?.character_list || []),
                    ...(sPlusClearReward?.character_list || []),
                    ...joined.character_list,
                    ...scoreRewardsResult.character_list,
                    ...(carnivalResult?.character_list ?? []),
                    ...missionRewards.character_list
                ],
                "bond_token_status_list": rewardCharacterExpResult.bond_token_status_list,
                "rewards": {
                    "overflow_pool_exp": 0,
                    "converted_pool_exp": 0,
                    "reward_pool_exp": rewardPoolExp,
                    "reward_mana": rewardMana,
                    "field_mana": body.add_mana
                },
                "old_high_score": questProgress === null ? 0 : questProgress.highScore || 0,
                "joined_character_id_list": [
                    ...(clearReward?.joined_character_id_list || []),
                    ...(sPlusClearReward?.joined_character_id_list || []),
                    ...joined.joined_character_id_list,
                    ...scoreRewardsResult.joined_character_id_list
                ],
                "before_rank_point": beforeRankPoint,
                "clear_rank": clearRank,
                "drop_score_reward_ids": scoreRewardsResult.drop_score_reward_ids,
                "drop_rare_reward_ids": scoreRewardsResult.drop_rare_reward_ids,
                "drop_additional_reward_ids": additionalDrops,
                "drop_periodic_reward_ids": periodicResult?.drops ?? [],
                ...(periodicResult !== null ? { "user_periodic_reward_point_list": periodicResult.points } : {}),
                "equipment_list": [...scoreRewardsResult.equipment_list, ...(carnivalResult?.equipment_list ?? []), ...missionRewards.equipment_list],
                "category_id": questCategory,
                "start_time": dataHeaders['servertime'],
                "is_multi": "single",
                "quest_name": "",
                "item_list": {
                    ...scoreRewardsResult.items,
                    ...(additionalResult?.items ?? {}),
                    ...(scoreAttackRewards?.items ?? {}),
                    ...(periodicResult?.items ?? {}),
                    ...(rushEventRewardsResult?.items ?? {}),
                    ...(carnivalResult?.item_list ?? {}),
                    // mission totals are read last, so they win over older totals of the same item
                    ...missionRewards.item_list
                },
                "rush_event": rushEventData,
                ...(carnivalResult !== null ? { "carnival_event": carnivalResult.carnivalEvent } : {}),
                ...(raidEventData !== null ? { "raid_event": raidEventData } : {}),
                ...(scoreAttackEvent !== null ? { "score_attack_event": scoreAttackEvent } : {}),
                ...(activeMissionList.length > 0 ? { "active_mission_list": activeMissionList } : {})
            }
        })
    })

    fastify.post("/abort", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as AbortBody

        const viewerId = body.viewer_id
        if (isNaN(viewerId)) return reply.status(400).send({
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

        if (isNaN(playerId)) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        const headers = generateDataHeaders({ viewer_id: body.viewer_id })

        // delete existing active quest, giving back its entry ticket
        const abortedQuest = activeQuests[playerId]
        const refundedTotal = abortedQuest?.entryItem ? refundEntryItemSync(playerId, abortedQuest.entryItem) : null
        delete activeQuests[playerId]

        // the recorded global reply is msgpack like every other one (this header was missing, so the
        // reply went out as plain JSON)
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": headers,
            "data": {
                "user_info": {},
                ...(refundedTotal !== null && abortedQuest?.entryItem ? { "item_list": { [String(abortedQuest.entryItem.id)]: refundedTotal } } : {}),
                "category_id": body.category,
                "is_multi": "single",
                "start_time": headers['servertime'],
                "quest_name": ""
            }
        })
    })

    fastify.post("/start", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as StartBody

        const viewerId = body.viewer_id
        const partyId = body.party_id
        const questId = body.quest_id
        const category = body.category
        const useBoostPoint = body.use_boost_point
        const useBossBoostPoint = body.use_boss_boost_point
        const isAutoStartMode = body.is_auto_start_mode
        if (isNaN(viewerId) || isNaN(partyId) || isNaN(questId) || isNaN(category) || useBoostPoint === undefined || useBossBoostPoint === undefined || isAutoStartMode === undefined) return reply.status(400).send({
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

        if (isNaN(playerId)) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        // get quest data
        const questData = getQuestFromCategorySync(category, questId) as BattleQuest | null
        if (questData === null || !('rankPointReward' in questData)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Quest doesn't exist."
        })


        // an unfinished earlier battle gives its ticket back before this one starts
        const previousQuest = activeQuests[playerId]
        if (previousQuest?.entryItem) refundEntryItemSync(playerId, previousQuest.entryItem)
        delete activeQuests[playerId]

        // battles with an entry ticket (The Purge's Empress) spend it on every attempt
        const entryItem = spendEntryItemSync(playerId, questId)
        if (entryItem === "missing") return reply.status(400).send({
            "error": "Bad Request",
            "message": "Not enough tickets to start this quest."
        })

        // add to active quests table
        activeQuests[playerId] = {
            questId: questId,
            category: category,
            useBoostPoint: useBoostPoint,
            useBossBoostPoint: useBossBoostPoint,
            isAutoStartMode: isAutoStartMode,
            ...(entryItem !== null ? { entryItem: { id: entryItem.id, count: entryItem.count } } : {})
        }

        // update player last quest id
        if (questData.fixedParty === undefined) {
            updatePlayerSync({
                id: playerId,
                partySlot: partyId
            })
        }

        const dataHeaders = generateDataHeaders({
            viewer_id: viewerId
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": dataHeaders,
            "data": {
                "user_info": {
                    "last_main_quest_id": body.quest_id
                },
                // the ticket's new total, as the recorded global start reply reports an entry item
                ...(entryItem !== null ? { "item_list": { [String(entryItem.id)]: entryItem.total } } : {}),
                "category_id": body.category,
                "is_multi": "single",
                "start_time": dataHeaders['servertime'],
                "quest_name": ""
            }
        })
    })

    fastify.post("/play_continue", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as PlayContinueBody

        const viewerId = body.viewer_id
        if (isNaN(viewerId)) return reply.status(400).send({
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
        const player = isNaN(playerId) ? null : getPlayerSync(playerId)

        if (player === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        // get active quest data
        const activeQuestData = activeQuests[playerId]
        if (activeQuestData === undefined) return reply.status(400).send({
            "error": "Bad Request",
            "message": "No active quest to continue."
        })

        const freeVmoney = player.freeVmoney
        const newFreeVmoney = freeVmoney - continueVmoneyCost
        const vmoney = player.vmoney
        const newVmoney = 0 > newFreeVmoney ? vmoney - continueVmoneyCost : vmoney
        if (0 > newFreeVmoney && 0 > newVmoney) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Not enough vmoney to continue"
        })

        // update the player's vmoney balances
        const setNewFreeVmoney = 0 > newFreeVmoney ? freeVmoney : newFreeVmoney
        updatePlayerSync({
            id: playerId,
            freeVmoney: setNewFreeVmoney,
            vmoney: newVmoney
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "user_info": {
                    "free_vmoney": setNewFreeVmoney,
                    "vmoney": newVmoney
                },
                "mail_arrived": false
            }
        })

    })
}

export default routes;