// Connects the Time Attack ranking logic (src/lib/rankingEvent.ts) to the real database: the best
// clear comes from players_quest_progress (section RANKING_EVENT_SINGLE), and the tier paid is kept in
// players_ranking_event_rewards so it's paid once per event.

import rankingData from "../../assets/ranking_event.json"
import getDatabase, { Database } from "../data"
import { getPlayerSingleQuestProgressSync, getPlayerSync } from "../data/wdfpData"
import { getCharactersEvolutionImgLevels } from "../lib/character"
import { givePlayerRewardsSync } from "../lib/quest"
import { RANKING_REWARD_KINDS, RankingEvent, RankingEventData, RankingPlacement, RankingRewardSlot, placeRankingTime } from "../lib/rankingEvent"
import { CurrencyReward, EquipmentItemReward, QuestCategory, Reward, RewardType } from "../lib/types"

const data = rankingData as RankingEventData

export function getRankingEvent(eventId: number): RankingEvent | null {
    return data.events[String(eventId)] ?? null
}

interface BestRecord {
    elapsedTimeMs: number
    score: number
}

function getBestRecord(playerId: number, event: RankingEvent): BestRecord | null {
    const progress = getPlayerSingleQuestProgressSync(playerId, QuestCategory.RANKING_EVENT_SINGLE, event.questId)
    const time = progress?.bestElapsedTimeMs
    if (progress === null || !progress.finished || typeof time !== "number" || time <= 0) return null
    return { elapsedTimeMs: time, score: progress.highScore ?? 0 }
}

function summaryPayload(playerId: number, record: BestRecord, placement: RankingPlacement) {
    const leaderId = getPlayerSync(playerId)?.leaderCharacterId ?? 0
    const [evolution] = leaderId > 0 ? getCharactersEvolutionImgLevels(playerId, [leaderId]) : [0]
    return {
        "best_record": {
            "elapsed_time_ms": record.elapsedTimeMs,
            "is_accomplished": true,
            "score": record.score,
        },
        "leader_character_evolution_img_level": evolution ?? 0,
        "leader_character_id": leaderId,
        // the client shows this as the "next rank border" (never null: the Chinese fork saw a crash)
        "rank_border_top": {
            "elapsed_time_ms": placement.nextBorderMs,
            "is_accomplished": true,
            "score": record.score,
        },
        "rank_percentage": placement.rankPercentage,
    }
}

/**
 * The /ranking_event/get_summary reply data: { best_record: null } before a clear (the client
 * treats that as not entered yet).
 *
 * @returns null when the event doesn't exist.
 */
export function getRankingSummarySync(playerId: number, eventId: number): Object | null {
    const event = getRankingEvent(eventId)
    if (event === null) return null
    const record = getBestRecord(playerId, event)
    const placement = record === null ? null : placeRankingTime(event, eventId, record.elapsedTimeMs)
    if (record === null || placement === null) {
        // the CN client requires the leader fields here too (its reply check fills a missing id with 0,
        // and unit 0 doesn't exist: error C8601)
        const leaderId = getPlayerSync(playerId)?.leaderCharacterId ?? 0
        const [evolution] = leaderId > 0 ? getCharactersEvolutionImgLevels(playerId, [leaderId]) : [0]
        return { "best_record": null, "leader_character_id": leaderId, "leader_character_evolution_img_level": evolution ?? 0 }
    }
    return summaryPayload(playerId, record, placement)
}

/** A ranking reward slot as one of this server's rewards, or null for a title (not stored here yet). */
function toReward(slot: RankingRewardSlot): Reward | null {
    switch (slot.kind) {
        case RANKING_REWARD_KINDS.ITEM:
            return slot.id === undefined ? null : { type: RewardType.ITEM, id: slot.id, count: slot.amount } as EquipmentItemReward
        case RANKING_REWARD_KINDS.EQUIPMENT:
            return slot.id === undefined ? null : { type: RewardType.EQUIPMENT, id: slot.id, count: slot.amount } as EquipmentItemReward
        case RANKING_REWARD_KINDS.BEADS:
            return { type: RewardType.BEADS, count: slot.amount } as CurrencyReward
        case RANKING_REWARD_KINDS.MANA:
            return { type: RewardType.MANA, count: slot.amount } as CurrencyReward
        case RANKING_REWARD_KINDS.EXP:
            return { type: RewardType.EXP, count: slot.amount } as CurrencyReward
        default:
            return null
    }
}

/**
 * The /ranking_event/receive_reward reply data, with the client's three statuses (as in the Chinese
 * fork): 1 paid now, 2 already paid, 3 nothing to claim (no clear, or an unknown event). The rewards
 * are those of the tier the summary shows, paid in one transaction with the claim record.
 */
export function receiveRankingRewardSync(playerId: number, eventId: number): Object {
    const event = getRankingEvent(eventId)
    const record = event === null ? null : getBestRecord(playerId, event)
    const placement = event === null || record === null ? null : placeRankingTime(event, eventId, record.elapsedTimeMs)
    if (event === null || record === null || placement === null) return { "status": 3 }

    const tier = event.tiers[placement.tierIndex]
    const db = getDatabase(Database.WDFP_DATA)
    const paid = db.transaction(() => {
        const claim = db.prepare(`
        INSERT OR IGNORE INTO players_ranking_event_rewards (event_id, tier_id, best_elapsed_time_ms, player_id)
        VALUES (?, ?, ?, ?)
        `).run(eventId, tier.id, record.elapsedTimeMs, playerId)
        if (claim.changes === 0) return null

        const rewards: Reward[] = []
        for (const slot of tier.rewards) {
            const reward = toReward(slot)
            if (reward !== null) rewards.push(reward)
            else console.warn(`[ranking] Player ${playerId}: tier ${tier.id} gives a title (${slot.id}); titles aren't stored by this server yet, so it was skipped.`)
        }
        return rewards.length > 0 ? givePlayerRewardsSync(playerId, rewards) : { items: {}, equipment_list: [], character_list: [] }
    })()

    const summary = summaryPayload(playerId, record, placement)
    if (paid === null) return { "status": 2, ...summary }

    console.log(`[ranking] Player ${playerId}: ${event.name} best ${record.elapsedTimeMs} ms is tier ${tier.id} (${placement.rankPercentage}%), rewards paid.`)
    const player = getPlayerSync(playerId)
    return {
        "status": 1,
        ...summary,
        ...(player ? { "user_info": { "free_vmoney": player.freeVmoney, "free_mana": player.freeMana, "exp_pool": player.expPool } } : {}),
        "item_list": paid?.items ?? {},
        "equipment_list": paid?.equipment_list ?? [],
        "character_list": paid?.character_list ?? [],
    }
}
