// Event coins the CN app's battles pay differently from global's data.
//
// The server's score drops (assets/score_reward.json, rare_score_reward.json) are global's, with CN's added only for
// groups global doesn't have. For some CN events, CN's shops charge coins those drops never pay (checked against CN's
// master tables, 2026-11-10):
//  - Grand Gauntlet: global's Gauntlet coins 70001-70007 are other items in CN's item table (a holiday box token,
//    Isabadika boss coins, a Golden Week ticket); CN's runs pay 2370001-2370007 (the folder clear rewards have their
//    own CN file: assets/rush_event_quest_folder_cn.json).
//  - Boss events (advent): CN gave its reruns coins of their own (the Flamewing Serpent reruns, the Lightcrest Serpent
//    reruns, Darkbane Serpent, the Thundering Spiritbeast rerun...), but their battles pay from the original run's
//    reward lists, whose coins the original runs' shops still take. Each CN boss event's own coins are in CN's
//    advent_event table (assets/advent_coins_cn.json, scripts/gen_cn_quests.cjs): a coin of another boss event is
//    swapped for this event's coin of the same tier (Silver, Gold, Lilac).
// Only on the CN app; global's app pays global's data as before.

import adventCoinsData from "../../assets/advent_coins_cn.json"
import { inCnRequest } from "./cnClient"
import { QuestCategory } from "./types"

/** boss event id -> its own coins [Silver, Gold, Lilac] */
const adventCoins = adventCoinsData as Record<string, (number | null)[]>
/** coin -> the tier it is in its own event */
const coinTier = new Map<number, number>()
for (const coins of Object.values(adventCoins)) coins.forEach((coin, tier) => { if (coin !== null) coinTier.set(coin, tier) })

/** global's Gauntlet coin -> CN's */
const RUSH_COINS: Readonly<Record<number, number>> = Object.freeze(
    Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(n => [70000 + n, 2370000 + n]))
)

/** The coin swap for a battle's drops on the CN app, or undefined (nothing to swap). */
export function cnCoinSwap(questCategory: number, questId: number): ((itemId: number) => number) | undefined {
    if (!inCnRequest()) return undefined
    if (questCategory === QuestCategory.RUSH_EVENT) return itemId => RUSH_COINS[itemId] ?? itemId
    if (questCategory === QuestCategory.ADVENT_EVENT_SINGLE || questCategory === QuestCategory.ADVENT_EVENT_MULTI) {
        const own = adventCoins[String(Math.floor(questId / 1000))]
        if (own === undefined) return undefined
        return itemId => {
            const tier = coinTier.get(itemId)
            if (tier === undefined || own.includes(itemId)) return itemId
            return own[tier] ?? itemId
        }
    }
    return undefined
}
