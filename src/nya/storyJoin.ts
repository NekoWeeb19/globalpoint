// Gives the units that join when a story stage is cleared (src/lib/storyJoin.ts). On global these are
// unit 10 after main stage 2-9-7 and unit 213013 after 10-15-3; their stages' clear rewards are only
// items, so nothing gave the units before.

import storyJoinData from "../../assets/story_join_character.json"
import { getPlayerCharacterSync, getPlayerSingleQuestProgressSync } from "../data/wdfpData"
import { givePlayerCharacterSync } from "../lib/character"
import { StoryJoinData, joinStageCategory, questJoinCharacterIds } from "../lib/storyJoin"

const data = storyJoinData as StoryJoinData

export interface JoinedUnits {
    /** The new units' entries for the reply's character_list. */
    character_list: Object[]
    /** Their ids, for the reply's joined_character_id_list (the game shows them joining). */
    joined_character_id_list: number[]
}

/** Gives the units that join on this stage (call it on the stage's first clear). Owned units are skipped. */
export function giveQuestJoinUnitsSync(playerId: number, category: number, questId: number): JoinedUnits {
    const result: JoinedUnits = { character_list: [], joined_character_id_list: [] }
    for (const characterId of questJoinCharacterIds(data, category, questId)) {
        if (getPlayerCharacterSync(playerId, characterId) !== null) continue
        const given = givePlayerCharacterSync(playerId, characterId)
        if (given?.character === undefined) continue
        result.character_list.push(given.character)
        result.joined_character_id_list.push(characterId)
        console.log(`[story join] Player ${playerId}: unit ${characterId} joined (stage ${questId}).`)
    }
    return result
}

/**
 * For saves that cleared a join stage before this was handled (or had it cleared another way): gives
 * the unit at login, without the joining scene. Call it before the player data is read.
 */
export function catchUpQuestJoinUnitsSync(playerId: number): number[] {
    const given: number[] = []
    for (const unit of data.units) {
        if (unit.joinType !== "quest") continue
        const category = joinStageCategory(unit)
        if (category === null || getPlayerCharacterSync(playerId, unit.characterId) !== null) continue
        if (getPlayerSingleQuestProgressSync(playerId, category, unit.questId)?.finished !== true) continue
        if (givePlayerCharacterSync(playerId, unit.characterId)?.character !== undefined) {
            given.push(unit.characterId)
            console.log(`[story join] Player ${playerId}: unit ${unit.characterId} given at login (stage ${unit.questId} was already cleared).`)
        }
    }
    return given
}
