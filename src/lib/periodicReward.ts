// Hard Multi "Daily Reward Count": each Hard Multi event has a point counter (the load reply's
// user_periodic_reward_point_list). Each cleared battle of the event spends one point and drops its
// bonus item (the finish reply's drop_periodic_reward_ids); points are added at every daily reset, up
// to a maximum. Data: assets/periodic_reward.json (scripts/gen_hard_multi.cjs). The rules follow the
// Chinese fork (lib/quest/finish/periodic-reward-handler.ts and data/domains/campaign.ts).

export interface PeriodicPointDefinition {
    maxPoint: number
    /** Points added at each daily reset (and the starting amount). */
    recoveryPoint: number
    /** 0: refilled at each daily reset. Other cycles aren't used on global. */
    recoveryCycle: number
    start: string | null
    end: string | null
}

export interface PeriodicRewardEntry {
    itemId: number
    count: number
    probability: number
}

export interface PeriodicRewardData {
    /** Hard Multi event -> its point id. */
    events: Record<string, { pointId: number }>
    points: Record<string, PeriodicPointDefinition>
    /** Group -> index -> reward. */
    groups: Record<string, Record<string, PeriodicRewardEntry>>
    /** Quest -> its reward group and slots. */
    quests: Record<string, { groupId: number, slots: number }>
}

export interface PeriodicPoint {
    id: number
    point: number
}

/** One drop as the client reads it (data.drop_periodic_reward_ids[i]). */
export interface PeriodicDrop {
    group_id: number
    index: number
    number: number
}

/**
 * The point list after a /load: every point kind is there (a new one starts at its daily amount), and
 * when a new real day has begun since the last refill, each daily point gets its amount, up to the
 * maximum. `lastDay` is null the first time (nothing is added on top of the starting amounts).
 */
export function refillPeriodicPoints(data: PeriodicRewardData, stored: PeriodicPoint[], lastDay: number | null, today: number): PeriodicPoint[] {
    const byId = new Map(stored.map(entry => [entry.id, entry.point]))
    const refill = lastDay !== null && today > lastDay
    for (const [id, definition] of Object.entries(data.points)) {
        const pointId = Number(id)
        const current = byId.get(pointId)
        if (current === undefined) {
            byId.set(pointId, Math.min(definition.recoveryPoint, definition.maxPoint))
        } else if (refill && definition.recoveryCycle === 0) {
            byId.set(pointId, Math.max(current, Math.min(definition.maxPoint, current + definition.recoveryPoint)))
        }
    }
    return [...byId].sort((a, b) => a[0] - b[0]).map(([id, point]) => ({ id, point }))
}

/** The point a Hard Multi quest spends, or null (no bonus drop for it). */
export function questPointId(data: PeriodicRewardData, questId: number): number | null {
    const quest = data.quests[String(questId)]
    if (quest === undefined || quest.slots <= 0) return null
    return data.events[String(Math.floor(questId / 1000))]?.pointId ?? null
}

/**
 * Picks a quest's bonus drop, as the Chinese fork does: each reward passes its own probability roll,
 * then one of those is picked by weight. Null when nothing passes (or the quest has no group).
 */
export function pickPeriodicDrop(data: PeriodicRewardData, questId: number, random: () => number = Math.random): { drop: PeriodicDrop, itemId: number } | null {
    const quest = data.quests[String(questId)]
    const group = quest === undefined ? undefined : data.groups[String(quest.groupId)]
    if (quest === undefined || group === undefined) return null
    const passed: { index: number, entry: PeriodicRewardEntry, upTo: number }[] = []
    let total = 0
    for (const [index, entry] of Object.entries(group).sort((a, b) => Number(a[0]) - Number(b[0]))) {
        if (random() >= entry.probability) continue
        total += entry.probability
        passed.push({ index: Number(index), entry, upTo: total })
    }
    if (passed.length === 0) return null
    const roll = random() * total
    const picked = passed.find(candidate => roll <= candidate.upTo) ?? passed[passed.length - 1]
    return { drop: { group_id: quest.groupId, index: picked.index, number: picked.entry.count }, itemId: picked.entry.itemId }
}
