// Connects src/lib/activeMissionProgress.ts to the real database. Handlers call
// trackActiveMissionProgress() after something that can raise a mission's progress, and put the
// result in the reply's `active_mission_list`.

import { activeMissionDataFor, manaAwakeData } from "./activeMissionData"
import { claimPlayerActiveMissionsSync } from "./activeMission"
import { questInRangeQuery } from "../lib/mission"
import mainQuests from "../../assets/main_quest.json"
import exQuests from "../../assets/ex_quest.json"
import getDatabase, { Database } from "../data"
import {
    getPlayerActiveMissionsSync,
    getPlayerCharactersManaNodesSync,
    getPlayerCharactersSync,
    getPlayerEquipmentListSync,
    getPlayerPartyGroupListSync,
    getPlayerQuestProgressSync
} from "../data/wdfpData"
import { getCharacterDataSync, getCharacterManaNodesSync } from "../lib/assets"
import { expCapsForRequest } from "../lib/character"
import { QuestCategory } from "../lib/types"
import { PartyCategory } from "../data/types"
import {
    ActiveMissionDelta,
    ActiveMissionProgressData,
    ProgressFacts,
    ProgressStore,
    ProgressTrigger,
    SavedMission,
    estimateCharacterLevel,
    updateActiveMissionProgress
} from "../lib/activeMissionProgress"

/** The mana node slots that hold abilities (the others hold stat boosts). */
const ABILITY_SLOTS = new Set(["1", "2", "3"])

/** The number of filled (not empty) slots in a list of party slots. */
const filledSlots = (slots: (number | null)[]) => slots.filter(slot => slot !== null && slot !== undefined && slot !== 0).length

/** Adds up the filled slots of one kind over all of the player's parties. */
function countPartySlots(playerId: number, kind: "equipmentIds" | "unisonCharacterIds" | "abilitySoulIds"): number {
    let total = 0
    for (const category of [PartyCategory.NORMAL, PartyCategory.EVENT]) {
        for (const group of Object.values(getPlayerPartyGroupListSync(playerId, category))) {
            for (const party of Object.values(group.list)) total += filledSlots(party[kind])
        }
    }
    return total
}

/** The quests of the categories that "clear everything with S+" missions look at, by category. */
const QUEST_ASSETS: Record<number, Record<string, object>> = {
    [QuestCategory.MAIN]: mainQuests,
    [QuestCategory.EX]: exQuests
}

/** A quest is a battle (it has a clear rank) when its data has battle rewards; the others are only story. */
const isBattleQuest = (quest: object) => "rankPointReward" in quest

/** A bond token with this status has been received (1 = ready to receive, 2 = received). */
const BOND_TOKEN_RECEIVED = 2

/**
 * Raises the progress of the player's active missions after something they did.
 *
 * It never throws: tracking missions must not make the action itself fail, so an error is logged
 * and nothing is reported.
 *
 * @returns What changed, for the reply's `active_mission_list`. Empty if nothing did.
 */
export function trackActiveMissionProgress(playerId: number, trigger: ProgressTrigger): ActiveMissionDelta[] {
    try {
        const db = getDatabase(Database.WDFP_DATA)

        const store: ProgressStore = {
            getMissions: () => {
                const missions: Record<string, SavedMission> = {}
                for (const [missionId, mission] of Object.entries(getPlayerActiveMissionsSync(playerId))) {
                    // a mission with no stages comes back with an empty list
                    missions[missionId] = {
                        progress: mission.progress,
                        stages: Array.isArray(mission.stages) ? {} : mission.stages
                    }
                }
                return missions
            },
            setProgress: (missionId, progress) => {
                db.prepare(`
                INSERT INTO players_active_missions (id, progress, player_id)
                VALUES (?, ?, ?)
                ON CONFLICT (id, player_id) DO UPDATE SET progress = excluded.progress
                `).run(missionId, progress, playerId)
            },
            unlockStage: (missionId, stage) => {
                db.prepare(`
                INSERT INTO players_active_missions_stages (id, status, player_id, mission_id)
                VALUES (?, 0, ?, ?)
                ON CONFLICT (id, mission_id, player_id) DO NOTHING
                `).run(stage, playerId, missionId)
            }
        }

        const facts: ProgressFacts = {
            // the player's units, for the Content Guide's rules (level, learned abilities, element)
            units: {
                level: characterId => {
                    const character = getPlayerCharactersSync(playerId)[String(characterId)]
                    const assetData = getCharacterDataSync(characterId)
                    return character === undefined || assetData === null ? 0 : estimateCharacterLevel(assetData.rarity, character.exp, expCapsForRequest())
                },
                learnedAbilitySlots: characterId => {
                    const learned = getPlayerCharactersManaNodesSync(playerId)[String(characterId)] ?? []
                    const boards = [getCharacterManaNodesSync(characterId, 1), getCharacterManaNodesSync(characterId, 2)]
                    return new Set(learned.map(nodeId => (boards[0]?.[nodeId] ?? boards[1]?.[nodeId])?.field6).filter((slot): slot is string => !!slot))
                },
                element: characterId => getCharacterDataSync(characterId)?.element ?? null,
            },
            equipmentLevels: () => Object.values(getPlayerEquipmentListSync(playerId)).map(equipment => equipment.level),
            characters: () => Object.entries(getPlayerCharactersSync(playerId)).flatMap(([characterId, character]) => {
                const assetData = getCharacterDataSync(Number(characterId))
                return assetData === null ? [] : [{ rarity: assetData.rarity, exp: character.exp }]
            }),
            abilityNodeCount: () => {
                let total = 0
                for (const [characterId, nodeIds] of Object.entries(getPlayerCharactersManaNodesSync(playerId))) {
                    // a node ID belongs to one of the character's two mana boards
                    const firstBoard = getCharacterManaNodesSync(characterId, 1)
                    const secondBoard = getCharacterManaNodesSync(characterId, 2)
                    for (const nodeId of nodeIds) {
                        const node = firstBoard?.[nodeId] ?? secondBoard?.[nodeId]
                        if (node !== undefined && node !== null && ABILITY_SLOTS.has(node.field6)) total++
                    }
                }
                return total
            },
            evolvedCharacterCount: () => Object.values(getPlayerCharactersSync(playerId))
                .filter(character => character.evolutionLevel > 0).length,
            overLimitTotal: () => Object.values(getPlayerCharactersSync(playerId))
                .reduce((total, character) => total + character.overLimitStep, 0),
            bondTokenCount: () => Object.values(getPlayerCharactersSync(playerId))
                .reduce((total, character) => total + character.bondTokenList.filter(token => token.status >= BOND_TOKEN_RECEIVED).length, 0),
            ownedCharacterIds: () => Object.keys(getPlayerCharactersSync(playerId)).map(Number),
            finishedCharacterStoryCount: () => (getPlayerQuestProgressSync(playerId)[String(QuestCategory.CHARACTER)] ?? [])
                .filter(quest => quest.finished).length,
            partyEquipmentCount: () => countPartySlots(playerId, "equipmentIds"),
            partyUnisonCount: () => countPartySlots(playerId, "unisonCharacterIds"),
            partyAbilitySoulCount: () => countPartySlots(playerId, "abilitySoulIds"),
            questProgress: () => Object.entries(getPlayerQuestProgressSync(playerId)).flatMap(([category, quests]) => quests.map(quest => ({
                category: Number(category),
                questId: quest.questId,
                finished: quest.finished,
                clearRank: quest.clearRank
            }))),
            battleQuestIds: category => Object.entries(QUEST_ASSETS[category] ?? {})
                .filter(([_, quest]) => isBattleQuest(quest))
                .map(([questId]) => Number(questId)),
            allBondTokens: characterId => {
                const tokens = getPlayerCharactersSync(playerId)[String(characterId)]?.bondTokenList ?? []
                return tokens.length > 0 && tokens.every(token => token.status >= BOND_TOKEN_RECEIVED)
            },
            questInRange: (range, category, questId) => questInRangeQuery(range, category, questId),
        }

        // one transaction, so the progress and the unlocked stages are saved together or not at all
        const deltas = db.transaction(() => updateActiveMissionProgress(
            activeMissionDataFor() as unknown as ActiveMissionProgressData,
            store,
            facts,
            trigger,
            expCapsForRequest()
        ))()

        // CN unit awake missions are Mission screen missions (category 9), not active missions: their
        // rewards are paid as soon as a stage is reached, and they're left out of active_mission_list
        // (the CN client looks every id there up in its active mission table, error C8601)
        const awake = manaAwakeData()?.missions
        if (awake === undefined) return deltas
        const toPay = deltas.filter(delta => awake[String(delta.mission_id)] !== undefined && delta.stages.some(stage => !stage.received))
        if (toPay.length > 0) claimPlayerActiveMissionsSync(playerId, toPay.map(delta => ({
            mission_id: delta.mission_id,
            stages: delta.stages.filter(stage => !stage.received).map(stage => stage.stage),
        })))
        return deltas.filter(delta => awake[String(delta.mission_id)] === undefined)
    } catch (error) {
        console.error(`Could not update active mission progress for player ${playerId}:`, error)
        return []
    }
}
