// The CN game's own campaigns (assets/campaigns_cn.json, scripts/gen_cn_campaigns.cjs) on top of
// global's, for the CN client: CN-only login bonus groups, free pull campaigns of CN-only banners and
// reward campaigns. Shared campaigns (same id in both games) keep global's data, so the event and
// campaign schedules move them the same way for both clients.

import loginBonusData from "../../assets/login_bonus.json"
import cnCampaignData from "../../assets/campaigns_cn.json"
import cnComebackData from "../../assets/cn_comeback_bonuses.json"
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
// CN's own returning-player groups (assets/cn_comeback_bonuses.json, src/nya/comeback.ts) replace global's of the same ids
const cnComebackGroups = (cnComebackData as unknown as { groups: Record<string, LoginBonusGroup> }).groups
// global's groups the CN game's login bonus table doesn't have: sending one stops the CN game at login with C8601
// ("key=goodbye_login": global's end-of-service farewell, 2024-05-28 to 07-25, found 2026-11-24 on the emulator).
// The only one (checked against CN's master/bonus/login_bonus table, whose files never change).
export const GLOBAL_ONLY_LOGIN_GROUPS: readonly string[] = ["goodbye_login"]
const sharedGlobalGroups = Object.fromEntries(Object.entries(globalLogin.groups).filter(([id]) => !GLOBAL_ONLY_LOGIN_GROUPS.includes(id)))
const cnLogin: LoginBonusData = { ...globalLogin, groups: { ...sharedGlobalGroups, ...cnCampaigns.loginBonuses, ...cnComebackGroups } }

/** The login bonus groups for the client making the request. */
export function loginBonusDataFor(): LoginBonusData {
    return inCnRequest() ? cnLogin : globalLogin
}

/**
 * Gives the CN client its own copy of a shared group, on CN's dates (src/nya/campaignSchedule.ts keeps these in
 * step with the yearly schedule); null puts global's group back.
 */
export function setCnLoginGroup(id: string, group: LoginBonusGroup | null) {
    const restored = group ?? cnComebackGroups[id] ?? (GLOBAL_ONLY_LOGIN_GROUPS.includes(id) ? undefined : globalLogin.groups[id])
    if (restored === undefined) delete cnLogin.groups[id]
    else cnLogin.groups[id] = restored
}

/** The group the CN client gets for an id (its CN copy when there is one). */
export function cnLoginGroup(id: string): LoginBonusGroup | undefined {
    return cnLogin.groups[id]
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

let cnSharedRewardRows: RewardCampaign[] | null = null
/** The shared reward campaign rows the CN client uses (global's rows on CN's dates, plus their yearly copies). */
export function setCnSharedRewardRows(rows: readonly { id: number }[]) {
    cnSharedRewardRows = rows as unknown as RewardCampaign[]
}

/** Reward campaigns for the client making the request: global's, plus CN's own for the CN client. */
export function rewardCampaignsFor(globalRows: RewardCampaign[]): RewardCampaign[] {
    // the CN client's shared rows are on CN's dates (with their yearly copies), set by src/nya/campaignSchedule.ts
    return inCnRequest() ? [...(cnSharedRewardRows ?? globalRows), ...cnCampaigns.rewardCampaigns] : globalRows
}
