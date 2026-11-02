// Connects the raid logic (src/lib/raid.ts) to the real database. Each player has their own raid
// boss here (single-player), stored in players_raid_events with how far the rewards have been paid.

import raidData from "../../assets/raid_event.json"
import getDatabase, { Database } from "../data"
import { PartyCategory, PlayerPartyGroup, RushEventBattleType } from "../data/types"
import {
    deletePlayerRushEventPlayedPartySync,
    getDefaultPlayerRushEventSync,
    getPlayerCharactersSync,
    getPlayerPartyGroupListSync,
    getPlayerRushEventClearedFoldersSync,
    getPlayerRushEventSync,
    insertPlayerPartyGroupListSync,
    insertPlayerRushEventPlayedPartySync,
    insertPlayerRushEventSync,
} from "../data/wdfpData"
import { getCharactersEvolutionImgLevels } from "../lib/character"
import { givePlayerRewardsSync } from "../lib/quest"
import {
    RaidBossState,
    RaidData,
    advanceRaidBoss,
    getRaidQuest,
    raidBossHpPercentage,
    raidRewardListEntry,
    selectRaidRewards,
    soloRequiredKillCount,
} from "../lib/raid"
import { getPlayerRushEventEndlessBattleRankingSync, getSerializedPlayerRushEventPlayedPartiesSync } from "../lib/rush"
import { CurrencyReward, EquipmentItemReward, Reward, RewardType } from "../lib/types"

const data = raidData as unknown as RaidData

/**
 * How many clears of a raid's hardest stage kill its boss once when playing alone (.env
 * RAID_SOLO_CLEARS_PER_KILL, default 1). Easier stages count by their kill weight.
 */
function clearsPerKill(): number {
    const value = Number(process.env.RAID_SOLO_CLEARS_PER_KILL)
    return Number.isFinite(value) && value > 0 ? value : 1
}

export function getRaidRequiredKillCount(eventId: number): number | null {
    if (data.events[String(eventId)] === undefined) return null
    return soloRequiredKillCount(data, eventId, clearsPerKill())
}

/** Every raid event id in the data (the raid missions' own dates decide which one is open). */
export function getRaidEventIds(): number[] {
    return Object.keys(data.events).map(Number).filter(id => Number.isSafeInteger(id) && id > 0)
}

/**
 * The raid party slot (1 Main, 2 Sub 1, 3 Sub 2) a raid party id is, or null: the first three parties
 * of raid group 1, the same ones /raid_event/party lists.
 */
export function getRaidPartySlotSync(playerId: number, partyId: number): number | null {
    const group1 = getPlayerPartyGroupListSync(playerId, PartyCategory.RAID)["1"]
    const index = Object.keys(group1?.list ?? {}).slice(0, 3).map(Number).indexOf(partyId)
    return index === -1 ? null : index + 1
}

export function getRaidQuestEventId(questId: number): number | null {
    return getRaidQuest(data, questId)?.eventId ?? null
}

interface RaidRow { weighted_kill_count: number, total_kill_count: number, received_up_to: number }

function getRaidRow(playerId: number, eventId: number): RaidRow {
    const row = getDatabase(Database.WDFP_DATA).prepare(`
    SELECT weighted_kill_count, total_kill_count, received_up_to FROM players_raid_events WHERE player_id = ? AND event_id = ?
    `).get(playerId, eventId) as RaidRow | undefined
    return row ?? { weighted_kill_count: 0, total_kill_count: 0, received_up_to: 0 }
}

function saveRaidRow(playerId: number, eventId: number, row: RaidRow) {
    getDatabase(Database.WDFP_DATA).prepare(`
    INSERT INTO players_raid_events (event_id, weighted_kill_count, total_kill_count, received_up_to, player_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (event_id, player_id) DO UPDATE SET
        weighted_kill_count = excluded.weighted_kill_count,
        total_kill_count = excluded.total_kill_count,
        received_up_to = excluded.received_up_to
    `).run(eventId, row.weighted_kill_count, row.total_kill_count, row.received_up_to, playerId)
}

function getQuestKillCounts(playerId: number, eventId: number): Record<string, { kill_count: number }> {
    const rows = getDatabase(Database.WDFP_DATA).prepare(`
    SELECT quest_id, kill_count FROM players_raid_event_quests WHERE player_id = ? AND event_id = ?
    `).all(playerId, eventId) as { quest_id: number, kill_count: number }[]
    return Object.fromEntries(rows.map(row => [String(row.quest_id), { kill_count: row.kill_count }]))
}

export function getRaidBossSync(playerId: number, eventId: number): { hp_percentage: number, total_kill_count: number } | null {
    const required = getRaidRequiredKillCount(eventId)
    if (required === null) return null
    const row = getRaidRow(playerId, eventId)
    return {
        hp_percentage: raidBossHpPercentage({ weightedKillCount: row.weighted_kill_count, totalKillCount: row.total_kill_count }, required),
        total_kill_count: row.total_kill_count,
    }
}

function toReward(grant: { kind: number, itemId?: number, amount: number }): Reward {
    if (grant.kind === 0) return { type: RewardType.ITEM, id: grant.itemId!, count: grant.amount } as EquipmentItemReward
    return { type: grant.kind === 3 ? RewardType.MANA : RewardType.BEADS, count: grant.amount } as CurrencyReward
}

/**
 * The /event/raid/summary reply data (the Chinese fork's shape). Pays the kill-count rewards reached
 * since the last summary first, in one transaction.
 *
 * @returns null when the raid doesn't exist.
 */
export function getRaidSummarySync(playerId: number, eventId: number, aggregatedTime: string) {
    const required = getRaidRequiredKillCount(eventId)
    if (required === null) return null
    const db = getDatabase(Database.WDFP_DATA)

    const settled = db.transaction(() => {
        const row = getRaidRow(playerId, eventId)
        const grants = selectRaidRewards(data, eventId, row.received_up_to, row.total_kill_count)
        const given = grants.length > 0 ? givePlayerRewardsSync(playerId, grants.map(toReward)) : null
        if (row.total_kill_count > row.received_up_to) saveRaidRow(playerId, eventId, { ...row, received_up_to: row.total_kill_count })
        return { row, grants, given }
    })()
    if (settled.grants.length > 0) console.log(`[raid] Player ${playerId}: raid ${eventId} rewards up to ${settled.row.total_kill_count} kills paid (${settled.grants.length} reward(s)).`)

    // the played-party fields come from the Grand Gauntlet's tables, as in the Chinese fork
    let rushEventData = getPlayerRushEventSync(playerId, eventId)
    if (rushEventData === null) {
        rushEventData = getDefaultPlayerRushEventSync(eventId)
        insertPlayerRushEventSync(playerId, rushEventData)
    }
    const playedParties = getSerializedPlayerRushEventPlayedPartiesSync(playerId, eventId)
    const state: RaidBossState = { weightedKillCount: settled.row.weighted_kill_count, totalKillCount: settled.row.total_kill_count }

    return {
        "aggregated_time": aggregatedTime,
        "auto_start_point": 0,
        "kill_count_reward_data": {
            "received_up_to": settled.row.total_kill_count,
            "reward_list": settled.grants.map(raidRewardListEntry),
        },
        "quest_list": getQuestKillCounts(playerId, eventId),
        "raid_boss": {
            "hp_percentage": raidBossHpPercentage(state, required),
            "total_kill_count": state.totalKillCount,
        },
        ...(settled.given ? {
            "item_list": settled.given.items,
            "equipment_list": settled.given.equipment_list,
            "character_list": settled.given.character_list,
            "joined_character_id_list": settled.given.joined_character_id_list,
        } : {}),
        "endless_battle_next_round": rushEventData.endlessBattleNextRound,
        "active_rush_battle_folder_id": rushEventData.activeRushBattleFolderId,
        "endless_battle_played_max_round": rushEventData.endlessBattleNextRound,
        "cleared_folder_id_list": getPlayerRushEventClearedFoldersSync(playerId, eventId),
        "endless_battle_played_party_list": playedParties.endlessParties,
        "rush_battle_played_party_list": playedParties.folderParties,
        "endless_battle_my_ranking": getPlayerRushEventEndlessBattleRankingSync(playerId, eventId, { rushEventData }),
    }
}

/**
 * Settles a cleared raid battle: adds its kill weight to the player's raid boss, counts the stage's
 * kill and keeps the party used. Rewards are paid at the next summary, as in the Chinese fork.
 *
 * @returns The reply's raid_event block, or null when the quest isn't a raid quest.
 */
export function finishRaidBattleSync(
    playerId: number,
    questId: number,
    party: { characterIds: (number | null)[], unisonCharacterIds: (number | null)[], equipmentIds: (number | null)[], abilitySoulIds: (number | null)[] }
) {
    const quest = getRaidQuest(data, questId)
    if (quest === null) return null
    const required = getRaidRequiredKillCount(quest.eventId)
    if (required === null) return null
    const db = getDatabase(Database.WDFP_DATA)

    return db.transaction(() => {
        const row = getRaidRow(playerId, quest.eventId)
        const next = advanceRaidBoss({ weightedKillCount: row.weighted_kill_count, totalKillCount: row.total_kill_count }, quest.killWeight, required)
        saveRaidRow(playerId, quest.eventId, { weighted_kill_count: next.weightedKillCount, total_kill_count: next.totalKillCount, received_up_to: row.received_up_to })

        db.prepare(`
        INSERT INTO players_raid_event_quests (event_id, quest_id, kill_count, player_id) VALUES (?, ?, 1, ?)
        ON CONFLICT (event_id, quest_id, player_id) DO UPDATE SET kill_count = kill_count + 1
        `).run(quest.eventId, questId, playerId)
        const questKills = (db.prepare(`SELECT kill_count FROM players_raid_event_quests WHERE player_id = ? AND event_id = ? AND quest_id = ?`)
            .get(playerId, quest.eventId, questId) as { kill_count: number }).kill_count

        // the party used, replacing this stage's previous one
        deletePlayerRushEventPlayedPartySync(playerId, quest.eventId, questId, RushEventBattleType.FOLDER)
        insertPlayerRushEventPlayedPartySync(playerId, quest.eventId, {
            ...party,
            evolutionImgLevels: getCharactersEvolutionImgLevels(playerId, party.characterIds),
            unisonEvolutionImgLevels: getCharactersEvolutionImgLevels(playerId, party.unisonCharacterIds),
            round: questId,
            battleType: RushEventBattleType.FOLDER,
        })

        if (next.totalKillCount > row.total_kill_count) console.log(`[raid] Player ${playerId}: raid ${quest.eventId} boss defeated (${next.totalKillCount} total).`)
        return {
            "auto_start_point": 0,
            "is_out_of_period": false,
            "quest_boss": { "kill_count": questKills },
            "raid_boss": {
                "hp_percentage": raidBossHpPercentage(next, required),
                "total_kill_count": next.totalKillCount,
            },
        }
    })()
}

/**
 * The raid party list (the Chinese fork's shape: group 1 with three parties). Raid parties are their
 * own category, copied from the normal parties the first time.
 */
export function getRaidPartyGroupListSync(playerId: number) {
    let groups = getPlayerPartyGroupListSync(playerId, PartyCategory.RAID)
    if (Object.keys(groups).length === 0) {
        const normal = getPlayerPartyGroupListSync(playerId, PartyCategory.NORMAL)
        const copied: Record<string, PlayerPartyGroup> = {}
        for (const [groupId, group] of Object.entries(normal)) {
            if (Number(groupId) > 6) continue
            for (const party of Object.values(group.list)) party.category = PartyCategory.RAID
            group.category = PartyCategory.RAID
            copied[groupId] = group
        }
        insertPlayerPartyGroupListSync(playerId, copied)
        groups = getPlayerPartyGroupListSync(playerId, PartyCategory.RAID)
    }

    const group1 = groups["1"]
    const partyList = Object.entries(group1?.list ?? {}).slice(0, 3).map(([partyId, party]) => ({
        "ability_soul_ids": party.abilitySoulIds,
        "character_ids": party.characterIds,
        "equipment_ids": party.equipmentIds,
        "unison_character_ids": party.unisonCharacterIds,
        "options": { "allow_other_players_to_heal_me": party.options.allowOtherPlayersToHealMe },
        "party_edited": party.edited,
        "party_id": Number(partyId),
        "party_name": party.name,
    }))
    // fill missing parties with an unused unit, as the Chinese fork does
    const owned = Object.keys(getPlayerCharactersSync(playerId)).map(Number).filter(id => id > 0).sort((a, b) => a - b)
    while (partyList.length < 3) {
        const used = new Set(partyList.flatMap(p => p.character_ids.filter((id): id is number => id !== null)))
        const n = partyList.length + 1
        partyList.push({
            "ability_soul_ids": [null, null, null], "character_ids": [owned.find(id => !used.has(id)) ?? null, null, null],
            "equipment_ids": [null, null, null], "unison_character_ids": [null, null, null],
            "options": { "allow_other_players_to_heal_me": true }, "party_edited": false, "party_id": n, "party_name": `Party ${n}`,
        })
    }
    return [{ "party_group_color_id": group1?.colorId ?? 15, "party_group_id": 1, "party_list": partyList }]
}
