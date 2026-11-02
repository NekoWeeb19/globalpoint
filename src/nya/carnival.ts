// Connects the Hanifolk Carnival logic (src/lib/carnival.ts) to the real database.

import carnivalData from "../../assets/carnival_event.json"
import getDatabase, { Database } from "../data"
import { PartyCategory, PlayerPartyGroup } from "../data/types"
import { getPlayerPartyGroupListSync, insertPlayerPartyGroupListSync } from "../data/wdfpData"
import { CARNIVAL_REWARD_KINDS, CarnivalData, CarnivalRecord, getCarnivalQuest, settleCarnivalClear } from "../lib/carnival"
import { givePlayerRewardsSync } from "../lib/quest"
import { CurrencyReward, EquipmentItemReward, Reward, RewardType } from "../lib/types"

const data = carnivalData as unknown as CarnivalData

/** The carnival screen has 6 party groups (the Chinese fork's limit for carnival parties). */
const CARNIVAL_PARTY_GROUPS = 6

interface RawCarnivalRecord {
    folder_id: number
    best_score: number
    previous_score: number
    previous_character_ids: string | null
    previous_unison_character_ids: string | null
}

const serializeIds = (ids: (number | null)[]) => ids.map(id => id === null || id === undefined ? "" : String(id)).join(",")
const deserializeIds = (value: string | null): (number | null)[] =>
    value === null ? [null, null, null] : value.split(",").map(part => part === "" ? null : Number(part))

export function isCarnivalQuest(questId: number): boolean {
    return getCarnivalQuest(data, questId) !== null
}

function getRecords(playerId: number, eventId: number): RawCarnivalRecord[] {
    return getDatabase(Database.WDFP_DATA).prepare(`
    SELECT folder_id, best_score, previous_score, previous_character_ids, previous_unison_character_ids
    FROM players_carnival_event_records
    WHERE player_id = ? AND event_id = ?
    ORDER BY folder_id
    `).all(playerId, eventId) as RawCarnivalRecord[]
}

/** The "records" of /carnival_event/index: each folder's best and last score, and the last party. */
export function getCarnivalRecordsSync(playerId: number, eventId: number) {
    return getRecords(playerId, eventId).map(record => ({
        folder_id: record.folder_id,
        best_score: record.best_score,
        previous_score: record.previous_score,
        previous_character_ids: deserializeIds(record.previous_character_ids),
        previous_unison_character_ids: deserializeIds(record.previous_unison_character_ids),
    }))
}

/**
 * The player's carnival party groups, in the format the party lists of events use. The first time,
 * they are copied from the player's normal parties (as the Grand Gauntlet's are).
 */
export function getCarnivalPartyGroupListSync(playerId: number) {
    let groups = getPlayerPartyGroupListSync(playerId, PartyCategory.CARNIVAL)
    if (Object.keys(groups).length === 0) {
        const normal = getPlayerPartyGroupListSync(playerId, PartyCategory.NORMAL)
        const copied: Record<string, PlayerPartyGroup> = {}
        for (const [groupId, group] of Object.entries(normal)) {
            if (Number(groupId) > CARNIVAL_PARTY_GROUPS) continue
            for (const party of Object.values(group.list)) party.category = PartyCategory.CARNIVAL
            group.category = PartyCategory.CARNIVAL
            copied[groupId] = group
        }
        insertPlayerPartyGroupListSync(playerId, copied)
        groups = getPlayerPartyGroupListSync(playerId, PartyCategory.CARNIVAL)
    }

    return Object.entries(groups).map(([groupId, group]) => ({
        "party_group_id": Number(groupId),
        "party_group_color_id": group.colorId,
        "party_list": Object.entries(group.list).map(([partyId, party]) => ({
            "party_id": Number(partyId),
            "party_name": party.name,
            "party_edited": party.edited,
            "character_ids": party.characterIds,
            "unison_character_ids": party.unisonCharacterIds,
            "equipment_ids": party.equipmentIds,
            "ability_soul_ids": party.abilitySoulIds,
            "options": {
                "allow_other_players_to_heal_me": party.options.allowOtherPlayersToHealMe
            }
        }))
    }))
}

/** A carnival reward slot as one of this server's rewards, or null for a title (not stored here yet). */
function toReward(slot: { kind: number, id?: number, amount: number }): Reward | null {
    switch (slot.kind) {
        case CARNIVAL_REWARD_KINDS.ITEM:
            return slot.id === undefined ? null : { type: RewardType.ITEM, id: slot.id, count: slot.amount } as EquipmentItemReward
        case CARNIVAL_REWARD_KINDS.EQUIPMENT:
            return slot.id === undefined ? null : { type: RewardType.EQUIPMENT, id: slot.id, count: slot.amount } as EquipmentItemReward
        case CARNIVAL_REWARD_KINDS.BEADS:
            return { type: RewardType.BEADS, count: slot.amount } as CurrencyReward
        case CARNIVAL_REWARD_KINDS.MANA:
            return { type: RewardType.MANA, count: slot.amount } as CurrencyReward
        case CARNIVAL_REWARD_KINDS.EXP:
            return { type: RewardType.EXP, count: slot.amount } as CurrencyReward
        default:
            return null
    }
}

export interface CarnivalFinishResult {
    /** The reply's carnival_event block (the Chinese fork's shape). */
    carnivalEvent: {
        is_record_valid: boolean
        leader_character_id: number
        new_degree_ids: number[]
        previous_total_best_score: number
        reward_ids: number[]
        score: { difficulty_bonus: number, time_bonus: number }
    }
    item_list: Record<string, number>
    equipment_list: Object[]
    character_list: Object[]
}

/**
 * Settles a cleared carnival battle: saves the folder's score and pays the total-score rewards
 * reached, in one transaction. Call it after the battle's own saves; the reply's user_info should
 * be read afterwards so it includes the rewards.
 *
 * @returns null when the quest isn't a carnival quest.
 */
export function finishCarnivalBattleSync(
    playerId: number,
    questId: number,
    clearTimeMs: unknown,
    characterIds: (number | null)[],
    unisonCharacterIds: (number | null)[]
): CarnivalFinishResult | null {
    const quest = getCarnivalQuest(data, questId)
    if (quest === null) return null
    const db = getDatabase(Database.WDFP_DATA)

    return db.transaction(() => {
        const records: CarnivalRecord[] = getRecords(playerId, quest.eventId).map(r => ({ folderId: r.folder_id, bestScore: r.best_score }))
        const paid = new Set((db.prepare(`
        SELECT reward_id FROM players_carnival_event_rewards WHERE player_id = ? AND event_id = ?
        `).all(playerId, quest.eventId) as { reward_id: number }[]).map(row => row.reward_id))

        const result = settleCarnivalClear(data, questId, clearTimeMs, records, paid)
        if (result === null) return null

        db.prepare(`
        INSERT INTO players_carnival_event_records (event_id, folder_id, best_score, previous_score, previous_character_ids, previous_unison_character_ids, player_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (event_id, folder_id, player_id) DO UPDATE SET
            best_score = excluded.best_score,
            previous_score = excluded.previous_score,
            previous_character_ids = excluded.previous_character_ids,
            previous_unison_character_ids = excluded.previous_unison_character_ids
        `).run(result.eventId, result.folderId, result.folderBestScore, result.score.total, serializeIds(characterIds), serializeIds(unisonCharacterIds), playerId)

        const rewards: Reward[] = []
        for (const rewardId of result.rewardIds) {
            for (const slot of data.rewards[String(rewardId)].rewards) {
                const reward = toReward(slot)
                if (reward !== null) rewards.push(reward)
                else console.warn(`[carnival] Player ${playerId}: reward ${rewardId} gives a title (${slot.id}); titles aren't stored by this server yet, so it was skipped.`)
            }
        }
        const given = rewards.length > 0 ? givePlayerRewardsSync(playerId, rewards) : null
        const markPaid = db.prepare(`INSERT OR IGNORE INTO players_carnival_event_rewards (event_id, reward_id, player_id) VALUES (?, ?, ?)`)
        for (const rewardId of result.rewardIds) markPaid.run(result.eventId, rewardId, playerId)

        if (result.rewardIds.length > 0) console.log(`[carnival] Player ${playerId} reached ${result.totalBestScore} in event ${result.eventId}: rewards ${result.rewardIds.join(", ")}`)

        return {
            carnivalEvent: {
                is_record_valid: true,
                leader_character_id: characterIds.find(id => id !== null && id !== undefined) ?? 0,
                new_degree_ids: [],
                previous_total_best_score: result.popupPreviousTotalBestScore,
                reward_ids: result.rewardIds,
                score: { difficulty_bonus: result.score.difficultyBonus, time_bonus: result.score.timeBonus },
            },
            item_list: given?.items ?? {},
            equipment_list: given?.equipment_list ?? [],
            character_list: given?.character_list ?? [],
        }
    })()
}
