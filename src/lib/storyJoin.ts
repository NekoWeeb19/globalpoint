// Units that join through the story (assets/story_join_character.json, from the global client's
// master/character/story_join_character; see scripts/gen_story_join.cjs).
//
// "town" units (on global only 512001, the Starview Village mushroom) are tapped in Starview Village
// once their stage is cleared. At login the global server lists the ones already picked up in
// user_character_from_town_history (recorded: [{ character_id: 512001 }]), so the game stops showing
// them there. This server doesn't keep a pickup record, so an owned town unit counts as picked up.

export interface StoryJoinUnit {
    characterId: number
    stageKind: number
    questId: number
    joinType: "town" | "quest"
    temporary: boolean
}

export interface StoryJoinData {
    units: StoryJoinUnit[]
}

/**
 * The quest category of each stage kind (the table's column 0), from the Chinese StarPoint fork's
 * src/lib/story-join-character.ts. Numbers are this server's QuestCategory values.
 */
const STAGE_KIND_CATEGORY: Readonly<Record<number, number>> = Object.freeze({
    0: 1,   // main story
    1: 4,   // EX
    2: 2,   // boss battles
    3: 6,   // daily/week events
    4: 11,  // ranking events (Time Attack)
    5: 10,  // story events
    6: 8,   // boss events (multiplayer)
    7: 13,  // challenge dungeons
    8: 14,  // EXP & mana events
    9: 18,  // world story events
    10: 19, // world story boss battles
    11: 20, // The Haunt
    12: 21, // solo boss challenges
    13: 22, // Hanifolk Carnival
    14: 3,  // character stories
    15: 23, // raids
    16: 24, // Grand Gauntlet
    17: 25, // Chrono Trials
    18: 26, // hard multi
    19: 27, // score attack
})

/** The quest category a join unit's stage belongs to, or null for an unknown kind. */
export function joinStageCategory(unit: StoryJoinUnit): number | null {
    return STAGE_KIND_CATEGORY[unit.stageKind] ?? null
}

/** The units that join when a stage is cleared ("quest" units; town units are tapped in Starview Village). */
export function questJoinCharacterIds(data: StoryJoinData, category: number, questId: number): number[] {
    return data.units
        .filter(unit => unit.joinType === "quest" && unit.questId === questId && joinStageCategory(unit) === category)
        .map(unit => unit.characterId)
}

/** The login's user_character_from_town_history: the town units the player owns. */
export function townPickupHistory(data: StoryJoinData, ownedCharacterIds: Iterable<number>): { character_id: number }[] {
    const owned = new Set(ownedCharacterIds)
    return data.units
        .filter(unit => unit.joinType === "town" && owned.has(unit.characterId))
        .map(unit => ({ "character_id": unit.characterId }))
}
