// Core logic for /active_mission/receive.
//
// This file has no imports on purpose. Everything it needs from the database comes in through
// the `ActiveMissionStore` and `RewardWallet` interfaces, so the logic can be tested without
// better-sqlite3 (see scripts/test_active_mission.mjs). src/nya/activeMission.ts connects it to
// the real database.

export type ActiveMissionRewardType = "item" | "free_vmoney" | "free_mana" | "exp_pool" | "character" | "equipment"

export interface ActiveMissionReward {
    type: ActiveMissionRewardType
    /** The item id ("item") or unit id ("character"). */
    id?: number
    amount: number
}

export interface ActiveMissionDefinition {
    name: string
    title: string
    group: string
    /** Stage number -> the rewards for claiming that stage. */
    stages: Record<string, ActiveMissionReward[]>
}

export interface ActiveMissionData {
    missions: Record<string, ActiveMissionDefinition>
}

export interface ActiveMissionClaimRequest {
    mission_id: number
    stages: number[]
}

/** What the database side has to provide. */
export interface ActiveMissionStore {
    /** The player's saved progress for a mission, or null if they have no row for it. */
    getMission(missionId: number): { progress: number, stages: Record<string, boolean> } | null
    /** Saves the stage as received, creating the mission row first if needed. */
    markStageReceived(missionId: number, stage: number, progress: number): void
}

/** What the player's account has to provide. Every method returns the NEW total. */
export interface RewardWallet {
    addItem(itemId: number, amount: number): number
    addFreeVmoney(amount: number): number
    addFreeMana(amount: number): number
    addExpPool(amount: number): number
    /** Gives a unit; returns its entry for the reply's character_list (or null if it couldn't be given). */
    addCharacter(characterId: number): object | null
    /** Gives armaments; returns the armament's entry for the reply's equipment_list. */
    addEquipment(equipmentId: number, amount: number): object
}

export interface ActiveMissionClaimResult {
    active_mission_list: {
        mission_id: number
        progress_value: number
        stages: { stage: number, received: boolean }[]
    }[]
    /** Only the totals that changed. */
    user_info: { free_vmoney?: number, free_mana?: number, exp_pool?: number }
    /** The player's new TOTAL of each item that was given (not the amount given). */
    item_list: Record<string, number>
    /** Stages that were asked for but skipped, with the reason. For logging only. */
    skipped: { mission_id: number, stage: number, reason: string }[]
    /** True if exp_pool changed, so the caller can add exp_pooled_time. */
    expChanged: boolean
    /** Units that were given ("character" rewards). */
    character_list?: object[]
    joined_character_id_list?: number[]
    /** Armaments that were given ("equipment" rewards). */
    equipment_list?: object[]
}

/**
 * Handles a list of claims.
 *
 * - A stage that is in the data and not yet received is marked received and its rewards are given.
 * - A stage that was already received gives nothing but is still reported as received, so claiming
 *   twice (a retry, a double tap) never pays twice.
 * - A mission or stage that is not in the data is skipped and left out of the response. The client
 *   will keep showing it as unclaimed, which is better than guessing a reward.
 */
export function claimActiveMissions(
    data: ActiveMissionData,
    store: ActiveMissionStore,
    wallet: RewardWallet,
    requests: ActiveMissionClaimRequest[]
): ActiveMissionClaimResult {
    const result: ActiveMissionClaimResult = {
        active_mission_list: [],
        user_info: {},
        item_list: {},
        skipped: [],
        expChanged: false,
    }

    // stages claimed during this request, so listing a stage twice (even in two entries) pays once
    const claimedNow = new Set<string>()

    for (const request of requests) {
        const missionId = Number(request?.mission_id)
        const definition = Number.isInteger(missionId) ? data.missions[String(missionId)] : undefined
        const requestedStages = Array.isArray(request?.stages) ? request.stages : []

        if (!definition) {
            for (const stage of requestedStages) {
                result.skipped.push({ mission_id: missionId, stage: Number(stage), reason: "mission is not in the data" })
            }
            continue
        }

        const saved = store.getMission(missionId)
        // The game only reported progress 1 or 2 in the recording, and nothing here tracks real
        // progress yet, so a mission without a saved row reports 1.
        const progress = Math.max(saved?.progress ?? 0, 1)
        const entry = { mission_id: missionId, progress_value: progress, stages: [] as { stage: number, received: boolean }[] }

        for (const rawStage of new Set(requestedStages.map(Number))) {
            const rewards = Number.isInteger(rawStage) ? definition.stages[String(rawStage)] : undefined
            if (!rewards) {
                result.skipped.push({ mission_id: missionId, stage: rawStage, reason: "stage is not in the data" })
                continue
            }

            const claimKey = `${missionId}:${rawStage}`
            if (!saved?.stages?.[String(rawStage)] && !claimedNow.has(claimKey)) {
                claimedNow.add(claimKey)
                store.markStageReceived(missionId, rawStage, progress)
                for (const reward of rewards) giveReward(wallet, reward, result)
            }
            entry.stages.push({ stage: rawStage, received: true })
        }

        if (entry.stages.length > 0) result.active_mission_list.push(entry)
    }

    return result
}

function giveReward(wallet: RewardWallet, reward: ActiveMissionReward, result: ActiveMissionClaimResult) {
    switch (reward.type) {
        case "item":
            if (reward.id === undefined) throw new Error("Item reward without an id.")
            result.item_list[String(reward.id)] = wallet.addItem(reward.id, reward.amount)
            break
        case "free_vmoney":
            result.user_info.free_vmoney = wallet.addFreeVmoney(reward.amount)
            break
        case "free_mana":
            result.user_info.free_mana = wallet.addFreeMana(reward.amount)
            break
        case "exp_pool":
            result.user_info.exp_pool = wallet.addExpPool(reward.amount)
            result.expChanged = true
            break
        case "character": {
            if (reward.id === undefined) throw new Error("Character reward without an id.")
            const entry = wallet.addCharacter(reward.id)
            if (entry !== null) {
                (result.character_list ??= []).push(entry);
                (result.joined_character_id_list ??= []).push(reward.id)
            }
            break
        }
        case "equipment":
            if (reward.id === undefined) throw new Error("Equipment reward without an id.")
            ;(result.equipment_list ??= []).push(wallet.addEquipment(reward.id, reward.amount))
            break
        default:
            throw new Error(`Unknown active mission reward type: ${(reward as { type: string }).type}`)
    }
}
