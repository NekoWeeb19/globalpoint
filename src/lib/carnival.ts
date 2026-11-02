// Core logic for Hanifolk Carnival (quest category 22): scoring a clear, keeping the best score of
// each folder, and the total-score rewards.
//
// This file has no imports on purpose, so it can be tested without the database
// (scripts/test_carnival.mjs). src/nya/carnival.ts connects it to the real database.
//
// The rules follow the Chinese StarPoint fork (lib/quest/finish/carnival-handler.ts), with the data
// from the global client's own tables (scripts/gen_carnival.cjs):
// - A clear scores the stage's difficulty score plus a time bonus: the time limit minus the clear
//   time, in milliseconds, never below 0.
// - Each folder (one per element) keeps its best score. The event's total is the sum of those bests.
// - A total-score reward is paid once, when the total reaches its score.

export interface CarnivalQuest {
    eventId: number
    folderId: number
    difficultyScore: number
    timeLimitMs: number
}

export interface CarnivalRewardSlot {
    /** 0 item, 1 armament, 2 beads, 3 mana, 4 exp, 6 title. */
    kind: number
    id?: number
    amount: number
}

export interface CarnivalReward {
    eventId: number
    name: string
    score: number
    reasonId: number
    rewards: CarnivalRewardSlot[]
}

export interface CarnivalData {
    quests: Record<string, CarnivalQuest>
    rewards: Record<string, CarnivalReward>
}

/** A folder's saved record. */
export interface CarnivalRecord {
    folderId: number
    bestScore: number
}

export interface CarnivalScore {
    difficultyBonus: number
    timeBonus: number
    total: number
}

export const CARNIVAL_REWARD_KINDS = Object.freeze({
    ITEM: 0,
    EQUIPMENT: 1,
    BEADS: 2,
    MANA: 3,
    EXP: 4,
    TITLE: 6,
})

export function getCarnivalQuest(data: CarnivalData, questId: number): CarnivalQuest | null {
    return data.quests[String(questId)] ?? null
}

/** Scores a clear. A clear time that isn't a usable number gets no time bonus. */
export function scoreCarnivalClear(quest: CarnivalQuest, clearTimeMs: unknown): CarnivalScore {
    const time = typeof clearTimeMs === "number" && Number.isFinite(clearTimeMs) && clearTimeMs >= 0
        ? Math.round(clearTimeMs)
        : quest.timeLimitMs
    const timeBonus = Math.max(0, quest.timeLimitMs - time)
    return { difficultyBonus: quest.difficultyScore, timeBonus, total: quest.difficultyScore + timeBonus }
}

/** The event's total: the sum of every folder's best score. */
export function carnivalTotalBestScore(records: CarnivalRecord[]): number {
    return records.reduce((sum, record) => sum + Math.max(0, record.bestScore), 0)
}

export interface CarnivalClearResult {
    eventId: number
    folderId: number
    score: CarnivalScore
    /** The folder's best after this clear. */
    folderBestScore: number
    previousTotalBestScore: number
    totalBestScore: number
    /** Rewards reached and not paid before, in order of score. */
    rewardIds: number[]
    /**
     * The "previous total" to send the client. The client works out which reward rows to show from
     * the previous and the new total, so when a reward below the old total is paid now (it wasn't
     * paid before), the previous total is lowered to just under it (the Chinese fork does the same).
     */
    popupPreviousTotalBestScore: number
}

/**
 * Works out a carnival clear. It changes nothing: the caller saves the folder's best and pays the
 * rewards.
 *
 * @returns null when the quest isn't a carnival quest.
 */
export function settleCarnivalClear(
    data: CarnivalData,
    questId: number,
    clearTimeMs: unknown,
    records: CarnivalRecord[],
    paidRewardIds: Set<number>
): CarnivalClearResult | null {
    const quest = getCarnivalQuest(data, questId)
    if (quest === null) return null

    const score = scoreCarnivalClear(quest, clearTimeMs)
    const previousTotalBestScore = carnivalTotalBestScore(records)
    const previousFolderBest = records.find(record => record.folderId === quest.folderId)?.bestScore ?? 0
    const folderBestScore = Math.max(previousFolderBest, score.total)
    const totalBestScore = previousTotalBestScore - Math.max(0, previousFolderBest) + folderBestScore

    const reached = Object.entries(data.rewards)
        .map(([id, reward]) => ({ id: Number(id), reward }))
        .filter(({ id, reward }) => reward.eventId === quest.eventId && reward.score <= totalBestScore && !paidRewardIds.has(id))
        .sort((a, b) => a.reward.score - b.reward.score || a.id - b.id)

    const backfilled = reached.filter(({ reward }) => reward.score <= previousTotalBestScore).map(({ reward }) => reward.score)
    const popupPreviousTotalBestScore = backfilled.length > 0
        ? Math.min(previousTotalBestScore, Math.min(...backfilled) - 1)
        : previousTotalBestScore

    return {
        eventId: quest.eventId,
        folderId: quest.folderId,
        score,
        folderBestScore,
        previousTotalBestScore,
        totalBestScore,
        rewardIds: reached.map(({ id }) => id),
        popupPreviousTotalBestScore,
    }
}
