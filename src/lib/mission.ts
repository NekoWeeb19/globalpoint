// Core logic for the Mission screen's Regular, Daily and Event tabs (/mission/get_mission_progress).
//
// This file has no imports on purpose, so it can be tested without the database
// (scripts/test_mission.mjs). src/nya/mission.ts connects it to the real database.
//
// How the global server behaved (checked against docs/routes/mission_get_mission_progress.md and
// the global client's own mission tables, see scripts/gen_missions.cjs):
// - A mission is listed while the server date is inside its start/end dates (UTC, either can be
//   open) and its prerequisite mission (same category) has cleared the given stage.
// - "stage" is the number of cleared stages + 1, capped at the last stage.
// - Rewards are not claimed by the client. A stage is cleared as soon as its target is reached.

export const enum MissionCategory {
    REGULAR = 1,
    DAILY = 2,
    EVENT = 3,
    /** Campaign missions (collect_item_event_mission): an event's "Promo Missions" rounds and the Kaleido Drops collections. */
    CAMPAIGN = 4,
    /** Title missions (degree_mission): each pays a title (reward kind 6). */
    DEGREE = 5,
    /** CN pass ("The Way of Practice") missions: daily, weekly, and for the whole pass. "group" is the pass. */
    PASS_DAILY = 6,
    PASS_WEEK = 7,
    PASS_EVENT = 8,
}

export const MISSION_CATEGORIES = [MissionCategory.REGULAR, MissionCategory.DAILY, MissionCategory.EVENT, MissionCategory.CAMPAIGN, MissionCategory.DEGREE,
    MissionCategory.PASS_DAILY, MissionCategory.PASS_WEEK, MissionCategory.PASS_EVENT]

/**
 * Campaign missions that ask for multiplayer clears (any, as host or as a guest) count solo clears
 * instead, so a single player can finish a round and its "clear all" rewards. Hosting needs the
 * stage cleared first anyway, so a solo clear stands in for it too.
 */
const CAMPAIGN_SOLO_STAND_IN_KINDS: ReadonlySet<number> = new Set([14, 15, 16])

/** The definition a campaign mission is counted with (multiplayer clears become any battle clear). */
export function countedDefinition(category: number, definition: MissionDefinition): MissionDefinition {
    if (category !== MissionCategory.CAMPAIGN || definition.kind === null || !CAMPAIGN_SOLO_STAND_IN_KINDS.has(definition.kind)) return definition
    const params = [...definition.params]
    params[2] = "3" // solo or multiplayer
    return { ...definition, kind: 12, params }
}

export interface MissionReward {
    kind: number
    amount: number
    itemId?: number
    characterId?: number
    equipmentId?: number
    degreeId?: number
}

export interface MissionStage {
    target: number
    /** "Clear within N seconds" missions (kind 13): the time limit, from the reward row's column 2. */
    timeLimitSeconds?: number
    rewardId: number
    rewards: MissionReward[]
}

export interface MissionDefinition {
    /** Campaign missions only: the campaign the mission belongs to. */
    group?: number
    pattern: string
    text: string
    kind: number | null
    /** Master columns 3 to 17 as text (null when empty). Their meaning depends on the kind. */
    params: (string | null)[]
    /** [mission id, stage] in the same category, or null. */
    prerequisite: [number, number] | null
    start: string | null
    end: string | null
    stages: MissionStage[]
}

export interface MissionData {
    missions: Record<string, Record<string, MissionDefinition>>
}

/** What is saved for one of the player's missions. */
export interface SavedMission {
    progress: number
    /** How many stages have had their rewards paid. */
    rewardedStage: number
    /** Daily missions: the daily period the progress belongs to. Login missions: the last day counted. */
    period: string | null
}

/** Looks up a saved mission. */
export type SavedMissionLookup = (category: number, missionId: number) => SavedMission | null

/** Values worked out from the player's data, for missions that track the account's state. */
export interface MissionFacts {
    /** The value for a state kind (see STATE_KINDS), or null if it is not known. */
    stateValue(kind: number): number | null
    /** The quests the player has finished in a quest category (QuestCategory numbering). */
    finishedQuestIds?(questCategory: number): ReadonlySet<number> | null
    /** How many of an item the player owns. */
    itemCount?(itemId: number): number | null
    /** Every quest of a quest category in the game data (main and EX are needed). */
    questIds?(questCategory: number): readonly number[] | null
    /** The value for a per-unit state kind (UNIT_STATE_KINDS) for one unit, or null if not known. */
    unitStateValue?(kind: number, characterId: number): number | null
}

/**
 * State kinds that a mission can ask about one unit (its id in params[11]), for title missions:
 * - 41 "Level <unit> to 100 and obtain their Amity Scroll" (target 2): one for level 100, one for the
 *   first board's Amity Scroll received (the Chinese fork's degree-state-derivation.ts counts the same);
 * - 45 "Fully complete <unit>'s 2nd Mana Board": 1 when every node of its board 2 is learned.
 */
export const UNIT_STATE_KINDS = Object.freeze({
    LEVEL_100_AND_AMITY_SCROLL: 41,
    SECOND_MANA_BOARD_COMPLETE: 45,
})
const UNIT_STATE_KIND_SET = new Set<number>(Object.values(UNIT_STATE_KINDS))

/** The unit a per-unit state mission asks about (only params[11] set), or null. */
export function unitStateCharacterId(definition: MissionDefinition): number | null {
    if (definition.kind === null || !UNIT_STATE_KIND_SET.has(definition.kind)) return null
    if (definition.params.some((param, index) => param !== null && index !== 11)) return null
    const characterId = Number(definition.params[11])
    return Number.isSafeInteger(characterId) && characterId > 0 ? characterId : null
}

/** The item an "Own a total of N <item>" mission counts, or null. */
export function ownedItemId(definition: MissionDefinition): number | null {
    if (definition.kind !== ITEM_OWNED_KIND) return null
    if (definition.params.some((param, index) => param !== null && index !== 9)) return null
    const itemId = Number(definition.params[9])
    return Number.isSafeInteger(itemId) && itemId > 0 ? itemId : null
}

/** QuestCategory numbers used by the quest clear missions. */
const QUEST_CATEGORY_MAIN = 1
const QUEST_CATEGORY_EX = 4
const QUEST_CATEGORY_PRACTICE = 15

/** The mission kinds that can be "clear these quests" missions. */
const QUEST_CLEAR_KINDS = new Set([12, 20])

export interface QuestClearRule {
    questCategory: number
    /** "all": every matching quest must be finished. "any": one of them is enough (practice). */
    mode: "all" | "any"
    /** Main and EX: the chapter, section and quest number lists (null = any). */
    chapters: number[] | null
    sections: number[] | null
    quests: number[] | null
    /** Practice: the quest ids themselves. */
    questIdList: number[] | null
}

const intList = (value: string | null): number[] | null => {
    if (value === null) return null
    const list = value.split(",").map(Number)
    return list.every(Number.isSafeInteger) ? list : null
}

/**
 * A "clear these quests" mission (Clear Chapter N, Clear Chapter N EX, Clear "<boss>", the practice
 * Lignoids), or null. It follows the Chinese fork's regular-quest-facts.ts: params[4] is the range
 * (0 main, 1 EX, 11 practice), params[5..7] select the quests of main and EX by chapter, section
 * and quest number (a quest id is chapter * 1,000,000 + section * 1,000 + quest), and every
 * matching quest must be finished. For practice, params[7] lists the quest ids and any one counts.
 */
export function questClearRule(definition: MissionDefinition): QuestClearRule | null {
    if (definition.kind === null || !QUEST_CLEAR_KINDS.has(definition.kind)) return null
    const p = definition.params
    if (p.some((param, index) => param !== null && (index < 4 || index > 7))) return null

    if (p[4] === "11") {
        const questIdList = intList(p[7])
        if (questIdList === null || questIdList.length === 0 || p[5] !== null || p[6] !== null) return null
        return { questCategory: QUEST_CATEGORY_PRACTICE, mode: "any", chapters: null, sections: null, quests: null, questIdList }
    }
    if (p[4] !== "0" && p[4] !== "1") return null
    const chapters = intList(p[5]), sections = intList(p[6]), quests = intList(p[7])
    // a mission with no selector at all is a plain counter ("clear N EX quests"), not a quest set
    if (chapters === null && sections === null && quests === null) return null
    return {
        questCategory: p[4] === "0" ? QUEST_CATEGORY_MAIN : QUEST_CATEGORY_EX,
        mode: "all",
        chapters,
        sections,
        quests,
        questIdList: null,
    }
}

/** The quest ids a rule needs, from all the quests of its category. */
export function questClearCandidates(rule: QuestClearRule, allQuestIds: readonly number[]): number[] {
    if (rule.questIdList !== null) return rule.questIdList
    return allQuestIds.filter(questId => {
        const chapter = Math.floor(questId / 1_000_000)
        const section = Math.floor(questId / 1_000) % 1_000
        const quest = questId % 1_000
        return (rule.chapters === null || rule.chapters.includes(chapter))
            && (rule.sections === null || rule.sections.includes(section))
            && (rule.quests === null || rule.quests.includes(quest))
    })
}

/** 1 when the quests are cleared, 0 when not, null when the facts aren't available. */
function questClearProgress(rule: QuestClearRule, facts: MissionFacts): number | null {
    const finished = facts.finishedQuestIds?.(rule.questCategory)
    if (finished === null || finished === undefined) return null
    let candidates: number[]
    if (rule.questIdList !== null) candidates = rule.questIdList
    else {
        const all = facts.questIds?.(rule.questCategory)
        if (all === null || all === undefined) return null
        candidates = questClearCandidates(rule, all)
    }
    // no matching quest in the data: never count it as cleared
    if (candidates.length === 0) return 0
    const done = rule.mode === "any"
        ? candidates.some(questId => finished.has(questId))
        : candidates.every(questId => finished.has(questId))
    return done ? 1 : 0
}

export interface MissionClock {
    /** The server date (decides which missions are open and the daily period). */
    serverMs: number
    /** The real date (decides the daily period too, and which day a login counts for). */
    realMs: number
}

export interface EvaluatedMission {
    category: number
    missionId: number
    progress: number
    stage: number
    clearedStages: number
}

/** Mission kinds whose progress is the account's current state, not a count of actions. */
export const STATE_KINDS = Object.freeze({
    USER_RANK: 1,
    CHARACTERS_COUNT: 4,
    HIGHEST_CHARACTER_LEVEL: 5,
    CHARACTERS_AT_LEVEL_80: 6,
    MANA_NODES_RELEASED: 7,
    BOND_TOKENS_OBTAINED: 8,
    OVER_LIMIT_TOTAL: 9,
    CHARACTER_EPISODES_READ: 19,
    /** "Obtain N new armaments": the different armaments owned. */
    EQUIPMENT_KINDS_OWNED: 10,
    /** "Perform an armament awakening N times": level-ups added up over armaments (level - 1 each). */
    EQUIPMENT_AWAKENINGS: 32,
    /** "Equip an Ability Core N times": the filled Ability Core slots over all parties. */
    ABILITY_CORES_EQUIPPED: 33,
    /** "Own N Lv. 5 armaments". */
    LEVEL_5_EQUIPMENT: 34,
    /** "Unlock N 2nd Mana Board(s)": units on mana board 2. */
    SECOND_MANA_BOARDS_OPEN: 44,
    /** "Fully complete N 2nd Mana Board(s)": units with every node of board 2 learned. */
    SECOND_MANA_BOARDS_COMPLETE: 45,
})
const STATE_KIND_SET = new Set<number>(Object.values(STATE_KINDS))

/** Mission kinds counted from actions. */
export const COUNTER_KINDS = Object.freeze({
    LOGIN_DAYS: 0,
    /**
     * CN pass missions a single player can't do (send emotes in co-op, answer help requests from
     * other players): scripts/gen_cn_missions.cjs gives them this kind, and each login sends a
     * count big enough to clear them, so they complete at the first login of each reset period.
     */
    SOLO_AUTO_COMPLETE: 1999,
    SINGLE_BATTLE_CLEAR: 12,
    MULTI_BATTLE_CLEAR: 14,
    /** The highest score in one battle. */
    MAX_SCORE: 23,
    /** Battles cleared with the top rank (SS, clear_rank 5). */
    RANK_SS_CLEARS: 24,
    /** The highest power reached in one battle. */
    MAX_POWER: 25,
    /** A battle action count, added up over battles. params[0] picks which (BATTLE_ACTION_FIELDS). */
    BATTLE_ACTIONS: 26,
    /** The highest combo in one battle. */
    MAX_COMBO: 28,
    /** The highest skill chain in one battle. */
    MAX_SKILL_CHAIN: 29,
    /** Mana obtained in battles (the quest's mana and the mana picked up in the field). */
    BATTLE_MANA: 30,
    /**
     * "Obtain a total of N mana". Mana from battles and the shop is counted. Mail isn't: the built-in
     * "Mana * 1500" mail never runs out, so it would fill this mission for free.
     */
    TOTAL_MANA: 2,
    /** "Spend a total of N mana at The Trove". */
    TROVE_MANA_SPENT: 3,
    /** "Spend N mana" anywhere: Mana Board nodes and mana-priced shop items (campaign missions). */
    MANA_SPENT: 43,
    /** "Clear N battles" of a quest range, solo or multiplayer (event missions; the Chinese fork's 23). */
    RANGE_BATTLE_CLEAR: 21,
    /** Time attack: "Clear Phase N" (phase 1 is 46, phase 4 is 49). */
    PHASE_1_CLEAR: 46,
    /**
     * "Clear <quest> in N seconds or less" (Grand Gauntlet battles, the "Clear a solo battle in under N
     * seconds" titles): a solo clear whose time is within the first stage's timeLimitSeconds.
     */
    TIME_CLEAR: 13,
    /** "Use up a total of N stamina": the stamina cost of each cleared battle (campaign missions). */
    STAMINA_SPENT: 36,
    /** Raids: "Join the event" (opening the raid); params[4..5] are the raid range. */
    RAID_JOIN: 75,
    /** Raids: "Set up your Main / Sub 1 / Sub 2 party in SET Edit" (76, 77, 78: raid party slots 1 to 3). */
    RAID_PARTY_SET_MAIN: 76,
    /**
     * An SS clear with a battle condition the client checks, named in params[3] (the Steambot Reckoning
     * missions: no coffins in time, the Leader never inflicted with attack down or Light resistance down).
     */
    CONDITION_SS_CLEAR: 82,
    /**
     * Kinds only the CN client has (scripts/gen_cn_missions.cjs gives them these numbers, which
     * global doesn't use): "Pull a unit summon N times" (CN 78) and "View your own profile" (CN 88).
     */
    CN_CHARACTER_GACHA_PULLS: 1078,
    CN_PROFILE_VIEWED: 1088,
})

/**
 * The conditions a CONDITION_SS_CLEAR mission names (params[3]) and how each is checked against the
 * finish request's statistics (the Chinese fork's event-battle-facts.ts; global field names zones[].
 * encoffinment_count and zones[].members[].conditions[].max_acc_bad). Condition index 0 is attack down,
 * 7 Light resistance down, 14 paralysis.
 */
const BATTLE_CONDITIONS: Readonly<Record<string, { check: "noCoffins" | "leaderNoBad" | "partyNoBad", conditionIndex?: number, maxClearTimeMs?: number }>> = Object.freeze({
    hard_multi_steam_robot_wind_coffin_count: { check: "noCoffins", maxClearTimeMs: 180_000 },
    hard_multi_steam_robot_water: { check: "leaderNoBad", conditionIndex: 0 },
    hard_multi_steam_robot_dark: { check: "leaderNoBad", conditionIndex: 0 },
    hard_multi_steam_robot_light: { check: "leaderNoBad", conditionIndex: 7 },
    hard_multi_steam_robot_thunder: { check: "partyNoBad", conditionIndex: 14 },
})

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)

/** The BATTLE_CONDITIONS a battle met (every zone has to meet it). */
export function metBattleConditions(statistics: unknown, clearTimeMs: number | undefined): string[] {
    const zones = isRecord(statistics) && Array.isArray(statistics.zones) ? statistics.zones : []
    if (zones.length === 0 || !zones.every(isRecord)) return []
    const noBad = (member: unknown, index: number) => {
        const condition = isRecord(member) && Array.isArray(member.conditions) ? member.conditions[index] : undefined
        return isRecord(condition) && condition.max_acc_bad === 0
    }
    const met: string[] = []
    for (const [key, rule] of Object.entries(BATTLE_CONDITIONS)) {
        if (rule.maxClearTimeMs !== undefined && (clearTimeMs === undefined || clearTimeMs <= 0 || clearTimeMs > rule.maxClearTimeMs)) continue
        const ok = zones.every(zone => {
            const z = zone as Record<string, unknown>
            if (rule.check === "noCoffins") return z.encoffinment_count === 0
            const members = Array.isArray(z.members) ? z.members : []
            if (rule.check === "leaderNoBad") return noBad(members[0], rule.conditionIndex!)
            const present = members.filter(member => member !== null)
            return present.length > 0 && present.every(member => noBad(member, rule.conditionIndex!))
        })
        if (ok) met.push(key)
    }
    return met
}

/**
 * Mission events for a raid (QuestCategory 23): opening it ("Join the event"), or editing one of its
 * three parties (slot 1 Main, 2 Sub 1, 3 Sub 2). The quest id is the raid's event id * 1,000, which
 * the raid range of these missions (params[4] 16, params[5] the event id) matches.
 */
export function raidMissionEvents(raidEventId: number, action: "join" | { partySlot: number }): CounterEvent[] {
    if (!Number.isSafeInteger(raidEventId) || raidEventId <= 0) return []
    const base = { amount: 1, questCategory: 23, questId: raidEventId * 1_000 }
    if (action === "join") return [{ ...base, kind: COUNTER_KINDS.RAID_JOIN }]
    const slot = action.partySlot
    if (!Number.isSafeInteger(slot) || slot < 1 || slot > 3) return []
    return [{ ...base, kind: COUNTER_KINDS.RAID_PARTY_SET_MAIN + slot - 1 }]
}

/**
 * Progress the client reports itself (/mission/update_mission_progress: mission_pattern and an amount
 * to add), by the mission kind it counts. The patterns are the Chinese fork's client-progress.ts
 * (its kinds 40-43 are global's 37-40); the recorded global request sent home_tap_town_character_count.
 */
export const CLIENT_REPORTED_KINDS: Readonly<Record<string, number>> = Object.freeze({
    character_detail_zoom_illust_for_1min_count: 37,   // stare at a unit's enlarged picture for a minute
    character_detail_play_dot_sp_motion_count: 38,     // play a unit's pixel animations
    home_tap_town_character_count: 39,                 // tap a unit in town
    home_change_voice_count: 40,                       // change the home dialogue
})

/** Mission events from a client report (unknown patterns and odd amounts are ignored). */
export function clientReportedEvents(list: unknown): CounterEvent[] {
    if (!Array.isArray(list)) return []
    const events: CounterEvent[] = []
    for (const entry of list) {
        const kind = typeof entry?.mission_pattern === "string" ? CLIENT_REPORTED_KINDS[entry.mission_pattern] : undefined
        const amount = Number(entry?.progress_value)
        if (kind === undefined || !Number.isSafeInteger(amount) || amount <= 0 || amount > 1000) continue
        events.push({ kind, amount })
    }
    return events
}

/** "Own a total of N <item>": params[9] is the item id, the progress is how many are owned. */
export const ITEM_OWNED_KIND = 35

/**
 * The battle statistics field (summed over the zones of the finish request) for each params[0] of
 * a BATTLE_ACTIONS mission. The numbers match the mission texts (2 "Dash", 0 "Hit a soft spot", 1
 * "Power Flips", 4 "Use skills", 5 "fever", 7 "defeat enemies") and the Chinese fork's table; the
 * field names are in the recorded global /single_battle_quest/finish request.
 */
export const BATTLE_ACTION_FIELDS: Readonly<Record<number, string>> = Object.freeze({
    0: "weak_point_attack_count",
    1: "use_power_flip_count",
    2: "use_dash_count",
    4: "use_skill_count",
    5: "fever_count",
    7: "enemy_kill_count",
})

/** Mission kinds that keep the best value seen instead of adding up. */
const MAX_KINDS = new Set<number>([COUNTER_KINDS.MAX_SCORE, COUNTER_KINDS.MAX_POWER, COUNTER_KINDS.MAX_COMBO, COUNTER_KINDS.MAX_SKILL_CHAIN])

/** "Clear all daily missions": counts the missions listed in params[14] that cleared every stage. */
export const ALL_CLEAR_KIND = 11

/** The hour (UTC) the day starts at. The daily mission dates in the master tables start at 05:00. */
export const DAILY_RESET_HOUR_UTC = 5
const DAY_MS = 24 * 60 * 60 * 1000

/** The number of the day (starting at the daily reset hour) a time falls in. */
export function dayNumber(ms: number): number {
    return Math.floor((ms - DAILY_RESET_HOUR_UTC * 60 * 60 * 1000) / DAY_MS)
}

/**
 * The daily period. It changes when either the server day or the real day changes, so daily
 * missions reset every real day even while the server date is pinned.
 */
export function dailyPeriodKey(clock: MissionClock): string {
    return `d${dayNumber(clock.serverMs)}:${dayNumber(clock.realMs)}`
}

/** The weekly period (weeks start on Monday at the daily reset hour), like dailyPeriodKey. */
export function weeklyPeriodKey(clock: MissionClock): string {
    const week = (ms: number) => Math.floor((dayNumber(ms) + 3) / 7) // day 0 (1970-01-01) was a Thursday
    return `w${week(clock.serverMs)}:${week(clock.realMs)}`
}

/** The period a category's progress resets with (daily, weekly), or null when it never resets. */
export function periodKey(category: number, clock: MissionClock): string | null {
    if (category === MissionCategory.DAILY || category === MissionCategory.PASS_DAILY) return dailyPeriodKey(clock)
    if (category === MissionCategory.PASS_WEEK) return weeklyPeriodKey(clock)
    return null
}

/** The real day a login counts for. */
export function loginDayKey(clock: MissionClock): string {
    return `l${dayNumber(clock.realMs)}`
}

/** Parses a master table date ("2024-05-28 14:00:00", UTC). */
export function parseMasterDate(value: string | null): number | null {
    if (value === null) return null
    const ms = Date.parse(value.replace(" ", "T") + "Z")
    return isNaN(ms) ? null : ms
}

export function isMissionOpen(definition: MissionDefinition, serverMs: number): boolean {
    const start = parseMasterDate(definition.start)
    const end = parseMasterDate(definition.end)
    return (start === null || start <= serverMs) && (end === null || serverMs <= end)
}

export function clearedStageCount(definition: MissionDefinition, progress: number): number {
    let cleared = 0
    for (const stage of definition.stages) {
        if (progress >= stage.target) cleared++
        else break
    }
    return cleared
}

/** The stage the client shows: the first stage not yet cleared, or the last stage once all are. */
export function currentStage(definition: MissionDefinition, progress: number): number {
    if (definition.stages.length === 0) return 1
    return Math.min(clearedStageCount(definition, progress) + 1, definition.stages.length)
}

/** Whether none of a mission's filter columns are set (the counter applies to any battle). */
function hasNoFilters(definition: MissionDefinition): boolean {
    return definition.params.every(param => param === null)
}

/** The missions a "clear all" mission counts. */
export function allClearTargets(definition: MissionDefinition): number[] {
    const list = definition.params[14]
    if (list === null || list === undefined) return []
    return list.split(",").map(Number).filter(Number.isSafeInteger)
}

/** The saved progress that still counts now (daily progress from an earlier day doesn't). */
function currentSaved(category: number, saved: SavedMission | null, clock: MissionClock): SavedMission | null {
    if (saved === null) return null
    const period = periodKey(category, clock)
    if (period !== null && saved.period !== period) return null
    return saved
}

/**
 * Works out the progress of every open mission in the given categories, and which of them the
 * client should be shown.
 */
export function evaluateMissions(
    data: MissionData,
    categories: number[],
    clock: MissionClock,
    getSaved: SavedMissionLookup,
    facts: MissionFacts
): { listed: EvaluatedMission[], all: Map<string, EvaluatedMission> } {
    const all = new Map<string, EvaluatedMission>()
    const listed: EvaluatedMission[] = []
    const key = (category: number, missionId: number) => `${category}:${missionId}`

    for (const category of categories) {
        const missions = data.missions[String(category)]
        if (!missions) continue

        const open = Object.entries(missions)
            .map(([id, definition]) => [Number(id), definition] as const)
            .filter(([_, definition]) => isMissionOpen(definition, clock.serverMs))
            .sort((a, b) => a[0] - b[0])

        // first every mission's own progress, then the "clear all" missions that count the others
        const evaluate = (missionId: number, definition: MissionDefinition, progress: number) => {
            const evaluated: EvaluatedMission = {
                category,
                missionId,
                progress,
                stage: currentStage(definition, progress),
                clearedStages: clearedStageCount(definition, progress),
            }
            all.set(key(category, missionId), evaluated)
        }

        for (const [missionId, definition] of open) {
            if (definition.kind === ALL_CLEAR_KIND) continue
            let progress = currentSaved(category, getSaved(category, missionId), clock)?.progress ?? 0
            if (definition.kind !== null && STATE_KIND_SET.has(definition.kind) && hasNoFilters(definition)) {
                const value = facts.stateValue(definition.kind)
                // never go backwards, in case a value is estimated (character levels are)
                if (value !== null) progress = Math.max(progress, value)
            }
            const unitId = unitStateCharacterId(definition)
            if (unitId !== null && definition.kind !== null) {
                const value = facts.unitStateValue?.(definition.kind, unitId)
                if (value !== null && value !== undefined) progress = Math.max(progress, value)
            }
            const ownedItem = ownedItemId(definition)
            if (ownedItem !== null) {
                const owned = facts.itemCount?.(ownedItem)
                if (owned !== null && owned !== undefined) progress = Math.max(progress, owned)
            }
            const questRule = questClearRule(definition)
            if (questRule !== null) {
                const value = questClearProgress(questRule, facts)
                if (value !== null) progress = Math.max(progress, value)
            }
            evaluate(missionId, definition, progress)
        }

        for (const [missionId, definition] of open) {
            if (definition.kind !== ALL_CLEAR_KIND) continue
            const cleared = allClearTargets(definition).filter(targetId => {
                const target = all.get(key(category, targetId))
                const targetDefinition = missions[String(targetId)]
                return target !== undefined && targetDefinition !== undefined
                    && target.clearedStages >= targetDefinition.stages.length
            }).length
            evaluate(missionId, definition, cleared)
        }

        for (const [missionId, definition] of open) {
            const evaluated = all.get(key(category, missionId))
            if (evaluated === undefined) continue
            if (definition.prerequisite !== null) {
                const [requiredId, requiredStage] = definition.prerequisite
                const required = all.get(key(category, requiredId))
                if (required === undefined || required.clearedStages < requiredStage) continue
            }
            listed.push(evaluated)
        }
    }

    return { listed, all }
}

/** The reply's mission_progress_list, in the order the categories were asked for. */
export function buildMissionProgressList(
    data: MissionData,
    categories: number[],
    clock: MissionClock,
    getSaved: SavedMissionLookup,
    facts: MissionFacts
) {
    const seen = new Set<number>()
    const requested = categories.filter(category => {
        if (!MISSION_CATEGORIES.includes(category) || seen.has(category)) return false
        seen.add(category)
        return true
    })
    const { listed } = evaluateMissions(data, requested, clock, getSaved, facts)
    return listed.map(mission => ({
        mission_category: mission.category,
        mission_id: mission.missionId,
        progress_value: mission.progress,
        stage: mission.stage,
    }))
}

export interface CounterEvent {
    kind: number
    /** How much to add, or for a "best value" kind (MAX_KINDS) the value reached. */
    amount: number
    /** The quest's category in this project's numbering (QuestCategory), for battle clears. */
    questCategory?: number
    /** The quest's id, for battle clears (event missions select quests by id). */
    questId?: number
    /** For battle events: whether it was a multiplayer battle. */
    isMulti?: boolean
    /** For BATTLE_ACTIONS: which action (the key of BATTLE_ACTION_FIELDS). */
    selector?: number
    /** For TIME_CLEAR: the battle's clear time in milliseconds. */
    clearTimeMs?: number
    /** For CONDITION_SS_CLEAR: the BATTLE_CONDITIONS the battle met. */
    conditions?: string[]
}

/** What a finished battle reports, for battleMissionEvents. */
export interface BattleResult {
    accomplished: boolean
    isMulti: boolean
    /** A multiplayer battle the player hosted ("Host N multiplayer battles"). */
    isHost?: boolean
    /**
     * Also count the battle for "Join N multiplayer battles as a guest". Co-op here is always hosted
     * (the partners are COMs), so a hosted co-op clear stands in for joining one.
     */
    guestStandIn?: boolean
    questCategory: number
    questId?: number
    clearRank: number
    score: unknown
    /** The quest's own mana reward. */
    questMana: unknown
    /** The mana picked up in the field (the request's add_mana). */
    fieldMana: unknown
    /** The request's statistics object. */
    statistics: unknown
    /** The clear time in milliseconds (the request's elapsed_time_ms). */
    clearTimeMs?: unknown
    /** The quest's stamina cost (assets/quest_stamina.json), for "Use up N stamina". */
    staminaCost?: unknown
}

/** A whole, non-negative number from the client, or 0. */
const count = (value: unknown): number =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0

/**
 * Turns a finished battle into mission events. Only a cleared battle counts, like the Chinese fork.
 * Values that aren't whole, non-negative numbers are ignored.
 */
export function battleMissionEvents(battle: BattleResult): CounterEvent[] {
    if (!battle.accomplished) return []
    const base = { questCategory: battle.questCategory, isMulti: battle.isMulti, ...(battle.questId === undefined ? {} : { questId: battle.questId }) }
    const stats = (battle.statistics !== null && typeof battle.statistics === "object" ? battle.statistics : {}) as Record<string, unknown>
    const zones = Array.isArray(stats.zones) ? stats.zones.filter(zone => zone !== null && typeof zone === "object") as Record<string, unknown>[] : []

    const events: CounterEvent[] = [
        // a battle clear. A multiplayer one is also sent as kind 12 (marked multiplayer), so
        // "clear N battles, solo or multiplayer" missions of that kind count it; solo-only ones don't
        { ...base, kind: COUNTER_KINDS.SINGLE_BATTLE_CLEAR, amount: 1 },
        ...(battle.isMulti ? [{ ...base, kind: COUNTER_KINDS.MULTI_BATTLE_CLEAR, amount: 1 }] : []),
        ...(battle.isMulti && battle.isHost ? [{ ...base, kind: MULTI_HOST_CLEAR, amount: 1 }] : []),
        ...(battle.isMulti && battle.guestStandIn ? [{ ...base, kind: MULTI_GUEST_CLEAR, amount: 1 }] : []),
        { ...base, kind: COUNTER_KINDS.MAX_SCORE, amount: count(battle.score) },
        { ...base, kind: COUNTER_KINDS.MAX_POWER, amount: count(stats.max_power) },
        { ...base, kind: COUNTER_KINDS.MAX_COMBO, amount: count(stats.max_combo_count) },
        { ...base, kind: COUNTER_KINDS.MAX_SKILL_CHAIN, amount: count(stats.max_skill_chain_count) },
        { ...base, kind: COUNTER_KINDS.BATTLE_MANA, amount: count(battle.questMana) + count(battle.fieldMana) },
        { kind: COUNTER_KINDS.TOTAL_MANA, amount: count(battle.questMana) + count(battle.fieldMana) },
    ]
    if (battle.clearRank === 5) events.push({ ...base, kind: COUNTER_KINDS.RANK_SS_CLEARS, amount: 1 })
    // "clear within N seconds" (each mission checks its own limit) and SS clears with a battle condition
    const clearTimeMs = count(battle.clearTimeMs)
    if (clearTimeMs > 0) events.push({ ...base, kind: COUNTER_KINDS.TIME_CLEAR, amount: 1, clearTimeMs })
    if (battle.clearRank === 5) {
        const conditions = metBattleConditions(battle.statistics, clearTimeMs > 0 ? clearTimeMs : undefined)
        if (conditions.length > 0) events.push({ ...base, kind: COUNTER_KINDS.CONDITION_SS_CLEAR, amount: 1, conditions })
    }
    // stamina is an account total, not tied to a kind of battle (like TOTAL_MANA)
    const stamina = count(battle.staminaCost)
    if (stamina > 0) events.push({ kind: COUNTER_KINDS.STAMINA_SPENT, amount: stamina })
    // "clear N battles" of a range, solo or multiplayer (event missions)
    events.push({ ...base, kind: COUNTER_KINDS.RANGE_BATTLE_CLEAR, amount: 1 })
    // time attack: one event per phase cleared ("Clear Phase N of ...")
    const phase = count(stats.clear_phase)
    for (let p = 1; p <= Math.min(phase, 4); p++) events.push({ ...base, kind: COUNTER_KINDS.PHASE_1_CLEAR + p - 1, amount: 1 })
    for (const [selector, field] of Object.entries(BATTLE_ACTION_FIELDS)) {
        const total = zones.reduce((sum, zone) => sum + count(zone[field]), 0)
        events.push({ ...base, kind: COUNTER_KINDS.BATTLE_ACTIONS, selector: Number(selector), amount: total })
    }
    return events.filter(event => event.amount > 0)
}

/**
 * Quest ranges (the Chinese fork's lib/mission/quest-range-translator.ts, from its decompiled client;
 * the global numbers match: 5 boss events, 10 world story boss battles, 12 Kaleidoscope, 15 carnival,
 * 16 raids, 17 Grand Gauntlet... all checked against global mission texts).
 * The range kind (params[4]) maps to QuestCategory sections; params[5..7] select quests:
 * - "triple": chapter (id / 1,000,000), section ((id / 1,000) % 1,000) and quest (id % 1,000);
 * - "eventId": the event (id / 1,000, params[5]) and the quest number (id % 1,000, params[7]);
 * - "practice": the quest ids themselves (params[7]); "none": every quest of the sections.
 */
const QUEST_RANGES: Readonly<Record<number, { sections: readonly number[], structure: "triple" | "eventId" | "practice" | "none" }>> = Object.freeze({
    0: { sections: [1], structure: "triple" },               // main
    1: { sections: [4], structure: "triple" },               // EX
    2: { sections: [2], structure: "triple" },               // boss battles
    3: { sections: [6], structure: "eventId" },              // Kaleidoscope elements
    4: { sections: [14], structure: "eventId" },             // Kaleidoscope EXP & Mana
    5: { sections: [7], structure: "eventId" },              // boss events
    6: { sections: [10], structure: "eventId" },             // story events
    7: { sections: [13], structure: "eventId" },             // Necropolis
    8: { sections: [11], structure: "eventId" },             // Trials (time attack)
    9: { sections: [18], structure: "eventId" },             // world story events
    10: { sections: [19], structure: "eventId" },            // world story boss battles
    11: { sections: [15], structure: "practice" },           // practice
    12: { sections: [6, 14, 13, 20], structure: "none" },    // all of the Kaleidoscope
    13: { sections: [20], structure: "eventId" },            // The Haunt
    14: { sections: [21], structure: "eventId" },            // solo boss challenges
    15: { sections: [22], structure: "eventId" },            // Hanifolk Carnival
    16: { sections: [23], structure: "eventId" },            // raids
    17: { sections: [24], structure: "eventId" },            // Grand Gauntlet
    18: { sections: [25], structure: "eventId" },            // Chrono Trials
    19: { sections: [26], structure: "eventId" },            // hard multi
    20: { sections: [27], structure: "eventId" },            // score attack
})

const segment = (value: string | null): number[] | null | undefined => {
    if (value === null) return null // any
    const ids = value.split(",").map(Number)
    return ids.every(id => Number.isSafeInteger(id) && id >= 0) ? ids : undefined // undefined: unreadable
}

/** Whether a quest is inside a mission's range (params[4..7]). A row with no range matches every quest. */
export function questInRange(definition: MissionDefinition, questCategory: number | undefined, questId: number | undefined): boolean {
    const p = definition.params
    if (p[4] === null) return true
    return questInRangeQuery([Number(p[4]), p[5], p[6], p[7]], questCategory, questId)
}

/**
 * The same quest range check for a range given directly: [range kind, query 1, query 2, query 3]
 * (missions keep it in params[4..7]; reward and stamina campaigns use the same ranges).
 */
export function questInRangeQuery(range: readonly [number, string | null, string | null, string | null], questCategory: number | undefined, questId: number | undefined): boolean {
    const p: (string | null)[] = []
    p[5] = range[1]; p[6] = range[2]; p[7] = range[3]
    const rule = QUEST_RANGES[range[0]]
    if (rule === undefined || questCategory === undefined || !rule.sections.includes(questCategory)) return false
    if (rule.structure === "none") return true
    if (questId === undefined) return false
    const [first, middle, last] = [segment(p[5]), segment(p[6]), segment(p[7])]
    if (first === undefined || middle === undefined || last === undefined) return false
    const ok = (seg: number[] | null, value: number) => seg === null || seg.includes(value)
    if (rule.structure === "triple") {
        return ok(first, Math.floor(questId / 1_000_000)) && ok(middle, Math.floor(questId / 1_000) % 1_000) && ok(last, questId % 1_000)
    }
    if (rule.structure === "eventId") return ok(first, Math.floor(questId / 1_000)) && ok(last, questId % 1_000)
    return ok(last, questId) // practice
}

/** Solo (1), multiplayer (2) or either (3) when params[2] is blank, per kind (the Chinese fork's defaults). */
function defaultBattleMode(kind: number): number {
    if (kind === COUNTER_KINDS.SINGLE_BATTLE_CLEAR || kind === COUNTER_KINDS.TIME_CLEAR || (kind >= COUNTER_KINDS.PHASE_1_CLEAR && kind <= COUNTER_KINDS.PHASE_1_CLEAR + 3)) return 1
    if (kind === COUNTER_KINDS.MULTI_BATTLE_CLEAR || kind === MULTI_HOST_CLEAR || kind === MULTI_GUEST_CLEAR) return 2
    return 3
}
const MULTI_HOST_CLEAR = 15
const MULTI_GUEST_CLEAR = 16

/** The params a counter understands: 0 the action, 2 the battle kind, 4-7 the quest range. */
const UNDERSTOOD_PARAMS = new Set([0, 2, 4, 5, 6, 7])

/**
 * Whether an action counts for a mission. The filters it understands:
 * - params[0]: which battle action (BATTLE_ACTIONS missions only).
 * - params[2]: the battle kind, 1 solo, 2 multiplayer, 3 either (blank: the kind's default).
 * - params[4..7]: the quest range (questInRange).
 * - params[3]: the battle condition of a CONDITION_SS_CLEAR mission; TIME_CLEAR missions also need the
 *   clear time within the first stage's timeLimitSeconds.
 * Missions with any other filter set aren't tracked, and "clear these quests" missions are worked
 * out from the save instead (questClearRule).
 */
export function counterMatches(definition: MissionDefinition, event: CounterEvent): boolean {
    if (definition.kind !== event.kind) return false
    const p = definition.params
    // params[3] is understood only as the battle condition of a CONDITION_SS_CLEAR mission
    const conditionMission = definition.kind === COUNTER_KINDS.CONDITION_SS_CLEAR
    if (p.some((param, index) => param !== null && !UNDERSTOOD_PARAMS.has(index) && !(conditionMission && index === 3))) return false
    if (questClearRule(definition) !== null) return false
    if (conditionMission && (p[3] === null || !(event.conditions ?? []).includes(p[3]))) return false
    if (definition.kind === COUNTER_KINDS.TIME_CLEAR) {
        const limit = definition.stages[0]?.timeLimitSeconds
        if (limit === undefined || event.clearTimeMs === undefined || event.clearTimeMs > limit * 1000) return false
    }

    if (p[0] !== null) {
        if (definition.kind !== COUNTER_KINDS.BATTLE_ACTIONS || event.selector === undefined || String(event.selector) !== p[0]) return false
    } else if (definition.kind === COUNTER_KINDS.BATTLE_ACTIONS) {
        return false
    }

    // battle events carry isMulti; other events (a login, a purchase) only match missions with no battle filter
    if (event.isMulti !== undefined) {
        const mode = p[2] !== null ? Number(p[2]) : defaultBattleMode(definition.kind)
        if (mode === 1 && event.isMulti) return false
        if (mode === 2 && !event.isMulti) return false
        if (mode !== 1 && mode !== 2 && mode !== 3) return false
    } else if (p[2] !== null) {
        return false
    }

    return p[4] === null ? true : questInRange(definition, event.questCategory, event.questId)
}

/**
 * Uses the stages a regular mission had cleared on the global server (the save's
 * cleared_regular_mission_list, { mission id: stages cleared }) as a floor: those stages count as
 * paid, and the progress is at least what they needed.
 */
export function withClearedBaseline(
    data: MissionData,
    getSaved: SavedMissionLookup,
    clearedRegular: Record<string, number>
): SavedMissionLookup {
    return (category, missionId) => {
        const saved = getSaved(category, missionId)
        if (category !== MissionCategory.REGULAR) return saved
        const cleared = clearedRegular[String(missionId)]
        const definition = data.missions[String(category)]?.[String(missionId)]
        if (!cleared || cleared <= 0 || !definition) return saved
        const stages = Math.min(cleared, definition.stages.length)
        const floor = definition.stages[stages - 1]?.target ?? 0
        return {
            progress: Math.max(saved?.progress ?? 0, floor),
            rewardedStage: Math.max(saved?.rewardedStage ?? 0, stages),
            period: saved?.period ?? null,
        }
    }
}

export interface MissionProgressUpdate {
    category: number
    missionId: number
    progress: number
    rewardedStage: number
    period: string | null
}

/**
 * Adds action counts (battles cleared, a login) to every open, listed mission of that kind that has
 * no filters. A login counts once per real day.
 *
 * @returns The rows to save.
 */
export function applyMissionCounters(
    data: MissionData,
    clock: MissionClock,
    getSaved: SavedMissionLookup,
    facts: MissionFacts,
    events: CounterEvent[]
): MissionProgressUpdate[] {
    const valid = events.filter(event => Number.isSafeInteger(event.kind) && Number.isFinite(event.amount) && event.amount > 0)
    if (valid.length === 0) return []

    // only missions the player can see count, so a locked mission doesn't fill up in advance
    const { listed } = evaluateMissions(data, MISSION_CATEGORIES, clock, getSaved, facts)
    const updates: MissionProgressUpdate[] = []

    for (const mission of listed) {
        const definition = data.missions[String(mission.category)]?.[String(mission.missionId)]
        if (!definition || definition.kind === null) continue
        const counted = countedDefinition(mission.category, definition)
        const matching = valid.filter(event => counterMatches(counted, event))
        if (matching.length === 0) continue
        const amount = matching.reduce((total, event) => total + Math.floor(event.amount), 0)

        const saved = currentSaved(mission.category, getSaved(mission.category, mission.missionId), clock)
        const dailyPeriod = periodKey(mission.category, clock)

        if (MAX_KINDS.has(definition.kind)) {
            // the best value reached, kept only when it beats the saved one
            const best = Math.max(...matching.map(event => Math.floor(event.amount)))
            if (best <= (saved?.progress ?? 0)) continue
            updates.push({
                category: mission.category,
                missionId: mission.missionId,
                progress: best,
                rewardedStage: saved?.rewardedStage ?? 0,
                period: dailyPeriod ?? saved?.period ?? null,
            })
            continue
        }

        if (definition.kind === COUNTER_KINDS.SOLO_AUTO_COMPLETE) {
            // done: progress is the last stage's target (shows as "10/10")
            const target = definition.stages[definition.stages.length - 1]?.target ?? 1
            if ((saved?.progress ?? 0) === target) continue
            updates.push({ category: mission.category, missionId: mission.missionId, progress: target, rewardedStage: saved?.rewardedStage ?? 0, period: dailyPeriod ?? saved?.period ?? null })
            continue
        }
        if (definition.kind === COUNTER_KINDS.LOGIN_DAYS) {
            // one per real day. Daily login missions use the daily period instead.
            const day = dailyPeriod ?? loginDayKey(clock)
            if (saved?.period === day) continue
            updates.push({
                category: mission.category,
                missionId: mission.missionId,
                progress: (saved?.progress ?? 0) + 1,
                rewardedStage: saved?.rewardedStage ?? 0,
                period: day,
            })
            continue
        }

        updates.push({
            category: mission.category,
            missionId: mission.missionId,
            progress: (saved?.progress ?? 0) + amount,
            rewardedStage: saved?.rewardedStage ?? 0,
            period: dailyPeriod ?? saved?.period ?? null,
        })
    }

    return updates
}

export interface MissionPayout {
    category: number
    missionId: number
    stage: number
    rewardId: number
    rewards: MissionReward[]
    /** The mission's group (campaign, or the pass of a pass mission). */
    group?: number
}

/**
 * Finds every listed mission that has cleared stages not paid yet.
 *
 * @returns The stages to pay (in order) and the rows to save, with each mission's progress and
 *          its new paid stage count. Saving the rows is what stops a stage being paid twice.
 */
export function settleMissionRewards(
    data: MissionData,
    clock: MissionClock,
    getSaved: SavedMissionLookup,
    facts: MissionFacts
): { payouts: MissionPayout[], updates: MissionProgressUpdate[] } {
    const { listed } = evaluateMissions(data, MISSION_CATEGORIES, clock, getSaved, facts)
    const payouts: MissionPayout[] = []
    const updates: MissionProgressUpdate[] = []

    for (const mission of listed) {
        const definition = data.missions[String(mission.category)]?.[String(mission.missionId)]
        if (!definition) continue
        const saved = currentSaved(mission.category, getSaved(mission.category, mission.missionId), clock)
        const paid = saved?.rewardedStage ?? 0
        if (mission.clearedStages <= paid) continue

        for (let stage = paid + 1; stage <= mission.clearedStages; stage++) {
            const stageData = definition.stages[stage - 1]
            payouts.push({
                category: mission.category,
                missionId: mission.missionId,
                stage,
                rewardId: stageData.rewardId,
                rewards: stageData.rewards,
                ...(definition.group === undefined ? {} : { group: definition.group }),
            })
        }
        updates.push({
            category: mission.category,
            missionId: mission.missionId,
            progress: mission.progress,
            rewardedStage: mission.clearedStages,
            period: periodKey(mission.category, clock) ?? saved?.period ?? null,
        })
    }

    return { payouts, updates }
}

/** What the player's account has to provide to pay rewards. Every method returns the NEW total. */
export interface MissionWallet {
    addFreeVmoney(amount: number): number
    addItem(itemId: number, amount: number): number
    addEquipment(equipmentId: number, amount: number): object
    addFreeMana(amount: number): number
    addCharacter(characterId: number): { character: object, item?: { id: number, total: number } } | null
    addExpPool(amount: number): number
    /** Gives a title; false if the player already had it. */
    addDegree?(degreeId: number): boolean
    /** Adds CN pass points to a pass; returns its new point total. */
    addPassPoint?(passId: number, amount: number): number
}

/** The parts of a reply that report paid mission rewards (the shape global used in finish replies). */
export interface MissionRewardResult {
    mission_info: { mission_category_id: number, mission_id: number, mission_reward_id: number }[]
    /** The new totals of what changed. */
    user_info: { free_vmoney?: number, free_mana?: number, exp_pool?: number }
    /** How much each user_info value went up, so a handler can add it to totals it worked out itself. */
    added: { free_vmoney: number, free_mana: number, exp_pool: number }
    item_list: Record<string, number>
    character_list: object[]
    equipment_list: object[]
    /** Titles given (new ones only). */
    new_degree_ids: number[]
    /** Rewards that couldn't be paid, for logging. */
    skipped: string[]
}

export const REWARD_KINDS = Object.freeze({
    FREE_VMONEY: 0,
    ITEM: 1,
    EQUIPMENT: 2,
    FREE_MANA: 3,
    CHARACTER: 4,
    EXP_POOL: 5,
    DEGREE: 6,
    /** CN pass points, for the pass the mission belongs to (its group). */
    PASS_POINT: 7,
})

export function emptyMissionRewardResult(): MissionRewardResult {
    return {
        mission_info: [],
        user_info: {},
        added: { free_vmoney: 0, free_mana: 0, exp_pool: 0 },
        item_list: {},
        character_list: [],
        equipment_list: [],
        new_degree_ids: [],
        skipped: [],
    }
}

/** Pays the stages and builds the reply parts. */
export function payMissionRewards(payouts: MissionPayout[], wallet: MissionWallet): MissionRewardResult {
    const result = emptyMissionRewardResult()
    for (const payout of payouts) {
        result.mission_info.push({
            mission_category_id: payout.category,
            mission_id: payout.missionId,
            mission_reward_id: payout.rewardId,
        })
        for (const reward of payout.rewards) {
            const where = `mission ${payout.category}/${payout.missionId} stage ${payout.stage}`
            switch (reward.kind) {
                case REWARD_KINDS.FREE_VMONEY:
                    result.user_info.free_vmoney = wallet.addFreeVmoney(reward.amount)
                    result.added.free_vmoney += reward.amount
                    break
                case REWARD_KINDS.FREE_MANA:
                    result.user_info.free_mana = wallet.addFreeMana(reward.amount)
                    result.added.free_mana += reward.amount
                    break
                case REWARD_KINDS.EXP_POOL:
                    result.user_info.exp_pool = wallet.addExpPool(reward.amount)
                    result.added.exp_pool += reward.amount
                    break
                case REWARD_KINDS.ITEM:
                    if (reward.itemId === undefined) { result.skipped.push(`${where}: item reward without an item id`); break }
                    result.item_list[String(reward.itemId)] = wallet.addItem(reward.itemId, reward.amount)
                    break
                case REWARD_KINDS.EQUIPMENT:
                    if (reward.equipmentId === undefined) { result.skipped.push(`${where}: equipment reward without an id`); break }
                    result.equipment_list.push(wallet.addEquipment(reward.equipmentId, reward.amount))
                    break
                case REWARD_KINDS.CHARACTER: {
                    if (reward.characterId === undefined) { result.skipped.push(`${where}: character reward without an id`); break }
                    for (let i = 0; i < reward.amount; i++) {
                        const given = wallet.addCharacter(reward.characterId)
                        if (given === null) { result.skipped.push(`${where}: character ${reward.characterId} could not be given`); break }
                        result.character_list.push(given.character)
                        if (given.item) result.item_list[String(given.item.id)] = given.item.total
                    }
                    break
                }
                case REWARD_KINDS.DEGREE: {
                    if (reward.degreeId === undefined || wallet.addDegree === undefined) { result.skipped.push(`${where}: title reward without a title id`); break }
                    if (wallet.addDegree(reward.degreeId)) result.new_degree_ids.push(reward.degreeId)
                    break
                }
                case REWARD_KINDS.PASS_POINT:
                    if (payout.group === undefined || wallet.addPassPoint === undefined) { result.skipped.push(`${where}: pass points without a pass`); break }
                    wallet.addPassPoint(payout.group, reward.amount)
                    break
                default:
                    result.skipped.push(`${where}: reward kind ${reward.kind} is not supported`)
            }
        }
    }
    return result
}
