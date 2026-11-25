// CN's "Multi Boss Pick-up" promos (多人领主特选, the co-op boss events; assets/cn_multi_pickup.json from
// scripts/gen_cn_multi_pickup.cjs). The game's text: while a promo runs, co-op battles against the featured boss pay
// boss coins, EXP and mana times the promo's rate (x1.5, x2 or x3). The client shows this from its own tables; the
// server pays it.
//
// Rules, as the CN client reads the tables (BossBattleRepository.getMultiPickupEventSchedulesWithinPeriod,
// AdditionalRewardRepository.getAdditionalRewardKeyByBossBattleMultiPickupByParam):
// - a featured day counts while both its promo's window and its own window hold the moment (ends included);
// - it covers every difficulty of the boss: boss battle quest ids are chapter * 1000000 + node * 1000 + difficulty,
//   the schedule names the chapter and node;
// - solo play of a boss battle gets nothing (only co-op).

import data from "../../assets/cn_multi_pickup.json"

export interface MultiPickupData {
    events: Record<string, { name: string, rate: number, start: string, end: string }>
    schedule: { event: number, chapter: number, node: number, start: string, end: string }[]
}

export interface MultiPickup {
    /** The promo's id (boss_battle_multi_pickup_event). */
    event: number
    rate: number
}

const ms = (text: string): number => Date.parse(text.replace(" ", "T") + "Z")

/** The boss battle quest's (category 2) pick-up promo at a moment, or null when its boss isn't featured. */
export function multiPickupFor(nowMs: number, questId: number, table: MultiPickupData = data as MultiPickupData): MultiPickup | null {
    const chapter = Math.floor(questId / 1000000), node = Math.floor(questId / 1000) % 1000
    let best: MultiPickup | null = null
    for (const day of table.schedule) {
        if (day.chapter !== chapter || day.node !== node) continue
        if (!(ms(day.start) <= nowMs && nowMs <= ms(day.end))) continue
        const event = table.events[String(day.event)]
        if (event === undefined || !(ms(event.start) <= nowMs && nowMs <= ms(event.end))) continue
        if (best === null || event.rate > best.rate) best = { event: day.event, rate: event.rate }
    }
    return best
}
