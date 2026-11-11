// Co-op rescue rewards, from the Chinese fork (src/lib/rescue-fragment-content.ts, src/multi/rescue-fragment-reward.ts).
// In the live game, joining someone else's co-op battle as a backup ("rescue") paid 10 nuggets per clear, the currency
// of many event exchanges. Co-op here is hosted with COM partners, so every cleared co-op battle stands in for a rescue:
//  - 10 Silver, Gold or Lilac Nuggets (which one depends on the quest, below);
//  - a count for the "Clear N battles as a backup" missions (src/lib/mission.ts RESCUE_CLEAR).
// On by default; the switch is on the dashboard's Game settings tab (src/nya/serverSettings.ts rescueRewards).
// CN app only: the nuggets are the CN client's items.

import adventEventQuests from "../../assets/advent_event_quest.json"
import bossBattleQuests from "../../assets/boss_battle_quest.json"
import hardMultiEventQuests from "../../assets/hard_multi_event_quest.json"
import raidEventQuests from "../../assets/raid_event_quest.json"
import worldStoryEventBossBattleQuests from "../../assets/world_story_event_boss_battle_quest.json"
import questOverridesCn from "../../assets/quest_overrides_cn.json"
import { QuestCategory } from "../lib/types"

export const SILVER_NUGGET = 49000
export const GOLD_NUGGET = 49001
export const LILAC_NUGGET = 49002
export const NUGGETS_PER_CLEAR = 10

type QuestTable = Record<string, { rankPointReward?: number }>

/** The battle quests of a table by group (quest id / 1,000), each group in id order. */
function groups(table: QuestTable): number[][] {
    const byGroup = new Map<number, number[]>()
    for (const [rawId, quest] of Object.entries(table)) {
        const id = Number(rawId)
        if (!Number.isSafeInteger(id) || quest.rankPointReward === undefined) continue
        const group = Math.floor(id / 1000)
        byGroup.set(group, [...(byGroup.get(group) ?? []), id])
    }
    return [...byGroup.values()].map(ids => ids.sort((a, b) => a - b))
}

function buildMap(category: number): Map<number, number> {
    const map = new Map<number, number>()
    if (category === QuestCategory.BOSS_BATTLE) {
        // by difficulty (the id's last part); the first boss has three tiers, boss 1020 two
        for (const ids of groups(bossBattleQuests as QuestTable)) {
            const boss = Math.floor(ids[0] / 1000)
            for (const id of ids) {
                const difficulty = id % 1000
                map.set(id, boss === 1001 ? (difficulty === 1 ? SILVER_NUGGET : difficulty === 2 ? GOLD_NUGGET : LILAC_NUGGET)
                    : boss === 1020 ? (difficulty === 1 ? SILVER_NUGGET : GOLD_NUGGET)
                    : difficulty <= 2 ? SILVER_NUGGET : difficulty === 3 ? GOLD_NUGGET : LILAC_NUGGET)
            }
        }
    } else if (category === QuestCategory.ADVENT_EVENT_MULTI) {
        // by the quest's place in its event: harder quests pay better nuggets
        // the CN app's own quests where an event number means another event in global
        const advent = { ...(adventEventQuests as QuestTable), ...((questOverridesCn as Record<string, QuestTable>).advent_event_quest ?? {}) }
        for (const ids of groups(advent)) {
            ids.forEach((id, index) => map.set(id, ids.length <= 2 ? (index === 0 ? SILVER_NUGGET : GOLD_NUGGET)
                : ids.length === 3 ? [SILVER_NUGGET, GOLD_NUGGET, LILAC_NUGGET][index]
                : index <= 1 ? SILVER_NUGGET : index === 2 ? GOLD_NUGGET : LILAC_NUGGET))
        }
    } else if (category === QuestCategory.WORLD_STORY_EVENT_BOSS_BATTLE) {
        for (const ids of groups(worldStoryEventBossBattleQuests as QuestTable)) {
            ids.forEach((id, index) => map.set(id, index % 2 === 0 ? SILVER_NUGGET : GOLD_NUGGET))
        }
    } else if (category === QuestCategory.RAID_EVENT) {
        // by the quest's rank points (its difficulty)
        for (const [rawId, quest] of Object.entries(raidEventQuests as QuestTable)) {
            const id = Number(rawId)
            if (!Number.isSafeInteger(id) || quest.rankPointReward === undefined) continue
            map.set(id, quest.rankPointReward <= 50 ? SILVER_NUGGET : quest.rankPointReward < 100 ? GOLD_NUGGET : LILAC_NUGGET)
        }
    } else if (category === QuestCategory.HARD_MULTI_EVENT) {
        for (const rawId of Object.keys(hardMultiEventQuests as QuestTable)) {
            const id = Number(rawId)
            if (Number.isSafeInteger(id)) map.set(id, LILAC_NUGGET)
        }
    }
    return map
}

const maps = new Map<number, Map<number, number>>()

/** The nugget a cleared co-op battle of this quest pays, or null (a quest with no rescue reward). */
export function rescueNugget(category: number, questId: number): number | null {
    // single-player advent quests are the same quests as the co-op ones
    const key = category === QuestCategory.ADVENT_EVENT_SINGLE ? QuestCategory.ADVENT_EVENT_MULTI : category
    let map = maps.get(key)
    if (map === undefined) { map = buildMap(key); maps.set(key, map) }
    return map.get(Math.abs(Math.trunc(questId))) ?? null
}
