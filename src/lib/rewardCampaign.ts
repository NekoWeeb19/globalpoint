// Reward campaigns ("2x drops" and similar): the pure rules. The campaigns come from the global
// client's own master table (assets/reward_campaign.json, scripts/gen_campaigns.cjs). The rules follow
// the Chinese fork's docs/systems/reward-campaign.md, worked out from its decompiled client:
// - a campaign applies to the quests in its range while the server date is inside its dates (both ends
//   included); several matching campaigns of one kind don't stack, the highest rate wins;
// - items: the score drops and the rare drop's items are multiplied by (campaign rate + 1 with a
//   boost), rounded down; units and beads aren't multiplied;
// - EXP: the units' battle EXP (rounded up) and the quest's pooled EXP (rounded down);
// - mana: the quest's own mana (rounded down); mana picked up in the field isn't multiplied.

import { questInRangeQuery } from "./mission"

export const REWARD_CAMPAIGN_KINDS = Object.freeze({ ITEMS: 0, EXP: 1, MANA: 2 })

export interface RewardCampaign {
    id: number
    weekly: boolean
    /** UTC, "YYYY-MM-DD hh:mm:ss". */
    start: string
    end: string
    rewardKind: number
    rate: number
    range: [number, string | null, string | null, string | null]
}

export interface CampaignRates {
    items: number
    exp: number
    mana: number
    /** The campaigns that matched, for logs. */
    ids: number[]
}

const masterDate = (text: string): number => Date.parse(text.replace(" ", "T") + "Z")

/**
 * The rates for a quest at a moment (1 when no campaign applies). Weekly campaigns are skipped: the
 * global data has none, and their schedule isn't known well enough to guess.
 */
export function campaignRates(campaigns: readonly RewardCampaign[], nowMs: number, questCategory: number, questId: number): CampaignRates {
    const rates: CampaignRates = { items: 1, exp: 1, mana: 1, ids: [] }
    for (const campaign of campaigns) {
        if (campaign.weekly) continue
        const start = masterDate(campaign.start), end = masterDate(campaign.end)
        if (!(nowMs >= start && nowMs <= end)) continue
        if (!questInRangeQuery(campaign.range, questCategory, questId)) continue
        if (!(campaign.rate >= 1)) continue
        const key = campaign.rewardKind === REWARD_CAMPAIGN_KINDS.ITEMS ? "items"
            : campaign.rewardKind === REWARD_CAMPAIGN_KINDS.EXP ? "exp"
                : campaign.rewardKind === REWARD_CAMPAIGN_KINDS.MANA ? "mana" : null
        if (key === null) continue
        rates[key] = Math.max(rates[key], campaign.rate)
        rates.ids.push(campaign.id)
    }
    return rates
}

/** The item drop multiplier: the campaign's rate, plus 1 with a boost (so 2x campaign + boost is 3x). */
export function itemDropMultiplier(itemRate: number, boosted: boolean): number {
    return itemRate + (boosted ? 1 : 0)
}

/** A drop's count after the multiplier, rounded down (never below the base count). */
export function multipliedDrop(count: number, multiplier: number): number {
    return Math.max(count, Math.floor(count * multiplier))
}
