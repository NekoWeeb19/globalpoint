// The CN game's own campaigns (assets/campaigns_cn.json, scripts/gen_cn_campaigns.cjs) on top of
// global's, for the CN client: CN-only login bonus groups, free pull campaigns of CN-only banners and
// reward campaigns. Shared campaigns (same id in both games) keep global's data, so the event and
// campaign schedules move them the same way for both clients.

import loginBonusData from "../../assets/login_bonus.json"
import cnCampaignData from "../../assets/campaigns_cn.json"
import { LoginBonusData, LoginBonusGroup } from "../lib/loginBonus"
import { RewardCampaign } from "../lib/rewardCampaign"
import { inCnRequest } from "../lib/cnClient"

interface CnCampaigns {
    loginBonuses: Record<string, LoginBonusGroup>
    loginInfo: Record<string, { name: string, start: string | null, end: string | null, days: number, image: string | null }>
    freePulls: { id: number, name: string, kind: number, start: string, end: string, banners: number[], image: string | null }[]
    gachaCampaigns: Record<string, number>
    rewardCampaigns: RewardCampaign[]
    staminaCampaigns: { id: number, weekly: boolean, start: string, end: string, rate: number, range: unknown[] }[]
}

export const cnCampaigns = cnCampaignData as unknown as CnCampaigns

const globalLogin = loginBonusData as LoginBonusData
// the same group objects as global's (the schedules change those in place), plus CN's own
const cnLogin: LoginBonusData = { ...globalLogin, groups: { ...globalLogin.groups, ...cnCampaigns.loginBonuses } }

/** The login bonus groups for the client making the request. */
export function loginBonusDataFor(): LoginBonusData {
    return inCnRequest() ? cnLogin : globalLogin
}

/** The CN-only login bonus groups (changed in place by the yearly campaign schedule). */
export function cnOnlyLoginGroups(): Record<string, LoginBonusGroup> {
    return cnCampaigns.loginBonuses
}

/** The free pull campaign of a banner only CN has a free pull for, for CN requests; null otherwise. */
export function cnGachaCampaignId(gachaId: number | string): number | null {
    if (!inCnRequest()) return null
    return cnCampaigns.gachaCampaigns[String(gachaId)] ?? null
}

/** Reward campaigns for the client making the request: global's, plus CN's own for the CN client. */
export function rewardCampaignsFor(globalRows: RewardCampaign[]): RewardCampaign[] {
    return inCnRequest() ? [...globalRows, ...cnCampaigns.rewardCampaigns] : globalRows
}
