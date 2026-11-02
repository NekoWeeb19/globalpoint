// Raises the progress of active (step-up) missions as the player plays.
//
// This file has no imports on purpose. Everything it needs from the database comes in through the
// `ProgressStore` and `ProgressFacts` interfaces, so the logic can be tested without better-sqlite3
// (see scripts/test_active_mission_progress.mjs). src/nya/activeMissionProgress.ts connects it to the
// real database.
//
// How a mission counts is its "pattern", taken from the Chinese Starpoint fork's mission tables
// (assets/active_missions.json -> "patterns"). The patterns handled so far:
//
//    5  the highest level of any character                    (a value: only ever goes up)
//   34  the total number of equipment upgrades (levels above 1) (a value derived from the player's equipment)
//   36  the number of equipment pieces at the maximum level     (a value derived from the player's equipment)
//   63  exp injected into a character for the first time        (a flag: it becomes 1 and stays 1)
//   62  the number of ability nodes learned on mana boards       (derived from the learned nodes)
//   61  the number of characters that have been evolved          (derived from the characters)
//    9  the total over limit steps of all characters             (derived from the characters)
//    8  the number of bond tokens that were received             (derived from the characters)
//   45  the number of items bought in the treasure shop          (a counter: raised by the amount bought)
//    4  owning one particular character                         (derived from the characters)
//   21  the number of character stories that were finished       (derived from the quest progress)
//   35  the number of ability souls set in parties               (derived from the parties)
//   58  equipment set in a party for the first time              (a flag: becomes 1 and stays 1)
//   59  a unison character set in a party for the first time     (a flag: becomes 1 and stays 1)
//   64  equipment bought with boss coins                         (a counter: raised by the amount bought)
//   57  clearing the quests that a rule selects                  (derived from the quest progress)
//   23  clearing quests that a rule selects, as many times as asked (a counter: +1 per matching clear)
//   66  clearing every playable quest a rule selects with an S+ rank (a flag derived from the quest progress)
//   65  challenging a practice battle                            (a counter: raised by the amount)
//   13  "complete all": how many of its target missions are done
//
// Counter patterns (raised by an amount each time) go through `trigger.add`; the others are worked
// out again from the player's state with `trigger.recompute`. The quest patterns (57, 23, 66) use the
// rules in `questRules` to decide which quests count; `trigger.quest` says which quest was just cleared.
//
// A stage unlocks when the progress reaches what the stage needs. The game gets told about it in
// the `active_mission_list` of the reply to the action, in the format recorded from the real server.

export interface ActiveMissionProgressData {
    /** Mission ID -> stage -> the progress that unlocks the stage. */
    requirements: Record<string, Record<string, number>>
    /** Mission ID -> the pattern it counts with. */
    patterns: Record<string, number>
    /** "Complete all" mission ID -> the missions it counts. */
    targets: Record<string, number[]>
    /** "Obtain this character" mission ID -> the character it needs. */
    characterTargets?: Record<string, number>
    /** Quest mission ID -> which quests it counts (patterns 57, 23 and 66). */
    questRules?: Record<string, QuestRule>
    /** CN awake missions (patterns 1093, 1096, 1048): mission ID -> its conditions. */
    awakeRules?: Record<string, AwakeRule>
    /** Mission ID -> the mission stage that must be claimed before it counts (CN Content Guide). */
    prerequisites?: Record<string, { mission: number, stage: number }>
}

/**
 * A CN unit awake mission's conditions (assets/mana_awake_cn.json, scripts/gen_cn_mana_awake.cjs).
 * kind is CN's mission kind: 93/94/95/23/15 count matching clears, 28 power flips, 30 the best combo.
 */
export interface AwakeRule {
    kind: number
    /** 17: no ally may be knocked out */
    sub?: number
    /** 1 solo, 2 co-op, 3 either (default) */
    mode?: number
    /** quest range [kind, query 1, query 2, query 3] (as in the regular missions) */
    range?: [number, string | null, string | null, string | null]
    /** boss quests: the difficulty (last digit of the quest id) */
    difficulty?: number
    /** the unit whose episodes / bond tokens count (96, 48) */
    character?: number
    leader?: number
    members?: number[]
    races?: string[]
    /** episode quest ids (96) */
    list?: number[]
    /** kind 15: the clear must be within this many seconds */
    timeLimit?: number
    /** Content Guide: `character` must be at least this level (kinds 72, 73) */
    minLevel?: number
    /** Content Guide: `character` must have learned these ability slots (field6 of its mana nodes; kind 71) */
    abilitySlots?: string[]
    /** Content Guide: a unit of this element (0 fire ... 5 dark) must be in the party (kind 89) */
    element?: number
    /** Content Guide: one of these units must be in the party (kind 90: units whose skill has an effect) */
    anyOf?: number[]
}

/** A battle that was just finished, for the awake missions. */
export interface BattleFact {
    accomplished: boolean
    category: number
    questId: number
    isMulti: boolean
    leaderId: number | null
    /** main and unison units */
    memberIds: number[]
    races: string[]
    knockedOut: boolean
    clearTimeMs: number
    powerFlips: number
    maxCombo: number
}

/** What a rule may ask about the player's units (Content Guide rules). */
export interface UnitFacts {
    /** The unit's level (estimated from its exp), 0 when not owned. */
    level(characterId: number): number
    /** The ability slots (mana node field6) the unit has learned at least one node of. */
    learnedAbilitySlots(characterId: number): Set<string>
    /** The unit's element (0 fire ... 5 dark), or null when unknown. */
    element(characterId: number): number | null
}

/**
 * Which quests a quest mission counts. A quest counts when its category is listed and every
 * selector that is present accepts it. Main, EX and boss quest IDs are `first * 1000000 +
 * second * 1000 + third`; the other categories' IDs are `eventId * 1000 + questNumber`.
 */
export interface QuestRule {
    categories: number[]
    first?: number[]
    second?: number[]
    third?: number[]
    eventIds?: number[]
    questNumbers?: number[]
    /** Boss quests only: the lowest difficulty (the last digit of the quest ID) that counts. */
    minDifficulty?: number
}

/** One quest of the player's quest progress. */
export interface QuestProgressFact {
    category: number
    questId: number
    finished: boolean
    clearRank?: number | null
}

/** What the player has saved for one mission. `stages`: true = received, false = unlocked but not received. */
export interface SavedMission {
    progress: number
    stages: Record<string, boolean>
}

/** What the database side has to provide. */
export interface ProgressStore {
    /** All of the player's missions, keyed by mission ID. */
    getMissions(): Record<string, SavedMission>
    setProgress(missionId: number, progress: number): void
    /** Saves the stage as unlocked (not received), if it isn't saved yet. */
    unlockStage(missionId: number, stage: number): void
}

/** The player's current state, read only when a mission needs it. */
export interface ProgressFacts {
    /** The player's units (Content Guide rules). */
    units?: UnitFacts
    /** The level of each piece of equipment the player owns. */
    equipmentLevels(): number[]
    /** Each character's rarity and exp. */
    characters(): { rarity: number, exp: number }[]
    /** How many ability nodes (not stat nodes) the player has learned, over all characters. */
    abilityNodeCount(): number
    /** How many characters have been evolved. */
    evolvedCharacterCount(): number
    /** The over limit steps of all characters added together. */
    overLimitTotal(): number
    /** How many bond tokens the player has received. */
    bondTokenCount(): number
    /** The IDs of the characters the player owns. */
    ownedCharacterIds(): number[]
    /** How many character stories the player has finished. */
    finishedCharacterStoryCount(): number
    /** How many equipment slots are filled, over all parties. */
    partyEquipmentCount(): number
    /** How many unison character slots are filled, over all parties. */
    partyUnisonCount(): number
    /** How many ability soul slots are filled, over all parties. */
    partyAbilitySoulCount(): number
    /** Every quest the player has any progress on, in every category. */
    questProgress(): QuestProgressFact[]
    /** The IDs of the quests of a category that can be played as a battle (they have a clear rank). */
    battleQuestIds(category: number): number[]
    /** Whether a unit has received all of its bond tokens (CN awake missions). */
    allBondTokens?(characterId: number): boolean
    /** Whether a quest is in a mission's quest range (CN awake missions; lib/mission.ts questInRangeQuery). */
    questInRange?(range: [number, string | null, string | null, string | null], category: number, questId: number): boolean
}

/** Whether a finished battle counts for an awake battle mission. */
export function awakeBattleMatches(rule: AwakeRule, battle: BattleFact, facts: ProgressFacts): boolean {
    if (!battle.accomplished) return false
    const mode = rule.mode ?? 3
    if (mode === 1 && battle.isMulti) return false
    if (mode === 2 && !battle.isMulti) return false
    if (rule.leader !== undefined && battle.leaderId !== rule.leader) return false
    if (rule.members !== undefined && !rule.members.every(id => battle.memberIds.includes(id))) return false
    if (rule.races !== undefined && !rule.races.every(race => battle.races.includes(race))) return false
    if (rule.sub === 17 && battle.knockedOut) return false
    if (rule.timeLimit !== undefined && (battle.clearTimeMs <= 0 || battle.clearTimeMs > rule.timeLimit * 1000)) return false
    if (rule.range !== undefined) {
        if (facts.questInRange === undefined || !facts.questInRange(rule.range, battle.category, battle.questId)) return false
        // boss quests: the difficulty is the quest number (1028004 = boss 28, difficulty 4)
        if (rule.difficulty !== undefined && battle.questId % 1000 !== rule.difficulty) return false
    }
    // Content Guide conditions
    if (rule.anyOf !== undefined && !battle.memberIds.some(id => rule.anyOf!.includes(id))) return false
    if (rule.minLevel !== undefined || rule.abilitySlots !== undefined || rule.element !== undefined) {
        const units = facts.units
        if (units === undefined) return false
        if (rule.minLevel !== undefined && (rule.character === undefined || units.level(rule.character) < rule.minLevel)) return false
        if (rule.abilitySlots !== undefined) {
            const learned = rule.character === undefined ? new Set<string>() : units.learnedAbilitySlots(rule.character)
            if (!rule.abilitySlots.every(slot => learned.has(slot))) return false
        }
        if (rule.element !== undefined && !battle.memberIds.some(id => units.element(id) === rule.element)) return false
    }
    return true
}

/** What happened to one mission, in the format of the reply's `active_mission_list`. */
export interface ActiveMissionDelta {
    mission_id: number
    progress_value: number
    /** Only the stages that were unlocked by this change. */
    stages: { stage: number, received: boolean }[]
}

/** What just happened. */
export interface ProgressTrigger {
    /** Patterns to work out again from the player's current state. */
    recompute?: number[]
    /** Counter patterns to raise, and by how much. */
    add?: Record<number, number>
    /** Count every "complete all" mission again, even if none of its targets changed (for catching up at login). */
    refreshAllClear?: boolean
    /** A battle quest that was just cleared (for the "clear this quest N times" missions). */
    quest?: { category: number, questId: number }
    /** A battle that was just finished (CN awake missions). */
    battle?: BattleFact
}

export const PATTERN = {
    /** CN Content Guide: opened the guide (contents_guide/start), 1 when done */
    CONTENTS_GUIDE_START: 1074,
    /** CN awake missions: a battle with conditions (counts clears, power flips or the best combo) */
    AWAKE_BATTLE: 1093,
    /** CN awake missions: read all of a unit's episodes (1 when done) */
    AWAKE_EPISODES: 1096,
    /** CN awake missions: receive all of a unit's bond tokens (1 when done) */
    AWAKE_BOND_TOKENS: 1048,
    /** CN awake missions: mana obtained in battles (a counter) */
    MANA_OBTAINED: 1002,
    CHARACTER_LEVEL: 5,
    TARGET_MISSION_CLEAR: 13,
    UPGRADE_EQUIPMENT_COUNT: 34,
    LEVEL_MAX_EQUIPMENT_COUNT: 36,
    INJECTED_EXP_FIRST_TIME: 63,
    OBTAIN_CHARACTER: 4,
    EPISODE_CLEAR_COUNT: 21,
    PARTY_ABILITY_SOUL_COUNT: 35,
    EQUIPPED_FIRST_TIME: 58,
    UNISON_SET_FIRST_TIME: 59,
    BOSS_COIN_EQUIPMENT_PURCHASE_COUNT: 64,
    OBTAINED_BOND_TOKEN_COUNT: 8,
    OVER_LIMIT_TOTAL: 9,
    TREASURE_SHOP_PURCHASE_COUNT: 45,
    EVOLVED_CHARACTER_COUNT: 61,
    ABILITY_NODE_COUNT: 62,
    BATTLE_CLEAR_COUNT: 23,
    QUEST_CLEAR: 57,
    QUEST_CHALLENGE: 65,
    CHAPTER_COMPLETE: 66,
} as const

/** The clear rank that counts as "SS" (S+). */
export const CLEAR_RANK_S_PLUS = 5

/** Whether a quest is one that the rule counts. */
export function matchesQuestRule(rule: QuestRule, category: number, questId: number): boolean {
    if (!rule.categories.includes(category)) return false
    const accepts = (selector: number[] | undefined, value: number) => selector === undefined || selector.includes(value)
    const third = questId % 1000
    return accepts(rule.first, Math.floor(questId / 1_000_000))
        && accepts(rule.second, Math.floor((questId % 1_000_000) / 1000))
        && accepts(rule.third, third)
        && accepts(rule.eventIds, Math.floor(questId / 1000))
        && accepts(rule.questNumbers, third)
        && (rule.minDifficulty === undefined || third >= rule.minDifficulty)
}

/** The highest level a piece of equipment can be upgraded to. */
export const EQUIPMENT_MAX_LEVEL = 5

// ---- character level ----

/**
 * Estimates a character's level from its exp. Starpoint doesn't store levels, only the exp caps of
 * each uncap step, so this is approximate:
 *
 * - From the first exp cap upward it uses the rarity's own caps (every 5 levels), so it's exact at
 *   each cap and linear in between.
 * - Below the first cap it uses the 1-star curve, scaled to the rarity. 1 to 3 star characters share
 *   one curve (their caps agree), so level 40 is exact for them. For 4 and 5 star characters it's an
 *   estimate, and below level 40 the shape of the curve is a guess.
 *
 * @param expCaps The exp needed at each uncap level, per rarity (the `characterExpCaps` table).
 */
export function estimateCharacterLevel(rarity: number, exp: number, expCaps: Record<number, number[]>): number {
    const caps = expCaps[rarity]
    const oneStarCaps = expCaps[1]
    if (!caps || caps.length === 0 || !oneStarCaps || oneStarCaps.length === 0) return 0
    if (exp <= 0) return 1

    const firstLevel = (r: number) => 40 + (r - 1) * 10 // the level of a rarity's first cap

    // the 1-star curve through its caps: level -> exp, with a guessed shape from level 1 up to level 40
    const oneStarExp = (level: number): number => {
        const base = firstLevel(1)
        if (level <= 1) return 0
        if (level < base) return oneStarCaps[0] * Math.pow((level - 1) / (base - 1), 2)
        const index = Math.min(Math.floor((level - base) / 5), oneStarCaps.length - 1)
        const from = oneStarCaps[index]
        const to = oneStarCaps[Math.min(index + 1, oneStarCaps.length - 1)]
        const into = level - (base + index * 5)
        return index >= oneStarCaps.length - 1 ? from : from + (to - from) * (into / 5)
    }

    const baseLevel = firstLevel(rarity)
    if (exp >= caps[0]) {
        // the rarity's own caps
        let level = baseLevel
        for (let index = 0; index < caps.length; index++) {
            if (exp < caps[index]) break
            level = baseLevel + index * 5
            const next = caps[index + 1]
            if (next !== undefined && exp < next) {
                level += Math.floor(((exp - caps[index]) / (next - caps[index])) * 5)
                break
            }
        }
        return level
    }

    // below the first cap: the 1-star curve scaled so that it passes through this rarity's first cap
    const scale = caps[0] / oneStarExp(baseLevel)
    let level = 1
    for (let candidate = 2; candidate < baseLevel; candidate++) {
        if (oneStarExp(candidate) * scale <= exp) level = candidate
        else break
    }
    return level
}

// ---- working out each pattern ----

function evaluateValuePattern(
    pattern: number,
    missionId: number,
    data: ActiveMissionProgressData,
    facts: ProgressFacts,
    expCaps: Record<number, number[]>
): number | null {
    switch (pattern) {
        case PATTERN.OBTAIN_CHARACTER: {
            const target = data.characterTargets?.[String(missionId)]
            if (target === undefined) return facts.ownedCharacterIds().length
            return facts.ownedCharacterIds().includes(target) ? 1 : 0
        }
        case PATTERN.EPISODE_CLEAR_COUNT:
            return facts.finishedCharacterStoryCount()
        case PATTERN.PARTY_ABILITY_SOUL_COUNT:
            return facts.partyAbilitySoulCount()
        case PATTERN.EQUIPPED_FIRST_TIME:
            return facts.partyEquipmentCount() > 0 ? 1 : 0
        case PATTERN.UNISON_SET_FIRST_TIME:
            return facts.partyUnisonCount() > 0 ? 1 : 0
        case PATTERN.CHARACTER_LEVEL:
            return facts.characters().reduce(
                (highest, character) => Math.max(highest, estimateCharacterLevel(character.rarity, character.exp, expCaps)),
                0
            )
        case PATTERN.UPGRADE_EQUIPMENT_COUNT:
            return facts.equipmentLevels().reduce((total, level) => total + Math.max(0, level - 1), 0)
        case PATTERN.LEVEL_MAX_EQUIPMENT_COUNT:
            return facts.equipmentLevels().filter(level => level >= EQUIPMENT_MAX_LEVEL).length
        case PATTERN.ABILITY_NODE_COUNT:
            return facts.abilityNodeCount()
        case PATTERN.EVOLVED_CHARACTER_COUNT:
            return facts.evolvedCharacterCount()
        case PATTERN.OVER_LIMIT_TOTAL:
            return facts.overLimitTotal()
        case PATTERN.OBTAINED_BOND_TOKEN_COUNT:
            return facts.bondTokenCount()
        case PATTERN.INJECTED_EXP_FIRST_TIME:
            // the real server reports this mission once, on the first injection, and never raises it
            // again, so an injection that just happened makes it 1
            return 1
        default:
            return null // not handled (yet)
    }
}

/** The value of a quest mission, worked out from the quest progress. Null when it can't be told. */
function evaluateQuestPattern(pattern: number, rule: QuestRule, progress: QuestProgressFact[], facts: ProgressFacts): number | null {
    switch (pattern) {
        case PATTERN.QUEST_CLEAR:
        case PATTERN.BATTLE_CLEAR_COUNT:
            // how many of the quests it counts have been cleared (a repeat clear is added by trigger.quest)
            return progress.filter(quest => quest.finished && matchesQuestRule(rule, quest.category, quest.questId)).length
        case PATTERN.CHAPTER_COMPLETE: {
            const category = rule.categories[0]
            const targets = facts.battleQuestIds(category).filter(questId => matchesQuestRule(rule, category, questId))
            if (targets.length === 0) return null
            const ranks = new Map(progress.filter(quest => quest.category === category).map(quest => [quest.questId, quest.clearRank]))
            return targets.every(questId => ranks.get(questId) === CLEAR_RANK_S_PLUS) ? 1 : 0
        }
        default:
            return null
    }
}

/**
 * Updates the progress of every mission the trigger affects, unlocks the stages that reach their
 * requirement, and returns what changed, for the reply's `active_mission_list`.
 *
 * A mission's progress never goes down (selling equipment doesn't undo an upgrade), and a mission
 * that didn't change isn't reported.
 */
export function updateActiveMissionProgress(
    data: ActiveMissionProgressData,
    store: ProgressStore,
    facts: ProgressFacts,
    trigger: ProgressTrigger,
    expCaps: Record<number, number[]>
): ActiveMissionDelta[] {
    const saved = store.getMissions()
    const deltas = new Map<number, ActiveMissionDelta>()

    const progressOf = (missionId: number) => saved[String(missionId)]?.progress ?? 0

    // unlocks the stages of a mission that its progress has reached and that aren't saved yet
    const unlockReached = (missionId: number): { stage: number, received: boolean }[] => {
        const key = String(missionId)
        const stageRequirements = data.requirements[key] ?? {}
        const mission = saved[key]
        const unlocked: { stage: number, received: boolean }[] = []
        if (mission === undefined) return unlocked
        for (const stage of Object.keys(stageRequirements).map(Number).sort((a, b) => a - b)) {
            if (mission.progress >= stageRequirements[String(stage)] && mission.stages[String(stage)] === undefined) {
                store.unlockStage(missionId, stage)
                mission.stages[String(stage)] = false
                unlocked.push({ stage, received: false })
            }
        }
        return unlocked
    }

    // remembers what changed; a mission that changed twice in one go is reported once, with everything it unlocked
    const report = (missionId: number, unlocked: { stage: number, received: boolean }[], progressChanged: boolean) => {
        const earlier = deltas.get(missionId)
        if (earlier === undefined && !progressChanged && unlocked.length === 0) return
        deltas.set(missionId, {
            mission_id: missionId,
            progress_value: saved[String(missionId)]?.progress ?? 0,
            stages: [...(earlier?.stages ?? []), ...unlocked]
        })
    }

    // raises one mission to `value` (if that's higher), unlocking its stages
    const raise = (missionId: number, value: number) => {
        if (!Number.isFinite(value) || value <= progressOf(missionId)) return
        const key = String(missionId)

        store.setProgress(missionId, value)
        const mission = saved[key] ?? (saved[key] = { progress: 0, stages: {} })
        mission.progress = value

        report(missionId, unlockReached(missionId), true)
    }

    // 1) the missions that count the thing that just happened
    const recompute = new Set(trigger.recompute ?? [])
    const add = trigger.add ?? {}
    let questProgress: QuestProgressFact[] | null = null // read once, and only if a quest mission needs it
    for (const key of Object.keys(data.patterns).sort((a, b) => Number(a) - Number(b))) {
        const missionId = Number(key)
        const pattern = data.patterns[key]
        if (pattern === PATTERN.TARGET_MISSION_CLEAR) continue // done in the next step
        // a mission that waits for another one counts only once that one's stage has been claimed
        const before = data.prerequisites?.[key]
        if (before !== undefined && saved[String(before.mission)]?.stages[String(before.stage)] !== true) continue

        if (pattern === PATTERN.AWAKE_BATTLE) {
            const rule = data.awakeRules?.[key]
            if (rule === undefined || trigger.battle === undefined || !awakeBattleMatches(rule, trigger.battle, facts)) continue
            if (rule.kind === 28) raise(missionId, progressOf(missionId) + trigger.battle.powerFlips)
            else if (rule.kind === 30) raise(missionId, trigger.battle.maxCombo)
            else raise(missionId, progressOf(missionId) + 1)
            continue
        }
        if (pattern === PATTERN.AWAKE_EPISODES || pattern === PATTERN.AWAKE_BOND_TOKENS) {
            const rule = data.awakeRules?.[key]
            if (rule === undefined || !recompute.has(pattern)) continue
            if (pattern === PATTERN.AWAKE_EPISODES) {
                questProgress ??= facts.questProgress()
                const done = new Set(questProgress.filter(quest => quest.finished).map(quest => quest.questId))
                raise(missionId, (rule.list ?? []).filter(id => done.has(id)).length) // episodes read (target = all of them)
            } else if (rule.character !== undefined && facts.allBondTokens !== undefined) {
                raise(missionId, facts.allBondTokens(rule.character) ? 1 : 0)
            }
            continue
        }

        if (pattern === PATTERN.QUEST_CLEAR || pattern === PATTERN.BATTLE_CLEAR_COUNT || pattern === PATTERN.CHAPTER_COMPLETE) {
            const rule = data.questRules?.[key]
            if (rule === undefined) continue
            if (pattern === PATTERN.BATTLE_CLEAR_COUNT && trigger.quest !== undefined) {
                // every clear of a quest it counts is one more
                if (matchesQuestRule(rule, trigger.quest.category, trigger.quest.questId)) raise(missionId, progressOf(missionId) + 1)
            } else if (recompute.has(pattern)) {
                questProgress ??= facts.questProgress()
                const value = evaluateQuestPattern(pattern, rule, questProgress, facts)
                if (value !== null) raise(missionId, value)
            }
            continue
        }
        if (add[pattern] !== undefined) {
            raise(missionId, progressOf(missionId) + add[pattern])
        } else if (recompute.has(pattern)) {
            const value = evaluateValuePattern(pattern, missionId, data, facts, expCaps)
            if (value !== null) raise(missionId, value)
        }
    }

    // 2) the "complete all" missions, if any of their targets changed
    for (const key of Object.keys(data.targets)) {
        const missionId = Number(key)
        if (!trigger.refreshAllClear && !data.targets[key].some(target => deltas.has(target))) continue
        const done = data.targets[key].filter(target => {
            const needed = Math.max(0, ...Object.values(data.requirements[String(target)] ?? {}))
            return needed > 0 && progressOf(target) >= needed
        }).length
        raise(missionId, done)
    }

    // 3) when catching up (at login), also unlock the stages that a mission's progress has already reached
    // but that were never saved, for example when the progress was counted before the stage existed
    if (trigger.refreshAllClear) {
        for (const key of Object.keys(saved)) {
            const unlocked = unlockReached(Number(key))
            if (unlocked.length > 0) report(Number(key), unlocked, false)
        }
    }

    return Array.from(deltas.values()).sort((a, b) => a.mission_id - b.mission_id)
}
