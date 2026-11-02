// Core logic for Raid Event: Sagas of Conquest (quest category 23): the raid boss's progress and the
// kill-count rewards.
//
// This file has no imports on purpose, so it can be tested without the database
// (scripts/test_raid.mjs). src/nya/raid.ts connects it to the real database.
//
// The rules follow the Chinese StarPoint fork (lib/quest/finish/raid-handler.ts,
// lib/quest/finish/raid-overall-rewards.ts), with the data from the global client (scripts/gen_raid.cjs):
// - Each cleared raid stage adds its kill weight to the boss. Reaching the required kill count is one
//   boss kill: the total kill count goes up and the boss's HP refills.
// - Rewards are paid for every threshold the total kill count passed since the last payout.
//
// On the live server the whole player base filled the required kill count (100,000,000 for raid 2).
// Here one player does, so a boss kill takes the hardest stage's weight times clearsPerKill.

export interface RaidEvent {
    code: string
    /** The global, whole-server value. Not used for solo play. */
    requiredKillCount: number
    start: string | null
    battleEnd: string | null
    end: string | null
}

export interface RaidQuest {
    eventId: number
    killWeight: number
}

export type RaidRewardRequirement =
    | { type: "total", threshold: number }
    | { type: "each", start?: number, interval: number }

export interface RaidRewardSlot {
    /** 0 item, 2 beads, 3 mana. */
    kind: number
    itemId?: number
    amount: number
}

export interface RaidReward {
    eventId: number
    requirement: RaidRewardRequirement
    rewards: RaidRewardSlot[]
}

export interface RaidData {
    events: Record<string, RaidEvent>
    quests: Record<string, RaidQuest>
    rewards: Record<string, RaidReward>
}

export interface RaidBossState {
    /** Progress towards the next boss kill. */
    weightedKillCount: number
    totalKillCount: number
}

export function getRaidQuest(data: RaidData, questId: number): RaidQuest | null {
    return data.quests[String(questId)] ?? null
}

/** The kill weight one boss kill takes when playing alone: the hardest stage's weight times clearsPerKill. */
export function soloRequiredKillCount(data: RaidData, eventId: number, clearsPerKill: number): number | null {
    const weights = Object.values(data.quests).filter(q => q.eventId === eventId).map(q => q.killWeight)
    if (weights.length === 0) return null
    const clears = Number.isFinite(clearsPerKill) && clearsPerKill > 0 ? clearsPerKill : 1
    return Math.max(1, Math.round(Math.max(...weights) * clears))
}

/** Adds a clear to the boss. Weight past a kill carries over to the next one. */
export function advanceRaidBoss(state: RaidBossState, killWeight: number, requiredKillCount: number): RaidBossState {
    let weighted = state.weightedKillCount + killWeight
    let total = state.totalKillCount
    while (weighted >= requiredKillCount) {
        weighted -= requiredKillCount
        total++
    }
    return { weightedKillCount: weighted, totalKillCount: total }
}

/** The boss's HP left, in percent with one decimal (the Chinese fork's rounding). */
export function raidBossHpPercentage(state: RaidBossState, requiredKillCount: number): number {
    return Math.ceil((1 - state.weightedKillCount / requiredKillCount) * 1000) / 10
}

export interface RaidRewardGrant {
    rewardId: number
    kind: number
    itemId?: number
    amount: number
}

/** The rewards due for going from previousTotal to newTotal boss kills (the Chinese fork's rules). */
export function selectRaidRewards(data: RaidData, eventId: number, previousTotal: number, newTotal: number): RaidRewardGrant[] {
    if (newTotal <= previousTotal) return []
    const grants: RaidRewardGrant[] = []
    const add = (rewardId: number, reward: RaidReward, times: number) => {
        if (times <= 0) return
        for (const slot of reward.rewards) grants.push({ rewardId, kind: slot.kind, ...(slot.itemId === undefined ? {} : { itemId: slot.itemId }), amount: slot.amount * times })
    }
    const entries = Object.entries(data.rewards)
        .map(([id, reward]) => ({ id: Number(id), reward }))
        .filter(({ reward }) => reward.eventId === eventId)

    const totals = entries.filter(({ reward }) => reward.requirement.type === "total")
        .sort((a, b) => (a.reward.requirement as { threshold: number }).threshold - (b.reward.requirement as { threshold: number }).threshold || a.id - b.id)
    for (const { id, reward } of totals) {
        const threshold = (reward.requirement as { threshold: number }).threshold
        if (threshold > previousTotal && threshold <= newTotal) add(id, reward, 1)
    }
    for (const { id, reward } of entries) {
        const requirement = reward.requirement
        if (requirement.type !== "each") continue
        // no first count: paid for every kill (raids 4 and 5 give mana and Wrightpieces this way)
        if (requirement.start === undefined) {
            add(id, reward, newTotal - previousTotal)
            continue
        }
        if (!(requirement.interval > 0)) continue
        let times = 0
        for (let at = requirement.start; at <= newTotal; at += requirement.interval) if (at > previousTotal) times++
        add(id, reward, times)
    }
    return grants
}

/** A reward as the reply's reward_list shows it (item 1, beads 3, mana 8, as in the Chinese fork). */
export function raidRewardListEntry(grant: RaidRewardGrant): { kind: number, kind_id: number, number: number } {
    if (grant.kind === 0) return { kind: 1, kind_id: grant.itemId ?? 0, number: grant.amount }
    if (grant.kind === 3) return { kind: 8, kind_id: 0, number: grant.amount }
    return { kind: 3, kind_id: 0, number: grant.amount }
}
