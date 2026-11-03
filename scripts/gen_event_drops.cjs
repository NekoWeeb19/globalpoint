// Builds assets/event_drops.json (the extra items treasure hunt / "collect item" events drop in
// battles: the client's drop_additional_reward_ids) from the global client's own master tables
// (see scripts/cdn_master.cjs). The rules follow the Chinese fork (content/converters/additional-reward.ts).
//
//   node scripts/gen_event_drops.cjs
//
// Tables (the global layouts are the Chinese fork's):
//   master/reward/event/additional_reward                  group -> index -> string id, type (0 item), item id, number, weight
//   master/reward/event/collect_item_event                 event -> 28 columns; 20/21 open from/until, 23..26 quest to clear first
//   master/reward/event/collect_item_event_quest_relation  event -> sequence -> sequence id, range kind, 3 range queries, reward id
//   master/reward/event/collect_item_event_reward_relation reward id -> lowest enemy level -> number, string id, group
// The quest's enemy level picks the tiers: every tier at or below it drops. Enemy levels come from
// the quest tables (columns below, the Chinese fork's quest layouts, checked against global values);
// the Kaleidoscope quests have no such column, so their level is read from their name ("... Lv 30");
// the 18 "Labyrinth: Beginner/Inter./Adv." quests have none, so they drop no event items.
// The co-op boss pickup schedules (master/quest/boss_battle/...) have no drop groups on global.

const path = require("path")
const fs = require("fs")
const { ROOT, readTable, readRows, parseCsvLine, str, int } = require("./cdn_master.cjs")

// MASTER_SOURCE=cn (scripts/cdn_master.cjs): the CN client's tables, written to assets/event_drops_cn.json; CN's
// dates are China time (UTC+8) and are written as UTC like global's
const CN = process.env.MASTER_SOURCE === "cn"
const OUT = path.join(ROOT, "assets", CN ? "event_drops_cn.json" : "event_drops.json")
const toUtc = text => {
    if (!CN) return text
    const ms = Date.parse(text.replace(" ", "T") + "+08:00")
    return isNaN(ms) ? text : new Date(ms).toISOString().slice(0, 19).replace("T", " ")
}

// quest table -> [section (QuestCategory), nesting depth, enemy level column | "name" + name column]
const QUEST_TABLES = {
    "master/quest/main_quest.orderedmap": [1, 3, 106],
    "master/quest/boss_battle_quest.orderedmap": [2, 3, 106],
    "master/quest/ex_quest.orderedmap": [4, 3, 106],
    "master/quest/event/daily_week_event_quest.orderedmap": [6, 2, "name", 1],
    "master/quest/event/advent_event_quest.orderedmap": [7, 2, 110],
    "master/quest/event/story_event_single_quest.orderedmap": [10, 2, 108],
    "master/quest/event/challenge_dungeon_event_quest.orderedmap": [13, 2, 107],
    "master/quest/event/daily_exp_mana_event_quest.orderedmap": [14, 2, "name", 2],
    "master/quest/event/world_story_event_quest.orderedmap": [18, 2, 107],
    "master/quest/event/world_story_event_boss_battle_quest.orderedmap": [19, 2, 106],
}

// collect_item_event column 23 (the quest to clear first): reference kind -> section, as in the Chinese fork
const SECTION_BY_REFERENCE_KIND = [1, 4, 2, 6, 11, 10, 7, 13, 14, 18, 19, 20, 21, 22, 3, 23, 24, 25, 26, 27]

const positive = (value, what) => {
    const n = int(value)
    if (!(n > 0)) throw new Error(`${what}: expected a positive number, got ${value}.`)
    return n
}

;(async () => {
    // drop groups
    const groups = {}
    for (const [groupId, rows] of Object.entries(await readTable("master/reward/event/additional_reward.orderedmap", true))) {
        const entries = Object.entries(rows)
        if (entries.length !== 1) throw new Error(`group ${groupId}: ${entries.length} entries (only single-item groups are given).`)
        const [index, line] = entries[0]
        const c = parseCsvLine(line)
        if (c.length !== 5 || c[1] !== "0") throw new Error(`group ${groupId}: not a single item row: ${line}`)
        groups[groupId] = { index: positive(index, `group ${groupId} index`), itemId: positive(c[2], `group ${groupId} item`), number: positive(c[3], `group ${groupId} number`) }
    }

    // enemy levels
    const enemyLevels = {}
    const unlevelled = []
    for (const [table, [section, depth, column, nameColumn]] of Object.entries(QUEST_TABLES)) {
        const levels = {}
        for (const row of await readRows(table, depth)) {
            const c = parseCsvLine(row.text)
            let level
            if (column === "name") {
                const match = /Lv\.? ?(\d+)/.exec(c[nameColumn])
                if (match === null) { unlevelled.push(`${c[0]} ${c[nameColumn]}`); continue } // "Labyrinth: Beginner" etc.
                level = Number(match[1])
            } else {
                level = int(c[column])
                if (level === null) continue // a story quest
            }
            if (!(level >= 0)) throw new Error(`${table} ${c[0]}: enemy level ${level}.`)
            levels[c[0]] = level
        }
        enemyLevels[section] = levels
    }

    // events
    const events = await readTable("master/reward/event/collect_item_event.orderedmap", false)
    const questRelations = await readTable("master/reward/event/collect_item_event_quest_relation.orderedmap", true)
    const rewardRelations = await readTable("master/reward/event/collect_item_event_reward_relation.orderedmap", true)
    const rules = []
    for (const [eventId, relations] of Object.entries(questRelations)) {
        const line = events[eventId]
        if (line === undefined) throw new Error(`quest relation for missing event ${eventId}.`)
        const e = parseCsvLine(line)
        if (e.length !== 28) throw new Error(`event ${eventId}: expected 28 columns, got ${e.length}.`)
        let prerequisite = null
        if (str(e[23]) !== null) {
            const kind = int(e[23])
            const section = SECTION_BY_REFERENCE_KIND[kind]
            if (section === undefined) throw new Error(`event ${eventId}: unknown prerequisite kind ${e[23]}.`)
            const [a, b, q] = [int(e[24]), int(e[25]), int(e[26])]
            prerequisite = { section, questId: kind <= 2 ? a * 1_000_000 + b * 1_000 + q : kind === 14 ? q : a * 1_000 + q }
        }
        for (const [sequence, relationLine] of Object.entries(relations)) {
            const r = parseCsvLine(relationLine)
            if (r.length !== 6) throw new Error(`event ${eventId} relation ${sequence}: expected 6 columns.`)
            const rangeKind = int(r[1])
            // a blank query in a used slot would mean "no quest" in the Chinese fork; none exist on global
            const used = rangeKind <= 2 ? [2, 3, 4] : rangeKind === 11 ? [4] : rangeKind === 12 ? [] : [2, 4]
            if (used.some(col => r[col] === "")) throw new Error(`event ${eventId} relation ${sequence}: blank range query.`)
            const thresholds = Object.entries(rewardRelations[r[5]] ?? {}).map(([level, t]) => {
                const groupId = parseCsvLine(t)[2]
                if (groups[groupId] === undefined) throw new Error(`reward relation ${r[5]}: missing group ${groupId}.`)
                return { level: Number(level), groupId: Number(groupId) }
            }).sort((x, y) => x.level - y.level)
            if (thresholds.length === 0) throw new Error(`event ${eventId} relation ${sequence}: reward ${r[5]} has no tiers.`)
            rules.push({ eventId: Number(eventId), start: toUtc(e[20]), end: toUtc(e[21]), prerequisite, range: [rangeKind, str(r[2]), str(r[3]), str(r[4])], thresholds })
        }
    }

    fs.writeFileSync(OUT, JSON.stringify({ groups, rules, enemyLevels }))
    console.log(`Wrote ${OUT}: ${Object.keys(groups).length} groups, ${rules.length} rules from ${Object.keys(questRelations).length} events, enemy levels for ${Object.values(enemyLevels).reduce((n, l) => n + Object.keys(l).length, 0)} quests.`)
    if (unlevelled.length > 0) console.log(`No level (no event drops): ${unlevelled.length} Kaleidoscope quests, e.g. ${unlevelled.slice(0, 3).join(", ")}.`)
})()
