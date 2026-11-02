// The active mission data for the client making the request: global's step-up missions
// (assets/active_missions.json), plus, for the CN client, its unit awake missions
// (assets/mana_awake_cn.json, scripts/gen_cn_mana_awake.cjs), which the CN client lists and claims
// like the other active missions.

import { readFileSync, statSync } from "fs"
import path from "path"
import activeMissionData from "../../assets/active_missions.json"
import { inCnRequest } from "../lib/cnClient"
import { PATTERN, type AwakeRule } from "../lib/activeMissionProgress"

const GUIDE_FILE = path.join(__dirname, "..", "..", "assets", "contents_guide_cn.json")
interface GuideMission { name: string, text: string, rule: AwakeRule, requirements: Record<string, number>, stages: Record<string, { type: string, id?: number, amount: number }[]>, prerequisite?: { mission: number, stage: number } }
let guideCache: { missions: Record<string, GuideMission> } | null = null
function contentsGuideData(): { missions: Record<string, GuideMission> } {
    if (guideCache === null) {
        try { guideCache = JSON.parse(readFileSync(GUIDE_FILE, "utf8")) } catch { guideCache = { missions: {} } }
    }
    return guideCache!
}

export interface AwakeMission {
    name: string
    text: string
    rule: AwakeRule
    requirements: Record<string, number>
    stages: Record<string, { type: string, id?: number, amount: number }[]>
    /** what finishing it unlocks: awake level of a unit's board */
    unlock?: { character: number, board: number, level: number }
}
export interface ManaAwakeData {
    units: Record<string, { rarity: number, races: string[] }>
    nodes: Record<string, Record<string, { slot: number, pedestal: number }>>
    costs: Record<string, Record<string, Record<string, { items: Record<string, number>, mana: number }>>>
    missions: Record<string, AwakeMission>
}

const AWAKE_FILE = path.join(__dirname, "..", "..", "assets", "mana_awake_cn.json")
let awakeCache: { mtimeMs: number, data: ManaAwakeData } | null = null
export function manaAwakeData(): ManaAwakeData | null {
    try {
        const mtimeMs = statSync(AWAKE_FILE).mtimeMs
        if (awakeCache === null || awakeCache.mtimeMs !== mtimeMs) awakeCache = { mtimeMs, data: JSON.parse(readFileSync(AWAKE_FILE, "utf8")) }
        return awakeCache.data
    } catch {
        return null
    }
}

// CN mission kind -> the pattern the active mission code counts it with (src/lib/activeMissionProgress.ts)
const AWAKE_PATTERN: Record<number, number> = { 93: 1093, 94: 1093, 95: 1093, 23: 1093, 15: 1093, 28: 1093, 30: 1093, 96: 1096, 48: 1048, 2: 1002, 21: 21 }

const globalData = activeMissionData as unknown as Record<string, any>
let cnCache: { source: ManaAwakeData, data: Record<string, any> } | null = null

/** The active mission data (requirements, missions, patterns, targets, ...) for this request. */
export function activeMissionDataFor(): Record<string, any> {
    if (!inCnRequest()) return globalData
    const awake = manaAwakeData()
    if (awake === null) return globalData
    if (cnCache?.source === awake) return cnCache.data
    const data = {
        ...globalData,
        requirements: { ...globalData.requirements },
        missions: { ...globalData.missions },
        patterns: { ...globalData.patterns },
        targets: { ...globalData.targets },
        awakeRules: {} as Record<string, AwakeRule>,
        prerequisites: {} as Record<string, { mission: number, stage: number }>,
    }
    for (const [id, mission] of Object.entries(awake.missions)) {
        data.requirements[id] = mission.requirements
        data.missions[id] = { name: mission.name, title: mission.text, group: "Awake", stages: mission.stages }
        if (mission.rule.kind === 13) data.targets[id] = mission.rule.list ?? []
        else if (AWAKE_PATTERN[mission.rule.kind] !== undefined) data.patterns[id] = AWAKE_PATTERN[mission.rule.kind]
        data.awakeRules[id] = mission.rule
    }
    // the Content Guide (CN active mission event 2, assets/contents_guide_cn.json from
    // scripts/gen_cn_contents_guide.cjs): its first mission is done when the guide is opened
    // (contents_guide/start, src/routes/api/cn.ts); the others are battle rules (awakeBattleMatches)
    for (const [id, mission] of Object.entries(contentsGuideData().missions)) {
        data.requirements[id] = mission.requirements
        data.missions[id] = { name: mission.name, title: mission.text, group: "ContentsGuide", stages: mission.stages }
        data.patterns[id] = mission.rule.kind === 74 ? PATTERN.CONTENTS_GUIDE_START : PATTERN.AWAKE_BATTLE
        data.awakeRules[id] = mission.rule
        if (mission.prerequisite) data.prerequisites[id] = mission.prerequisite
    }
    cnCache = { source: awake, data }
    return data
}
