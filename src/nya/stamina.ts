// Real stamina: when the dashboard switch "Spend stamina like the real game" is on (.database/server_settings.json,
// off by default), battles cost stamina, retiring gives it back, rank-ups add the new rank's maximum on top, and
// stamina refills over time. The rules are in src/lib/stamina.ts. Off, stamina is never spent (StarPoint's own
// behaviour) and nothing here changes a save.
//
// Costs: the CN app's from the CN game's quest tables (assets/quest_stamina_cn.json), the global app's from global's
// (assets/quest_stamina.json). Stamina campaigns (half cost) on the CN app: the rows the last CN game update shipped,
// saved by scripts/gen_cn_event_schedule.cjs (.database/cn_stamina_campaigns.json), so they match what the game shows
// after event moves and yearly copies. The global app has no campaigns here.

import { existsSync, readFileSync, statSync } from "fs"
import path from "path"
import questStamina from "../../assets/quest_stamina.json"
import questStaminaCn from "../../assets/quest_stamina_cn.json"
import { Player } from "../data/types"
import { getPlayerSync, updatePlayerSync } from "../data/wdfpData"
import { inCnRequest } from "../lib/cnClient"
import { StaminaCampaign, StaminaState, add, campaignRate, costWithRate, currentStamina, recoverySeconds, spend } from "../lib/stamina"
import { epochOf, getServerDate } from "../utils"
import { getRankByPt } from "./player"
import { realStaminaOn } from "./serverSettings"

export { realStaminaOn }

type Costs = Record<string, Record<string, number> | string>

/** A battle's stamina before campaigns. */
function baseCost(category: number, questId: number): number {
    const table = (inCnRequest() ? questStaminaCn : questStamina) as unknown as Costs
    const costs = table[String(category)]
    const cost = typeof costs === "object" ? costs[String(questId)] : undefined
    return typeof cost === "number" && cost > 0 ? cost : 0
}

const CAMPAIGN_FILE = path.join(process.cwd(), ".database", "cn_stamina_campaigns.json")
let campaignCache: { mtimeMs: number, campaigns: StaminaCampaign[] } | null = null
function cnCampaigns(): StaminaCampaign[] {
    try {
        if (!existsSync(CAMPAIGN_FILE)) return []
        const mtimeMs = statSync(CAMPAIGN_FILE).mtimeMs
        if (campaignCache?.mtimeMs !== mtimeMs) {
            const raw = JSON.parse(readFileSync(CAMPAIGN_FILE, "utf8")) as { campaigns?: StaminaCampaign[] }
            campaignCache = { mtimeMs, campaigns: Array.isArray(raw.campaigns) ? raw.campaigns : [] }
        }
        return campaignCache.campaigns
    } catch {
        return []
    }
}

/** A battle's stamina cost now (with a running stamina campaign on the CN app). */
export function questStaminaCostNow(category: number, questId: number): number {
    const cost = baseCost(category, questId)
    if (cost === 0 || !inCnRequest()) return cost
    return costWithRate(cost, campaignRate(cnCampaigns(), category, questId, getServerDate().getTime()))
}

/** The player's rank maximum and seconds per stamina point. */
function rankRules(player: Player) {
    const rank = getRankByPt(player.rankPoint)
    return { max: rank.stamina, seconds: recoverySeconds(rank.stamina_heal_time_decrease_rate) }
}

const stateOf = (player: Player): StaminaState => ({ stamina: player.stamina, healTimeMs: player.staminaHealTime.getTime() })

/** The stamina the game shows now. */
export function currentPlayerStamina(player: Player): number {
    const { max, seconds } = rankRules(player)
    return currentStamina(stateOf(player), getServerDate().getTime(), max, seconds)
}

/** user_info's stamina fields for a reply (the heal time as saved: the game counts the refill from it). */
export function staminaUserInfo(player: Pick<Player, "stamina" | "staminaHealTime">) {
    return { "stamina": player.stamina, "stamina_heal_time": epochOf(player.staminaHealTime) }
}

/** Spends a battle's stamina (real stamina only). null = not enough; otherwise the cost and the new saved values. */
export function spendQuestStaminaSync(playerId: number, category: number, questId: number): { cost: number, stamina: number, staminaHealTime: Date } | null {
    const player = getPlayerSync(playerId)
    if (player === null) return null
    const cost = questStaminaCostNow(category, questId)
    const { max, seconds } = rankRules(player)
    const after = spend(stateOf(player), cost, getServerDate().getTime(), max, seconds)
    if (after === null) return null
    const staminaHealTime = new Date(after.healTimeMs)
    if (cost > 0) updatePlayerSync({ id: playerId, stamina: after.stamina, staminaHealTime })
    return { cost, stamina: after.stamina, staminaHealTime }
}

/** Adds stamina (a retired battle's cost, beads): saved, up to 999. Returns the new saved values. */
export function addStaminaSync(playerId: number, amount: number): { stamina: number, staminaHealTime: Date } | null {
    const player = getPlayerSync(playerId)
    if (player === null) return null
    const { max, seconds } = rankRules(player)
    const after = add(stateOf(player), amount, getServerDate().getTime(), max, seconds)
    const staminaHealTime = new Date(after.healTimeMs)
    updatePlayerSync({ id: playerId, stamina: after.stamina, staminaHealTime })
    return { stamina: after.stamina, staminaHealTime }
}
