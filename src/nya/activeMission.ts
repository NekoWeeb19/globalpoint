// Connects the active mission claim logic (src/lib/activeMission.ts) to the real database.

import { activeMissionDataFor } from "./activeMissionData"
import { givePlayerCharacterSync } from "../lib/character"
import { givePlayerEquipmentSync } from "../lib/equipment"
import getDatabase, { Database } from "../data"
import { getPlayerActiveMissionsSync, getPlayerSync, givePlayerItemSync, markPlayerActiveMissionStageReceivedSync, updatePlayerSync } from "../data/wdfpData"
import { ActiveMissionClaimRequest, ActiveMissionClaimResult, ActiveMissionData, ActiveMissionStore, RewardWallet, claimActiveMissions } from "../lib/activeMission"

/**
 * Claims active mission stages for a player and saves the result.
 *
 * @param playerId The ID of the player.
 * @param requests The missions and stages the client asked to claim.
 * @returns The result of the claim, including the new totals to send back to the client.
 */
export function claimPlayerActiveMissionsSync(
    playerId: number,
    requests: ActiveMissionClaimRequest[]
): ActiveMissionClaimResult {
    const player = getPlayerSync(playerId)
    if (player === null) throw new Error("Player does not exist.")

    // Read the saved progress once, then look missions up from it.
    const saved = getPlayerActiveMissionsSync(playerId)

    const store: ActiveMissionStore = {
        getMission(missionId) {
            const mission = saved[String(missionId)]
            if (!mission) return null
            return {
                progress: mission.progress,
                stages: Array.isArray(mission.stages) ? {} : mission.stages
            }
        },
        markStageReceived(missionId, stage, progress) {
            markPlayerActiveMissionStageReceivedSync(playerId, missionId, stage, progress)
        }
    }

    // Running totals, so several rewards of one kind in a single claim add up correctly.
    let freeVmoney = player.freeVmoney
    let freeMana = player.freeMana
    let expPool = player.expPool

    const wallet: RewardWallet = {
        addItem: (itemId, amount) => givePlayerItemSync(playerId, itemId, amount),
        addFreeVmoney: (amount) => {
            freeVmoney += amount
            updatePlayerSync({ id: playerId, freeVmoney })
            return freeVmoney
        },
        addFreeMana: (amount) => {
            freeMana += amount
            updatePlayerSync({ id: playerId, freeMana })
            return freeMana
        },
        addExpPool: (amount) => {
            expPool += amount
            updatePlayerSync({ id: playerId, expPool })
            return expPool
        },
        addCharacter: (characterId) => givePlayerCharacterSync(playerId, characterId)?.character ?? null,
        addEquipment: (equipmentId, amount) => givePlayerEquipmentSync(playerId, equipmentId, amount)
    }

    // one transaction, so a claim is saved in full or not at all (the stage marks and the rewards)
    return getDatabase(Database.WDFP_DATA).transaction(
        () => claimActiveMissions(activeMissionDataFor() as unknown as ActiveMissionData, store, wallet, requests)
    )()
}
