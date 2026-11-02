// Treasure hunt / "collect item" event drops: extra items a cleared battle drops while such an event
// is open (the finish reply's drop_additional_reward_ids), from assets/event_drops.json (built by
// scripts/gen_event_drops.cjs). The rules follow the Chinese fork (lib/additional-reward.ts): every
// open event whose quest range has this quest, and whose first-clear quest is cleared, drops each
// tier at or below the quest's enemy level. Drop boosts and "more drops" campaigns raise the
// number like the score drops (src/lib/rewardCampaign.ts).

import { questInRangeQuery } from "./mission"
import { multipliedDrop } from "./rewardCampaign"
import { withDropAmount } from "../nya/dropSettings"

export interface EventDropGroup {
    index: number
    itemId: number
    number: number
}

export interface EventDropRule {
    eventId: number
    /** Master table dates (UTC). */
    start: string
    end: string
    /** A quest (section, id) to clear before the event's drops start. */
    prerequisite: { section: number, questId: number } | null
    /** Quest range: [range kind, query 1, query 2, query 3] (questInRangeQuery). */
    range: [number, string | null, string | null, string | null]
    /** Lowest enemy level -> drop group, lowest first. */
    thresholds: { level: number, groupId: number }[]
}

export interface EventDropData {
    groups: Record<string, EventDropGroup>
    rules: EventDropRule[]
    /** Section -> quest id -> enemy level. */
    enemyLevels: Record<string, Record<string, number>>
}

/** One drop as the client reads it (data.drop_additional_reward_ids[i]). */
export interface EventDrop {
    group_id: number
    index: number
    number: number
}

const parseDate = (value: string): number | null => {
    const ms = Date.parse(value.replace(" ", "T") + "Z")
    return isNaN(ms) ? null : ms
}

/** The quest's enemy level, or null when the quest has none (no event drops). */
export function questEnemyLevel(data: EventDropData, section: number, questId: number): number | null {
    return data.enemyLevels[String(section)]?.[String(questId)] ?? null
}

/**
 * The event drops of a cleared battle, before anything is given. `isCleared` says whether a quest
 * (section, id) was cleared before; `multiplier` is the score drop multiplier (campaign rate, plus 1
 * with a boost).
 */
export function eventDrops(
    data: EventDropData,
    section: number,
    questId: number,
    serverMs: number,
    isCleared: (section: number, questId: number) => boolean,
    multiplier = 1
): EventDrop[] {
    const level = questEnemyLevel(data, section, questId)
    if (level === null) return []
    const drops: EventDrop[] = []
    for (const rule of data.rules) {
        const start = parseDate(rule.start), end = parseDate(rule.end)
        if (start === null || end === null || serverMs < start || serverMs > end) continue
        if (!questInRangeQuery(rule.range, section, questId)) continue
        if (rule.prerequisite !== null && !isCleared(rule.prerequisite.section, rule.prerequisite.questId)) continue
        for (const threshold of rule.thresholds) {
            if (threshold.level > level) break
            const group = data.groups[String(threshold.groupId)]
            if (group === undefined) continue
            drops.push({ group_id: threshold.groupId, index: group.index, number: multipliedDrop(withDropAmount(group.number), multiplier) })
        }
    }
    return drops
}

/** The items to give for drops: item id -> total. */
export function eventDropItems(data: EventDropData, drops: EventDrop[]): Map<number, number> {
    const items = new Map<number, number>()
    for (const drop of drops) {
        const group = data.groups[String(drop.group_id)]
        if (group !== undefined) items.set(group.itemId, (items.get(group.itemId) ?? 0) + drop.number)
    }
    return items
}
