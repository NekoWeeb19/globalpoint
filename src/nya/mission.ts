// Connects the Mission screen logic (src/lib/mission.ts) to the real database.
//
// Progress is saved in players_missions, one row per player, category and mission. Missions that
// track the account's state (rank, characters...) are worked out from the player's data each time.
// The save's cleared_regular_mission_list (what the global server already cleared and paid) is the
// starting point for regular missions, and is kept up to date when stages are paid here.
//
// Rewards are paid straight into the account, as the global server did (the recorded
// /story_quest/finish reply reports a mission's beads in mission_info and user_info).

import missionData from "../../assets/missions.json"
import { readFileSync, statSync } from "fs"
import path from "path"
import { inCnRequest } from "../lib/cnClient"
import questStamina from "../../assets/quest_stamina.json"
import mainQuests from "../../assets/main_quest.json"
import exQuests from "../../assets/ex_quest.json"
import getDatabase, { Database } from "../data"
import {
    getPlayerCharactersManaNodesSync,
    getPlayerCharactersSync,
    getPlayerClearedRegularMissionListSync,
    getPlayerEquipmentListSync,
    getPlayerItemSync,
    getPlayerPartyGroupListSync,
    getPlayerQuestProgressSync,
    getPlayerSync,
    givePlayerItemSync,
    updatePlayerSync
} from "../data/wdfpData"
import { estimateCharacterLevel } from "../lib/activeMissionProgress"
import { getCharacterDataSync, getCharacterManaNodesSync } from "../lib/assets"
import { PartyCategory } from "../data/types"
import { expCapsForRequest, givePlayerCharacterSync } from "../lib/character"
import { givePlayerEquipmentSync } from "../lib/equipment"
import {
    CounterEvent,
    MissionCategory,
    MissionClock,
    MissionData,
    MissionFacts,
    MissionProgressUpdate,
    MissionReward,
    MissionRewardResult,
    MissionWallet,
    STATE_KINDS,
    UNIT_STATE_KINDS,
    SavedMission,
    SavedMissionLookup,
    applyMissionCounters,
    buildMissionProgressList,
    emptyMissionRewardResult,
    payMissionRewards,
    settleMissionRewards,
    withClearedBaseline,
} from "../lib/mission"
import { QuestCategory } from "../lib/types"
import { getServerDate } from "../utils"
import { getRankByPt } from "./player"
import { givePlayerDegreeSync } from "./degree"
import { addPassPointSync } from "./passCard"

const globalData = missionData as unknown as MissionData

// The CN client lists its own missions (assets/missions_cn.json, scripts/gen_cn_missions.cjs; rebuilt
// with each CN schedule update, so read again when the file changes). Most ids are the same missions
// as global's; the few ids global uses for another mission ("distinct") are saved under
// id + CN_DISTINCT_OFFSET so the two never share progress.
const CN_MISSIONS_FILE = path.join(__dirname, "..", "..", "assets", "missions_cn.json")
const CN_DISTINCT_OFFSET = 1_000_000_000
let cnCache: { mtimeMs: number, data: MissionData, distinct: Map<number, Set<number>> } | null = null

function cnMissionData() {
    try {
        const mtimeMs = statSync(CN_MISSIONS_FILE).mtimeMs
        if (cnCache === null || cnCache.mtimeMs !== mtimeMs) {
            const raw = JSON.parse(readFileSync(CN_MISSIONS_FILE, "utf8"))
            const distinct = new Map<number, Set<number>>()
            for (const [category, ids] of Object.entries(raw.distinct ?? {})) distinct.set(Number(category), new Set(ids as number[]))
            cnCache = { mtimeMs, data: raw as MissionData, distinct }
        }
        return cnCache
    } catch {
        return null
    }
}

/** The missions of the client making the current request. */
function missionSet(): { data: MissionData, dbId: (category: number, id: number) => number } {
    const cn = inCnRequest() ? cnMissionData() : null
    if (cn === null) return { data: globalData, dbId: (_category, id) => id }
    return { data: cn.data, dbId: (category, id) => cn.distinct.get(category)?.has(id) ? id + CN_DISTINCT_OFFSET : id }
}
const staminaCosts = questStamina as unknown as Record<string, Record<string, number> | string>

/** A quest's battle stamina cost (assets/quest_stamina.json, from the global quest tables), or 0. */
export function questStaminaCost(questCategory: number, questId: number): number {
    const costs = staminaCosts[String(questCategory)]
    const cost = typeof costs === "object" ? costs[String(questId)] : undefined
    return typeof cost === "number" && cost > 0 ? cost : 0
}

/** A bond token with this status has been received (1 = ready to receive, 2 = received). */
const BOND_TOKEN_RECEIVED = 2

interface RawPlayerMission {
    category: number
    id: number
    progress: number
    rewarded_stage: number
    period: string | null
}

function clock(): MissionClock {
    return { serverMs: getServerDate().getTime(), realMs: Date.now() }
}

/** Reads all of a player's saved missions once, with the global cleared list as a floor. */
function loadSavedMissions(playerId: number): SavedMissionLookup {
    const rows = getDatabase(Database.WDFP_DATA).prepare(`
    SELECT category, id, progress, rewarded_stage, period
    FROM players_missions
    WHERE player_id = ?
    `).all(playerId) as RawPlayerMission[]

    const byKey = new Map<string, SavedMission>()
    for (const row of rows) {
        byKey.set(`${row.category}:${row.id}`, { progress: row.progress, rewardedStage: row.rewarded_stage, period: row.period })
    }
    const { data, dbId } = missionSet()
    const lookup: SavedMissionLookup = (category, missionId) => byKey.get(`${category}:${dbId(category, missionId)}`) ?? null
    return withClearedBaseline(data, lookup, getPlayerClearedRegularMissionListSync(playerId))
}

function saveMissionRows(playerId: number, updates: MissionProgressUpdate[]) {
    const db = getDatabase(Database.WDFP_DATA)
    const save = db.prepare(`
    INSERT INTO players_missions (category, id, progress, rewarded_stage, period, player_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (category, id, player_id) DO UPDATE SET
        progress = excluded.progress,
        rewarded_stage = excluded.rewarded_stage,
        period = excluded.period
    `)
    // the client's cleared_regular_mission_list (sent at /load) follows the paid stages
    const saveCleared = db.prepare(`
    INSERT INTO players_cleared_regular_missions (id, value, player_id)
    VALUES (?, ?, ?)
    ON CONFLICT (id, player_id) DO UPDATE SET value = MAX(value, excluded.value)
    `)
    const { dbId } = missionSet()
    for (const u of updates) {
        save.run(u.category, dbId(u.category, u.missionId), u.progress, u.rewardedStage, u.period, playerId)
        if (u.category === MissionCategory.REGULAR && u.rewardedStage > 0) saveCleared.run(u.missionId, u.rewardedStage, playerId)
    }
}

/** The account-state values, each worked out only when a listed mission asks for it. */
function playerFacts(playerId: number): MissionFacts {
    const cache = new Map<number, number | null>()
    let characters: ReturnType<typeof getPlayerCharactersSync> | null = null
    const getCharacters = () => characters ??= getPlayerCharactersSync(playerId)
    let equipment: ReturnType<typeof getPlayerEquipmentListSync> | null = null
    const getEquipment = () => equipment ??= getPlayerEquipmentListSync(playerId)
    let levels: number[] | null = null
    const getLevels = () => levels ??= Object.entries(getCharacters()).flatMap(([characterId, character]) => {
        const assetData = getCharacterDataSync(Number(characterId))
        return assetData === null ? [] : [estimateCharacterLevel(assetData.rarity, character.exp, expCapsForRequest())]
    })

    let learnedNodes: ReturnType<typeof getPlayerCharactersManaNodesSync> | null = null
    /** Whether every node of a unit's 2nd Mana Board is learned. */
    const secondBoardComplete = (characterId: string): boolean => {
        const character = getCharacters()[characterId]
        if (character === undefined || character.manaBoardIndex < 2) return false
        const board = getCharacterManaNodesSync(characterId, 2)
        if (!board) return false
        const nodeIds = Object.keys(board)
        learnedNodes ??= getPlayerCharactersManaNodesSync(playerId)
        const have = new Set((learnedNodes[characterId] ?? []).map(String))
        return nodeIds.length > 0 && nodeIds.every(nodeId => have.has(nodeId))
    }
    /** A unit's level (estimated from its EXP, like the other level missions), or null. */
    const unitLevel = (characterId: string): number | null => {
        const character = getCharacters()[characterId]
        const assetData = getCharacterDataSync(Number(characterId))
        if (character === undefined || assetData === null) return null
        return estimateCharacterLevel(assetData.rarity, character.exp, expCapsForRequest())
    }

    const compute = (kind: number): number | null => {
        switch (kind) {
            case STATE_KINDS.USER_RANK: {
                const player = getPlayerSync(playerId)
                return player === null ? null : getRankByPt(player.rankPoint)?.rank ?? null
            }
            case STATE_KINDS.CHARACTERS_COUNT:
                return Object.keys(getCharacters()).length
            case STATE_KINDS.HIGHEST_CHARACTER_LEVEL:
                return getLevels().reduce((max, level) => Math.max(max, level), 0)
            case STATE_KINDS.CHARACTERS_AT_LEVEL_80:
                return getLevels().filter(level => level >= 80).length
            case STATE_KINDS.MANA_NODES_RELEASED:
                return Object.values(getPlayerCharactersManaNodesSync(playerId)).reduce((total, nodes) => total + nodes.length, 0)
            case STATE_KINDS.BOND_TOKENS_OBTAINED:
                return Object.values(getCharacters())
                    .reduce((total, character) => total + character.bondTokenList.filter(token => token.status >= BOND_TOKEN_RECEIVED).length, 0)
            case STATE_KINDS.OVER_LIMIT_TOTAL:
                return Object.values(getCharacters()).reduce((total, character) => total + character.overLimitStep, 0)
            case STATE_KINDS.CHARACTER_EPISODES_READ:
                return (getPlayerQuestProgressSync(playerId)[String(QuestCategory.CHARACTER)] ?? []).filter(quest => quest.finished).length
            case STATE_KINDS.EQUIPMENT_KINDS_OWNED:
                return Object.keys(getEquipment()).length
            case STATE_KINDS.EQUIPMENT_AWAKENINGS:
                // the recorded /equipment/upgrade (level 1 -> 5) cleared mission 67's 4-awakening stage
                return Object.values(getEquipment()).reduce((total, equipment) => total + Math.max(0, equipment.level - 1), 0)
            case STATE_KINDS.LEVEL_5_EQUIPMENT:
                return Object.values(getEquipment()).filter(equipment => equipment.level >= 5).length
            case STATE_KINDS.ABILITY_CORES_EQUIPPED: {
                let total = 0
                for (const category of [PartyCategory.NORMAL, PartyCategory.EVENT]) {
                    for (const group of Object.values(getPlayerPartyGroupListSync(playerId, category))) {
                        for (const party of Object.values(group.list)) {
                            total += party.abilitySoulIds.filter(id => id !== null && id !== undefined && id !== 0).length
                        }
                    }
                }
                return total
            }
            case STATE_KINDS.SECOND_MANA_BOARDS_OPEN:
                // the recorded /character/open_mana_board set mana_board_index to 2 and cleared mission 95
                return Object.values(getCharacters()).filter(character => character.manaBoardIndex >= 2).length
            case STATE_KINDS.SECOND_MANA_BOARDS_COMPLETE:
                return Object.keys(getCharacters()).filter(secondBoardComplete).length
            default:
                return null
        }
    }

    let questProgress: ReturnType<typeof getPlayerQuestProgressSync> | null = null
    const finishedByCategory = new Map<number, ReadonlySet<number>>()

    return {
        stateValue(kind) {
            if (!cache.has(kind)) cache.set(kind, compute(kind))
            return cache.get(kind) ?? null
        },
        finishedQuestIds(questCategory) {
            let finished = finishedByCategory.get(questCategory)
            if (finished === undefined) {
                questProgress ??= getPlayerQuestProgressSync(playerId)
                finished = new Set((questProgress[String(questCategory)] ?? []).filter(quest => quest.finished).map(quest => quest.questId))
                finishedByCategory.set(questCategory, finished)
            }
            return finished
        },
        questIds(questCategory) {
            return QUEST_IDS[questCategory] ?? null
        },
        itemCount(itemId) {
            return getPlayerItemSync(playerId, itemId) ?? 0
        },
        unitStateValue(kind, characterId) {
            const id = String(characterId)
            const character = getCharacters()[id]
            if (character === undefined) return 0
            switch (kind) {
                case UNIT_STATE_KINDS.LEVEL_100_AND_AMITY_SCROLL: {
                    const level = unitLevel(id)
                    const scroll = character.bondTokenList.some(token => token.manaBoardIndex === 1 && token.status >= BOND_TOKEN_RECEIVED)
                    return (level !== null && level >= 100 ? 1 : 0) + (scroll ? 1 : 0)
                }
                case UNIT_STATE_KINDS.SECOND_MANA_BOARD_COMPLETE:
                    return secondBoardComplete(id) ? 1 : 0
                default:
                    return null
            }
        }
    }
}

/** Every main and EX quest id (story and battle), for the "Clear Chapter N" missions. */
const QUEST_IDS: Record<number, number[]> = {
    [QuestCategory.MAIN]: Object.keys(mainQuests).map(Number).filter(Number.isSafeInteger),
    [QuestCategory.EX]: Object.keys(exQuests).map(Number).filter(Number.isSafeInteger),
}

/** Pays into the account, reading the player once and keeping running totals. */
function playerWallet(playerId: number): MissionWallet {
    const player = getPlayerSync(playerId)
    if (player === null) throw new Error(`Player ${playerId} does not exist.`)
    let freeVmoney = player.freeVmoney
    let freeMana = player.freeMana
    let expPool = player.expPool

    return {
        addFreeVmoney: amount => {
            freeVmoney += amount
            updatePlayerSync({ id: playerId, freeVmoney })
            return freeVmoney
        },
        addFreeMana: amount => {
            freeMana += amount
            updatePlayerSync({ id: playerId, freeMana })
            return freeMana
        },
        addExpPool: amount => {
            expPool += amount
            updatePlayerSync({ id: playerId, expPool })
            return expPool
        },
        addDegree: degreeId => givePlayerDegreeSync(playerId, degreeId),
        addPassPoint: (passId, amount) => addPassPointSync(playerId, passId, amount),
        addItem: (itemId, amount) => givePlayerItemSync(playerId, itemId, amount),
        addEquipment: (equipmentId, amount) => givePlayerEquipmentSync(playerId, equipmentId, amount),
        addCharacter: characterId => {
            const given = givePlayerCharacterSync(playerId, characterId)
            if (given === null) return null
            const item = given.item
            return {
                character: given.character,
                ...(item === undefined ? {} : { item: { id: item.id, total: getPlayerItemSync(playerId, item.id) ?? item.count } })
            }
        },
    }
}

/**
 * Pays a list of rewards (mission reward kinds) that aren't a mission's, e.g. pass rewards, the same
 * way mission rewards are paid. Run it inside the caller's transaction.
 */
export function payRewardListSync(playerId: number, rewards: MissionReward[], label: string): MissionRewardResult {
    const result = payMissionRewards([{ category: 0, missionId: 0, stage: 0, rewardId: 0, rewards }], playerWallet(playerId))
    result.mission_info = []
    for (const reason of result.skipped) console.warn(`[${label}] Player ${playerId}: ${reason}.`)
    return result
}

/**
 * The reply's mission_progress_list for the categories the client asked for. It only reads.
 */
export function getPlayerMissionProgressListSync(playerId: number, categories: number[]) {
    return buildMissionProgressList(missionSet().data, categories, clock(), loadSavedMissions(playerId), playerFacts(playerId))
}

/**
 * Adds action counts (a battle cleared, a login) to the player's missions, then pays every stage
 * that is cleared and not yet paid (including ones reached through the account's state, like a rank
 * up). Call it after the handler has saved its own changes to the player, so they aren't overwritten.
 *
 * It never throws: tracking missions must not make the action itself fail. On an error nothing is
 * saved or paid (one transaction), the error is logged and an empty result comes back.
 *
 * @returns What was paid, for the reply (mission_info, user_info, item_list...).
 */
export function progressPlayerMissionsSync(playerId: number, events: CounterEvent[] = []): MissionRewardResult {
    try {
        const db = getDatabase(Database.WDFP_DATA)
        const result = db.transaction(() => {
            const now = clock()
            if (events.length > 0) {
                const counted = applyMissionCounters(missionSet().data, now, loadSavedMissions(playerId), playerFacts(playerId), events)
                saveMissionRows(playerId, counted)
            }
            const { payouts, updates } = settleMissionRewards(missionSet().data, now, loadSavedMissions(playerId), playerFacts(playerId))
            if (payouts.length === 0) return emptyMissionRewardResult()
            const paid = payMissionRewards(payouts, playerWallet(playerId))
            saveMissionRows(playerId, updates)
            return paid
        })()
        for (const reason of result.skipped) console.warn(`[mission] Player ${playerId}: ${reason}.`)
        if (result.mission_info.length > 0) {
            console.log(`[mission] Player ${playerId} cleared ${result.mission_info.map(m => `${m.mission_category_id}/${m.mission_id} (${m.mission_reward_id})`).join(", ")}`)
        }
        return result
    } catch (error) {
        console.error(`Could not update missions for player ${playerId}:`, error)
        return emptyMissionRewardResult()
    }
}

/**
 * Settles the player's missions after an action (with any action counts), and adds what was paid to
 * the action's reply data, the way the recorded global replies do (/equipment/upgrade,
 * /character/open_mana_board, /character/receive_bond_token...): mission_info, the new totals in
 * user_info, and the given items, units and armaments. Call it when the reply is built, after the
 * handler has saved its own changes.
 *
 * Totals the handler already put in user_info are raised by the amount paid; others are set to the
 * new total. It never throws (see progressPlayerMissionsSync).
 */
export function withMissionRewards<T>(playerId: number, data: T, events: CounterEvent[] = []): T {
    const result = progressPlayerMissionsSync(playerId, events)
    if (result.mission_info.length === 0 || data === null || typeof data !== "object" || Array.isArray(data)) return data
    const reply = data as Record<string, any>

    reply.mission_info = [...(Array.isArray(reply.mission_info) ? reply.mission_info : []), ...result.mission_info]

    const userInfo: Record<string, any> = reply.user_info !== null && typeof reply.user_info === "object" ? reply.user_info : {}
    for (const key of ["free_vmoney", "free_mana", "exp_pool"] as const) {
        if (result.added[key] <= 0) continue
        userInfo[key] = typeof userInfo[key] === "number" ? userInfo[key] + result.added[key] : result.user_info[key]
    }
    if (Object.keys(userInfo).length > 0) reply.user_info = userInfo

    if (Object.keys(result.item_list).length > 0) reply.item_list = { ...(reply.item_list ?? {}), ...result.item_list }
    if (result.character_list.length > 0) reply.character_list = [...(Array.isArray(reply.character_list) ? reply.character_list : []), ...result.character_list]
    if (result.equipment_list.length > 0) reply.equipment_list = [...(Array.isArray(reply.equipment_list) ? reply.equipment_list : []), ...result.equipment_list]
    return data
}
