import { randomInt } from "crypto";
import { clientSerializeDate } from "../data/utils";
import { getPlayerCharacterSync, getPlayerItemSync, getPlayerSync, givePlayerItemSync, updatePlayerSync } from "../data/wdfpData";
import { getRareScoreRewardGroup } from "./assets";
import { givePlayerCharacterSync } from "./character";
import { givePlayerEquipmentSync } from "./equipment";
import { CharacterReward, CommonScoreReward, CurrencyReward, CurrencyScoreReward, DropScoreRewardId, EquipmentItemReward, GivePlayerScoreRewardsResult, ItemScoreReward, PlayerRewardResult, RareScoreRewardGroup, Reward, RewardType, ScoreReward, ScoreRewardType } from "./types";
import { Player } from "../data/types";
import { itemDropMultiplier, multipliedDrop } from "./rewardCampaign";
import elementItemMap from "../../assets/reward_element_map.json";
import questElements from "../../assets/quest_elements.json";

// Element-material drops (score reward type 6): the reward's id is the tier (1-3) and the item is the
// one of the element the stage's enemies have, the element the stage's recommended one beats
// (fire beats wind, water fire, thunder water, wind thunder, light dark, dark light). Same rule as the
// Chinese fork (lib/quest/score-reward-selection.ts); stage elements from scripts/gen_quest_elements.cjs.
const ELEMENT_DROP = 6
const ENEMY_ELEMENT: Record<number, number> = { 0: 3, 1: 0, 2: 1, 3: 2, 4: 5, 5: 4 }
// quest category -> its table in assets/quest_elements.json
const ELEMENT_TABLES: Record<number, string> = {
    1: "main_quest", 2: "boss_battle_quest", 4: "ex_quest", 7: "advent_event_quest", 8: "advent_event_quest",
    10: "story_event_single_quest", 13: "challenge_dungeon_event_quest", 18: "world_story_event_quest",
    19: "world_story_event_boss_battle_quest", 21: "expert_single_event_quest", 26: "hard_multi_event_quest",
}

/** A stage's recommended element (0 fire ... 5 dark), or undefined when not known. */
export function questElement(category: number, questId: number): number | undefined {
    const table = (questElements as Record<string, Record<string, number>>)[ELEMENT_TABLES[category]]
    return table?.[String(questId)]
}

/** The item an element-material drop of `tier` gives on a stage of `element`, or undefined. */
export function elementDropItemId(tier: number, element: number | undefined): number | undefined {
    if (element === undefined) return undefined
    const enemy = ENEMY_ELEMENT[element]
    return (elementItemMap as Record<string, Record<string, Record<string, number>>>)["1"]?.[String(tier)]?.[String(enemy)]
}

/**
 * Grants a player score rewards.
 * 
 * @param playerId The ID of the player.
 * @param groupId The ID of the score reward group.
 * @param scoreRewards The score rewards inside of the group.
 * @returns A result detailing what was added/changed.
 */
export function givePlayerScoreRewardsSync(
    playerId: number,
    groupId?: number,
    scoreRewards?: ScoreReward[],
    boostPointUsed: boolean = false,
    /** A reward campaign's item rate (1 without one); see src/lib/rewardCampaign.ts. */
    itemCampaignRate: number = 1,
    /** The stage's recommended element, for element-material drops (questElement()). */
    stageElement?: number,
): GivePlayerScoreRewardsResult {
    // drops are multiplied by the campaign rate, plus 1 with a boost (a boost alone doubles them)
    const dropMultiplier = itemDropMultiplier(itemCampaignRate, boostPointUsed)

    const dropScoreRewardIds: DropScoreRewardId[] = []
    const dropRareRewardIds: DropScoreRewardId[] = []

    let mana = 0
    let vmoney = 0
    let expPool = 0
    let joinedCharacterIdList: number[] = []
    let characterList: Object[] = []
    let equipmentList: Object[] = []
    let items: Record<string, number> = {}

    if (scoreRewards !== undefined && groupId !== undefined) {
        let rewardIndex = 0
        for (const scoreReward of scoreRewards) {
            rewardIndex += 1;
            switch (scoreReward.type) {
                case ScoreRewardType.ITEM: {
                    const reward = scoreReward as CommonScoreReward

                    let rewardAmount = 0

                    switch (reward.reward_type) {
                        case ELEMENT_DROP as RewardType: {
                            // element material of the stage's enemies, tier = the reward's id
                            const itemId = elementDropItemId((reward as ItemScoreReward).id, stageElement)
                            if (itemId === undefined) break
                            rewardAmount = multipliedDrop((reward as ItemScoreReward).count * 10, dropMultiplier)
                            items[String(itemId)] = givePlayerItemSync(playerId, itemId, rewardAmount);
                            break;
                        }
                        case RewardType.ITEM: {
                            const itemReward = reward as ItemScoreReward
                            const itemId = itemReward.id
                            rewardAmount = multipliedDrop(itemReward.count * 10, dropMultiplier)
                            items[String(itemId)] = givePlayerItemSync(playerId, itemId, rewardAmount);
                            break;
                        }
                        case RewardType.MANA: {
                            const player = getPlayerSync(playerId)
                            const currencyReward = reward as CurrencyScoreReward
                            rewardAmount = multipliedDrop(currencyReward.count * 10, dropMultiplier)
                            mana += rewardAmount
                            updatePlayerSync({
                                id: playerId,
                                // was based on freeVmoney (beads), which set mana to beads + the drop
                                freeMana: (player?.freeMana || 0) + rewardAmount
                            })
                            break;
                        }
                        case RewardType.EXP: {
                            const player = getPlayerSync(playerId)
                            const currencyReward = reward as CurrencyScoreReward
                            rewardAmount = multipliedDrop(currencyReward.count * 10, dropMultiplier)
                            expPool += rewardAmount
                            updatePlayerSync({
                                id: playerId,
                                expPool: (player?.expPool || 0) + rewardAmount
                            })
                            break;
                        }
                    }

                    dropScoreRewardIds.push({
                        group_id: groupId,
                        index: rewardIndex,
                        number: rewardAmount
                    })
                    break;
                }
                case ScoreRewardType.RARE_POOL: {
                    const reward = scoreReward as RareScoreRewardGroup
                    const roll = randomInt(0, 100) / 100

                    if (reward.rarity >= roll) {
                        // give reward from group
                        // TODO: implement RareScoreReward rarity using .rarity field instead of having an even chance between all items in pool
                        const rareGroupId = reward.id
                        const group = getRareScoreRewardGroup(rareGroupId)
                        if (group !== null) {
                            const random_index = 1 >= group.length ? 0 : randomInt(group.length)
                            const picked = group[random_index]
                            // an item drop is multiplied like the score drops; units and beads aren't
                            const reward = picked.type === RewardType.ITEM
                                ? { ...picked, count: multipliedDrop((picked as Reward as EquipmentItemReward).count, dropMultiplier) } as typeof picked
                                : picked
                            const result = givePlayerRewardSync(playerId, reward)

                            if (result) {
                                // merge arrays
                                mana += result.user_info.free_mana
                                vmoney += result.user_info.free_vmoney
                                joinedCharacterIdList = [...joinedCharacterIdList, ...result.joined_character_id_list]
                                characterList = [...characterList, ...result.character_list]
                                equipmentList = [...equipmentList, ...result.equipment_list]

                                // merge items: these are new totals, and the rare drop came last,
                                // so its total replaces the one from the drops above (adding the
                                // two totals doubled the medal count the game showed)
                                for (const [itemId, total] of Object.entries(result.items)) {
                                    items[itemId] = total
                                }

                                // calculate number
                                let number = 0
                                switch (reward.type) {
                                    case RewardType.ITEM:
                                    case RewardType.EQUIPMENT:
                                        number = (reward as Reward as EquipmentItemReward).count
                                        break;
                                    case RewardType.CHARACTER:
                                        number = 1;
                                        break;
                                    case RewardType.BEADS:
                                    case RewardType.EXP:
                                    case RewardType.MANA:
                                        number = (reward as Reward as CurrencyReward).count
                                        break;
                                }

                                // add reward id to table
                                dropRareRewardIds.push({
                                    group_id: rareGroupId,
                                    index: random_index + 1,
                                    number: number
                                })
                            }  
                        }
                    }
                    break;
                }
            }
        }
    }

    return {
        drop_score_reward_ids: dropScoreRewardIds,
        drop_rare_reward_ids: dropRareRewardIds,
        user_info: {
            free_mana: mana,
            free_vmoney: vmoney,
            exp_pool: expPool
        },
        character_list: characterList,
        joined_character_id_list: joinedCharacterIdList,
        equipment_list: equipmentList,
        items: items
    }
}

/**
 * Batch gives a specific player data an array of rewards.
 * 
 * @param playerId The ID of the player to reward.
 * @param rewards The array of rewards to give.
 * @returns A PlayerRewardResult.
 */
export function givePlayerRewardsSync(
    playerId: number,
    rewards: Reward[]
): PlayerRewardResult | null {
    let mana = 0
    let vmoney = 0
    let expPool = 0
    let joinedCharacterIdList: number[] = []
    let characters: Map<number, Object> = new Map()
    let equipment: Map<number, Object> = new Map()
    let items: Map<number, number> = new Map()

    for (const reward of rewards) {
        switch (reward.type) {
            case RewardType.ITEM: {
                const convertedReward = (reward as EquipmentItemReward)
                const itemId = convertedReward.id
                // the reply carries the player's NEW TOTAL of each item, so keep the latest total
                // (adding totals together over-reported items given more than once)
                const result = givePlayerItemSync(playerId, itemId, convertedReward.count);
                items.set(itemId, result)
                break;
            }
            case RewardType.EQUIPMENT: {
                const convertedReward = (reward as EquipmentItemReward)
                const equipmentId = convertedReward.id
                const result = givePlayerEquipmentSync(playerId, equipmentId, convertedReward.count)
                equipment.set(equipmentId, result)
                break;
            }
            case RewardType.CHARACTER: {
                const characterId = (reward as CharacterReward).id
                const giveResult = givePlayerCharacterSync(playerId, characterId)

                const giveItem = giveResult?.item
                if (giveItem !== undefined) {
                    // giveItem.count is the amount given; the reply wants the new total
                    const itemId = giveItem.id
                    items.set(itemId, getPlayerItemSync(playerId, itemId) ?? giveItem.count)
                }
    
                const giveCharacter = giveResult?.character
                if (giveCharacter !== undefined) {
                    characters.set(characterId, giveCharacter)
                }
                break;
            }
            case RewardType.BEADS: {
                vmoney += (reward as CurrencyReward).count
                break;
            }
            case RewardType.MANA: {
                mana += (reward as CurrencyReward).count
                break;
            }
            case RewardType.EXP: {
                expPool += (reward as CurrencyReward).count
                break;
            }
        }
    }

    if (mana > 0 || vmoney > 0 || expPool > 0) {
        // get player
        const player = getPlayerSync(playerId)
        if (player === null) return null;

        updatePlayerSync({
            id: playerId,
            freeVmoney: player.freeVmoney + vmoney,
            freeMana: player.freeMana + mana,
            expPool: player.expPool + expPool
        })
    }
    
    // build return values
    const characterList: Object[] = []
    const equipmentList: Object[] = []
    const itemsRecord: Record<string, number> = {}
    
    characters.forEach(character => {
        characterList.push(character)
    })

    equipment.forEach(equipment => {
        equipmentList.push(equipment)
    })

    items.forEach((number, id) => {
        itemsRecord[id] = number
    })

    return {   
        user_info: {
            free_mana: mana,
            free_vmoney: vmoney,
            exp_pool: expPool
        },
        character_list: characterList,
        joined_character_id_list: joinedCharacterIdList,
        equipment_list: equipmentList,
        items: itemsRecord
    }
}

/**
 * Gives a player a specific reward.
 * 
 * @param playerId The ID of the player.
 * @param reward The reward to give.
 * @returns A PlayerRewardResult.
 */
export function givePlayerRewardSync(
    playerId: number,
    reward: Reward
): PlayerRewardResult | null {
    return givePlayerRewardsSync(playerId, [reward])
}