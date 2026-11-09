import { clientSerializeDate } from "../data/utils";
import { getPlayerCharacterSync, getPlayerSync, givePlayerItemSync, insertPlayerCharacterSync, updatePlayerCharacterSync, updatePlayerSync } from "../data/wdfpData";
import { getCharacterDataSync, getCharacterManaNodesSync } from "./assets";
import getDatabase, { Database } from "../data";
import { inCnRequest } from "./cnClient";
import { AddExpList, AddExpListItem, ClientReturnBondTokenStatus, ClientReturnBondTokenStatusList, ClientReturnCharacter, Element, GivePlayerCharacterResult, RewardPlayerCharacterExpResult } from "./types";

export const characterExpCaps: Record<number, number[]> = {
    [1]: [ // 1* max exp amounts for each uncap level 
        11416,  // level 40
        15820,  // level 45
        21477,  // level 50
        28538,  // level 55
        37241,  // level 60
        49481,  // level 65
        66600,  // level 70
        91180,  // level 75
        125223, // level 80
        170928, // level 85
        216633, // level 90
        262338, // level 95
        308043, // level 100
    ],
    [2]: [ // 2* max exp amounts for each uncap level 
        21477,  // level 50
        28538,  // level 55
        37241,  // level 60
        49481,  // level 65
        66600,  // level 70
        91180,  // level 75
        125223, // level 80
        170928, // level 85
        216633, // level 90
        262338, // level 95
        308043, // level 100
    ],
    [3]: [ // 3* max exp amounts for each uncap level 
        37241,  // level 60
        49481,  // level 65
        66600,  // level 70
        91180,  // level 75
        125223, // level 80
        170928, // level 85
        216633, // level 90
        262338, // level 95
        308043  // level 100
    ], 
    [4]: [ // 4* max exp amounts for each uncap level 
        76272,  // level 70
        102829, // level 75
        139190, // level 80
        189995, // level 85
        240800, // level 90
        291605, // level 95
        342410  // level 100
    ],
    [5]: [ // 5* max exp amounts for each uncap level 
        153988, // level 80
        210488, // level 85
        266988, // level 90
        323488, // level 95
        379988, // level 100
    ],
}

/**
 * The same caps for the CN client. CN has one EXP curve for every rarity
 * (master/character/character_level, equal to global's 1-3* curve), so its 4* and 5* units reach each
 * level with less EXP than global's (CN level 100 = 308043 EXP, global 5* = 379988). Each rarity keeps
 * its own levels (5*: 80, 85 ... 100); only the EXP at each level comes from the shared curve.
 */
export const cnCharacterExpCaps: Record<number, number[]> = Object.fromEntries(Object.entries(characterExpCaps).map(([rarity, caps]) => {
    const oneStar = characterExpCaps[1] // levels 40, 45 ... 100
    const firstIndex = (Number(rarity) - 1) * 2 // the rarity's first cap level (40 + (rarity - 1) * 10) in that list
    return [rarity, caps.map((_, i) => oneStar[firstIndex + i])]
}))

/** The caps for the client making the current request: CN's curve for the CN client, global's otherwise. */
export function expCapsForRequest(): Record<number, number[]> {
    return inCnRequest() ? cnCharacterExpCaps : characterExpCaps
}

const dupeItemRewards: Record<number, Record<Element, number>> = {
    [3]: { // 3* dupe item rewards for each element
        [Element.FIRE]: 14001,
        [Element.WATER]: 14004,
        [Element.LIGHTNING]: 14007,
        [Element.WIND]: 14010,
        [Element.LIGHT]: 14016,
        [Element.DARK]: 14013
    },
    [4]: { // 4* dupe item rewards for each element
        [Element.FIRE]: 14002,
        [Element.WATER]: 14005,
        [Element.LIGHTNING]: 14008,
        [Element.WIND]: 14011,
        [Element.LIGHT]: 14017,
        [Element.DARK]: 14014
    },
    [5]: { // 5* dupe item rewards for each element
        [Element.FIRE]: 14003,
        [Element.WATER]: 14006,
        [Element.LIGHTNING]: 14009,
        [Element.WIND]: 14012,
        [Element.LIGHT]: 14018,
        [Element.DARK]: 14015
    }
};

/**
 * Rewards a player a character.
 * 
 * @param playerId The ID of the player.
 * @param characterId The ID of the character to give.
 * @returns An items list, indicating what, if any, items were given to the player.
 */
export function givePlayerCharacterSync(
    playerId: number,
    characterId: number
): GivePlayerCharacterResult | null {

    // get the character's asset data
    const assetData = getCharacterDataSync(characterId)
    if (assetData === null) return null;

    // get the current character data
    const playerCharacter = getPlayerCharacterSync(playerId, characterId)

    if (playerCharacter === null) {
        const bondTokenList = [
            {
                manaBoardIndex: 1,
                status: 0
            }
        ]

        // add the second bond token list item if the character has more than 1 mana board: global's data
        // (skill_count) or a board 2 in any board data (CN added board 2 to units global never gave one)
        if (assetData.skill_count > 3 || getCharacterManaNodesSync(characterId, 2) !== null) {
            bondTokenList.push({
                manaBoardIndex: 2,
                status: 0
            })
        }

        // give the player the character
        const joinTime = new Date()
        insertPlayerCharacterSync(playerId, characterId, {
            entryCount: 1,
            evolutionLevel: 0,
            overLimitStep: 0,
            protection: false,
            joinTime: joinTime,
            updateTime: joinTime,
            exp: 0,
            stack: 0,
            manaBoardIndex: 1,
            bondTokenList: bondTokenList
        })
        
        const serializedDate = clientSerializeDate(joinTime)
        return {
            character: {
                "viewer_id": 0,
                "character_id": characterId,
                "entry_count": 1,
                "exp": 0,
                "exp_total": 0,
                "bond_token_list": bondTokenList.map(bondToken => {
                    return {
                        "mana_board_index": bondToken.manaBoardIndex,
                        "status": bondToken.status
                    }
                }),
                "mana_board_index": 1,
                "create_time": serializedDate,
                "update_time": serializedDate,
                "join_time": serializedDate,
            }
        }
    } else {
        // otherwise, it was a dupe
        const dupeRewards = dupeItemRewards[assetData.rarity]
        let returnItem = undefined
        if (dupeRewards) {
            const itemId = dupeRewards[assetData.element]
            givePlayerItemSync(playerId, itemId, 1)
            returnItem = {
                id: itemId,
                count: 1
            }
        }

        // update stack
        const newStack = playerCharacter.stack + 1
        updatePlayerCharacterSync(playerId, characterId, {
            stack: newStack
        })

        return {
            character: {
                "character_id": characterId,
                // the CN game needs it on every unit it's sent (C2274 "entry_count doesn't exist" otherwise, e.g. a unit
                // bought several times at once in the Star Speck exchange, or one already owned)
                "entry_count": playerCharacter.entryCount,
                "stack": newStack,
                "create_time": clientSerializeDate(playerCharacter.joinTime),
                "update_time": clientSerializeDate(playerCharacter.updateTime),
                "join_time": clientSerializeDate(playerCharacter.joinTime),
            },
            item: returnItem
        }
    }
}

/**
 * Gives every owned unit that has a Mana Board 2 (in any board data) its board-2 bond token. Units whose board 2
 * only CN has (e.g. 151141, 151147, 161177) were given one token, as global's data has one board for them, and
 * opening their board 2 was refused (H400 on character/open_mana_board). Returns how many were added.
 */
export function addMissingBoardTwoBondTokensSync(playerId: number): number {
    const db = getDatabase(Database.WDFP_DATA)
    const missing = db.prepare(`
    SELECT c.id FROM players_characters c
    WHERE c.player_id = ? AND NOT EXISTS (
        SELECT 1 FROM players_characters_bond_tokens b
        WHERE b.player_id = c.player_id AND b.character_id = c.id AND b.mana_board_index = 2)
    `).all(playerId) as { id: number }[]
    const insert = db.prepare(`INSERT INTO players_characters_bond_tokens (mana_board_index, status, player_id, character_id) VALUES (2, 0, ?, ?)`)
    let added = 0
    for (const { id } of missing) {
        if (getCharacterManaNodesSync(id, 2) === null) continue
        insert.run(playerId, id)
        added++
    }
    return added
}

/**
 * Adds a given amount of exp to a list of characters.
 * 
 * @param playerId The ID of the player who owns the characters.
 * @param characterIds A list of character IDs to add exp to.
 * @param expAmount The amount of exp to add.
 * @returns A RewardPlayerCharacterExpResult, detailing how much exp was added.
 */
export function givePlayerCharactersExpSync(
    playerId: number,
    characterIds: number[],
    expAmount: number,
    ignoreUpdate: boolean
): RewardPlayerCharacterExpResult {

    const addExpList: AddExpList = []
    const characterList: ClientReturnCharacter[] = []
    const bondTokenStatusList: ClientReturnBondTokenStatusList = {}

    let addToExpPool = 0

    for (const characterId of characterIds) {
        const characterData = getPlayerCharacterSync(playerId, characterId)
        const assetData = getCharacterDataSync(characterId)
        
        if ((characterData !== null) && (assetData !== null) && !ignoreUpdate) {
            const expCap = characterExpCaps[assetData.rarity][characterData.overLimitStep] || Number.MAX_SAFE_INTEGER
            const currentExp = characterData.exp

            let afterExp = currentExp + expAmount
            const overflowExp = afterExp > expCap ? afterExp - expCap : 0
            addToExpPool += overflowExp

            afterExp = Math.min(expCap, afterExp)

            updatePlayerCharacterSync(playerId, characterId, {
                exp: afterExp
            })

            addExpList.push({
                character_id: characterId,
                add_exp: overflowExp > 0 ? overflowExp - expAmount : expAmount,
                after_exp: afterExp,
                add_exp_pool: overflowExp
            })

            characterList.push({
                "character_id": characterId,
                "exp": afterExp,
                "create_time": clientSerializeDate(characterData.joinTime),
                "update_time": clientSerializeDate(characterData.updateTime),
                "join_time": clientSerializeDate(characterData.joinTime),
                "exp_total": afterExp
            })

            // insert bondTokenStatusList entry
            const bondTokenStatus: ClientReturnBondTokenStatus[] = characterData.bondTokenList.map(entry => {
                return {
                    mana_board_index: entry.manaBoardIndex,
                    status: entry.status
                }
            })

            bondTokenStatusList[characterId] = {
                before: bondTokenStatus,
                after: bondTokenStatus
            }
        } else {
            addExpList.push({
                character_id: characterId,
                add_exp: 0,
                after_exp : 379988,
                add_exp_pool: 0
            } as AddExpListItem)
        }
    }

    // get player data
    const playerData = getPlayerSync(playerId)
    const currentExpPool = playerData ? playerData.expPool : null
    const afterExpPool = currentExpPool === null ? null : currentExpPool + addToExpPool
    
    if (afterExpPool !== null && addToExpPool > 0) {
        updatePlayerSync({
            id: playerId,
            expPool: afterExpPool
        })
    }

    return {
        add_exp_list: addExpList,
        character_list: characterList,
        bond_token_status_list: bondTokenStatusList,
        exp_pool: afterExpPool === null ? 0 : afterExpPool
    }
}

/**
 * Gets the current evolution image levels for an array of character ids for a player.
 * 
 * @param playerId The ID of the player.
 * @param characterIds The array of character ids.
 * @returns 
 */
export function getCharactersEvolutionImgLevels(
    playerId: number,
    characterIds: (number | null)[]
): (number | null)[] {
    const evolutionImgLevels: (number | null)[] = []
    for (const id of characterIds) {
        if (id !== null) {
            const character = getPlayerCharacterSync(playerId, id)
            const illustrationSettings = character?.illustrationSettings ?? [null]
            const evolutionLevel = character?.evolutionLevel ?? 0
            evolutionImgLevels.push(illustrationSettings[0] === null ? evolutionLevel : illustrationSettings[0])
        } else {
            evolutionImgLevels.push(null)
        }
    }
    return evolutionImgLevels
}