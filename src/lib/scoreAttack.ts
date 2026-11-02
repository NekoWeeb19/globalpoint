// Score Attack events: the grade comes from the score (not the clear time), each score border passed
// for the first time pays its reward once, and every battle goes into the event's history
// (history/score_attack_event_battle). Data: assets/score_attack.json (scripts/gen_score_attack.cjs).
// The rules follow the Chinese fork (lib/quest/finish/score-attack-handler.ts, lib/quest/battle-history.ts);
// the reply fields are the global client's (data.score_attack_event.main_character_ids / reward_ids,
// data.history[i].*).

export interface ScoreAttackBorder {
    id: number
    score: number
    rewards: { itemId: number, amount: number }[]
}

export interface ScoreAttackData {
    /** Quest id -> its event, local quest number and B / A / S / SS scores. */
    quests: Record<string, { eventId: number, localId: number, scores: [number, number, number, number] }>
    /** Quest id -> its score borders, lowest first. */
    borders: Record<string, ScoreAttackBorder[]>
}

/** The grade for a score: 5 SS, 4 S, 3 A, 2 B, 1 below B (the clear_rank values). */
export function scoreAttackGrade(scores: readonly number[], score: number): number {
    const [b, a, s, ss] = scores
    return score >= ss ? 5 : score >= s ? 4 : score >= a ? 3 : score >= b ? 2 : 1
}

/** A battle counts as cleared once its score reaches the first border (as in the Chinese fork). */
export function scoreAttackCleared(borders: readonly ScoreAttackBorder[], score: number): boolean {
    return borders.length > 0 && score >= borders[0].score
}

/** The borders a new score passes for the first time (above the old high score, up to the new score). */
export function newlyPassedBorders(borders: readonly ScoreAttackBorder[], oldHighScore: number, score: number): ScoreAttackBorder[] {
    if (score <= oldHighScore) return []
    return borders.filter(border => border.score > oldHighScore && border.score <= score)
}

/** The items those borders pay: item id -> amount. */
export function borderRewardItems(borders: readonly ScoreAttackBorder[]): Map<number, number> {
    const items = new Map<number, number>()
    for (const border of borders) for (const reward of border.rewards) items.set(reward.itemId, (items.get(reward.itemId) ?? 0) + reward.amount)
    return items
}

interface PartyMember { id?: unknown }
export interface HistoryParty {
    characters?: (PartyMember | null)[]
    unison_characters?: (PartyMember | null)[]
    equipments?: (PartyMember | null)[]
    ability_soul_ids?: unknown[]
}

/** score_attack_event.main_character_ids: slot -> leader unit of that slot. */
export function mainCharacterIds(party: HistoryParty | undefined): Record<number, number> {
    const ids: Record<number, number> = {}
    party?.characters?.forEach((member, slot) => {
        if (typeof member?.id === "number" && member.id > 0) ids[slot] = member.id
    })
    return ids
}

const idOrNull = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null
const amount = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0

/**
 * One history entry, with the fields the client reads (data.history[i]). `equipment` gives an
 * armament's level and enhancement (null when not owned).
 */
export function historyRecord(input: {
    categoryId: number
    questId: number
    createTime: string
    elapsedTimeMs: number
    score: number
    clearRank: number
    party: HistoryParty | undefined
    zones: unknown
    equipment: (id: number) => { level: number, enhancementLevel: number } | null
}): Record<string, number | string | null> {
    const zones = Array.isArray(input.zones) ? input.zones.filter(zone => zone !== null && typeof zone === "object") as Record<string, unknown>[] : []
    const memberDamage = (slot: number): number | null => {
        let found = false, total = 0
        for (const zone of zones) {
            const members = Array.isArray(zone.members) ? zone.members : []
            const damage = (members[slot] as Record<string, unknown> | null | undefined)?.origin_damage
            if (typeof damage === "number" && Number.isFinite(damage)) { found = true; total += Math.max(0, damage) }
        }
        return found ? total : null
    }
    const party = input.party ?? {}
    const unit = (list: (PartyMember | null)[] | undefined, slot: number) => idOrNull(list?.[slot]?.id)
    const record: Record<string, number | string | null> = {
        category_id: input.categoryId,
        quest_id: input.questId,
        finish_kind: 0,
        create_time: input.createTime,
        elapsed_time_ms: Math.max(0, input.elapsedTimeMs),
        score: Math.max(0, input.score),
        clear_rank: input.clearRank,
        total_damage: zones.reduce((sum, zone) => sum + amount(zone.damage_deal_total), 0),
    }
    for (const slot of [0, 1, 2]) {
        const n = slot + 1
        const equipmentId = unit(party.equipments, slot)
        const equipment = equipmentId === null ? null : input.equipment(equipmentId)
        record[`character_id_${n}`] = unit(party.characters, slot)
        record[`unison_character_id_${n}`] = unit(party.unison_characters, slot)
        record[`character_${n}_total_damage`] = memberDamage(slot)
        record[`equipment${n}_id`] = equipmentId
        record[`equipment_level_${n}`] = equipment?.level ?? null
        record[`enhancement_level_${n}`] = equipment?.enhancementLevel ?? null
        record[`ability_soul_id_${n}`] = idOrNull(party.ability_soul_ids?.[slot])
    }
    return record
}
