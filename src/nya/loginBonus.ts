// Connects the login bonus logic (src/lib/loginBonus.ts) to the real database. Progress per bonus group
// is kept in players_login_bonus (a yearly group's later runs under "<group id>#<year>"). A day's bonuses are paid at /load and stay "pending" (sent with
// every /load) until the client calls /bonus/shown after showing them, so a lost reply can't lose the
// popup, and nothing is paid twice.

import getDatabase, { Database } from "../data"
import { loginBonusDataFor } from "./cnCampaigns"
import { LOGIN_BONUS_REWARD_KINDS, LoginBonusData, loginBonusGroupOfKey, LoginBonusProgress, LoginBonusReward, loginPaidBeads, settleLoginBonus } from "../lib/loginBonus"
import { dailyPaidBeads } from "./serverSettings"
import { getPlayerSync, updatePlayerSync } from "../data/wdfpData"
import { dayNumber } from "../lib/mission"
import { givePlayerRewardsSync } from "../lib/quest"
import { CharacterReward, CurrencyReward, EquipmentItemReward, Reward, RewardType } from "../lib/types"
import { getServerDate } from "../utils"


interface RawLoginBonusRow {
    group_id: string
    last_index: number
    last_day: number
    received_at: number
    shown: number
}

function getRows(playerId: number): RawLoginBonusRow[] {
    return getDatabase(Database.WDFP_DATA).prepare(`
    SELECT group_id, last_index, last_day, received_at, shown FROM players_login_bonus WHERE player_id = ?
    `).all(playerId) as RawLoginBonusRow[]
}

function toReward(reward: LoginBonusReward): Reward | null {
    switch (reward.kind) {
        case LOGIN_BONUS_REWARD_KINDS.BEADS:
            return { type: RewardType.BEADS, count: reward.amount } as CurrencyReward
        case LOGIN_BONUS_REWARD_KINDS.ITEM:
            return reward.id === undefined ? null : { type: RewardType.ITEM, id: reward.id, count: reward.amount } as EquipmentItemReward
        case LOGIN_BONUS_REWARD_KINDS.CHARACTER:
            return reward.id === undefined ? null : { type: RewardType.CHARACTER, id: reward.id } as CharacterReward
        case LOGIN_BONUS_REWARD_KINDS.MANA:
            return { type: RewardType.MANA, count: reward.amount } as CurrencyReward
        case LOGIN_BONUS_REWARD_KINDS.EXP:
            return { type: RewardType.EXP, count: reward.amount } as CurrencyReward
        default:
            return null
    }
}

/**
 * Pays today's login bonuses (if there are any and they weren't paid yet), in one transaction. Call it
 * at /load before the player data is read, so the new totals go out with it.
 *
 * @returns The groups paid now (empty when nothing was due).
 */
export function settleLoginBonusSync(playerId: number, serverMs = getServerDate().getTime(), realMs = Date.now()): string[] {
    const db = getDatabase(Database.WDFP_DATA)
    return db.transaction(() => {
        const progress: Record<string, LoginBonusProgress> = {}
        for (const row of getRows(playerId)) progress[row.group_id] = { lastIndex: row.last_index, lastDay: row.last_day }

        const grants = settleLoginBonus(loginBonusDataFor(), serverMs, dayNumber(realMs), progress)
        if (grants.length === 0) return []

        const rewards = grants.flatMap(grant => grant.rewards.map(toReward).filter((reward): reward is Reward => reward !== null))
        if (rewards.length > 0) givePlayerRewardsSync(playerId, rewards)

        // server addition: paid beads with the everyday bonus (the dashboard's first tab, else LOGIN_BONUS_PAID_BEADS in .env)
        const paidBeads = loginPaidBeads(grants, dailyPaidBeads())
        const player = paidBeads > 0 ? getPlayerSync(playerId) : null
        if (player !== null) updatePlayerSync({ id: playerId, vmoney: player.vmoney + paidBeads })

        // the client shows the batch received at this moment (server time, in seconds)
        const receivedAt = Math.floor(serverMs / 1000)
        const save = db.prepare(`
        INSERT INTO players_login_bonus (group_id, last_index, last_day, received_at, shown, player_id)
        VALUES (?, ?, ?, ?, 0, ?)
        ON CONFLICT (group_id, player_id) DO UPDATE SET
            last_index = excluded.last_index,
            last_day = excluded.last_day,
            received_at = excluded.received_at,
            shown = 0
        `)
        for (const grant of grants) save.run(grant.progressKey, grant.index, dayNumber(realMs), receivedAt, playerId)
        console.log(`[login bonus] Player ${playerId}: ${grants.map(g => `${g.groupId} day ${g.index}`).join(", ")} paid${paidBeads > 0 ? `, plus ${paidBeads} paid beads` : ""}.`)
        return grants.map(grant => grant.groupId)
    })()
}

/**
 * The /load fields for bonuses paid but not shown yet: bonus_index_list (event groups first, then the
 * Normal group, as recorded on the global server) and login_bonus_received_at. null when none.
 */
export function getPendingLoginBonusSync(playerId: number): { bonus_index_list: Object[], login_bonus_received_at: number } | null {
    // a yearly group's later runs are saved as "<group id>#<year>"
    // the CN client also has CN's own groups (src/nya/cnCampaigns.ts)
    const data = loginBonusDataFor()
    const pending = getRows(playerId).filter(row => row.shown === 0).map(row => ({ ...row, group_id: loginBonusGroupOfKey(row.group_id) }))
    if (pending.length === 0) return null
    const receivedAt = Math.max(...pending.map(row => row.received_at))
    const batch = pending.filter(row => row.received_at === receivedAt && data.groups[row.group_id] !== undefined)
    if (batch.length === 0) return null
    batch.sort((a, b) => {
        const normalA = data.groups[a.group_id].type === "Normal" ? 1 : 0
        const normalB = data.groups[b.group_id].type === "Normal" ? 1 : 0
        return normalA - normalB || (data.groups[a.group_id].start < data.groups[b.group_id].start ? -1 : 1)
    })
    return {
        "bonus_index_list": batch.map(row => ({
            "bonus_group_id": row.group_id,
            "bonus_group_type": data.groups[row.group_id].type,
            "index": row.last_index,
        })),
        "login_bonus_received_at": receivedAt,
    }
}

/**
 * Testing aid (the player page's button): forgets that today's login bonus was collected, so the
 * next login (/load) gives the next day of every open bonus. Days already given stay given.
 *
 * @returns Whether a bonus had been collected today (false: the next login gives one anyway).
 */
export function allowLoginBonusAgainSync(playerId: number, realMs = Date.now()): boolean {
    const today = dayNumber(realMs)
    const result = getDatabase(Database.WDFP_DATA).prepare(`
    UPDATE players_login_bonus SET last_day = ? WHERE player_id = ? AND last_day >= ?
    `).run(today - 1, playerId, today)
    if (result.changes > 0) console.log(`[login bonus] Player ${playerId}: today's bonus can be collected again (dashboard).`)
    return result.changes > 0
}

/** /bonus/shown: the client showed the popup, so stop sending the pending batch. */
export function confirmLoginBonusShownSync(playerId: number): void {
    getDatabase(Database.WDFP_DATA).prepare(`UPDATE players_login_bonus SET shown = 1 WHERE player_id = ? AND shown = 0`).run(playerId)
}
