import { awakeManaNodesSync } from "../../nya/manaAwake";
import { mb2Locked } from "../../nya/mb2Lock";
// Handles the insertion of mana into characters.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAccountPlayers, getPlayerCharacterManaNodesSync, getPlayerCharacterSync, getPlayerCharactersSync, getPlayerCharactersManaNodesSync, getPlayerItemSync, getPlayerSync, getSession, givePlayerItemSync, hasPlayerUnlockedCharacterManaNodeSync, insertPlayerCharacterManaNodesSync, updatePlayerCharacterBondTokenSync, updatePlayerCharacterSync, updatePlayerItemSync, updatePlayerSync } from "../../data/wdfpData";
import { generateDataHeaders } from "../../utils";
import { getCharacterDataSync, getCharacterManaNodeSync, getCharacterManaNodesSync } from "../../lib/assets";
import { clientSerializeDate } from "../../data/utils";
import { givePlayerCharacterSync } from "../../lib/character";
import { trackActiveMissionProgress } from "../../nya/activeMissionProgress";
import { withMissionRewards } from "../../nya/mission";
import { COUNTER_KINDS } from "../../lib/mission";
import { evolutionLevelFromManaNodes, evolutionResponse } from "../../lib/characterEvolution";
import { selectBulkOverLimits } from "../../lib/characterStack";

interface OverLimitBody {
    viewer_id: number
    character_id: number
    api_count: number
    use_stack: boolean
    item_id: number,
    over_limit_count: number
}

interface LearnManaNodeBody {
    viewer_id: number,
    character_id: number,
    api_count: number,
    mana_node_multiplied_id_list: number[]
}

interface SetIllustrationSettingsBody {
    character_id: number,
    api_count: number,
    illustration_settings: number[],
    viewer_id: number
}

interface ReceiveBondTokenBody {
    character_id: number,
    mana_board_index: number,
    api_count: number,
    viewer_id: number
}

export const characterMaxOverLimits: Record<number, number> = {
    [1]: 12, // 1* max over limit count
    [2]: 10, // 2* max over limit count
    [3]: 8,  // 3* max over limit count 
    [4]: 6,  // 4* max over limit count
    [5]: 4,  // 5* max over limit count 
}

const openManaBoardRequiredUncaps: Record<number, number> = {
    [1]: 10,
    [2]: 8,
    [3]: 6,
    [4]: 4,
    [5]: 2
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/set_illustration_settings", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SetIllustrationSettingsBody

        const viewerId = body.viewer_id
        const characterId = body.character_id
        const illustration_settings = body.illustration_settings
        if (isNaN(viewerId) || isNaN(characterId) || !illustration_settings) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player id
        const playerIds = await getAccountPlayers(viewerIdSession.accountId)
        const playerId = playerIds[0]
        if (playerId === undefined) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        // update character
        updatePlayerCharacterSync(playerId, characterId, {
            illustrationSettings: illustration_settings.slice(0, 6)
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {}
        })
    })

    fastify.post("/receive_bond_token", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ReceiveBondTokenBody

        const viewerId = body.viewer_id
        const characterId = body.character_id
        const manaBoardIndex = body.mana_board_index
        if (isNaN(viewerId) || isNaN(characterId) || isNaN(manaBoardIndex)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerIds = await getAccountPlayers(viewerIdSession.accountId)
        const playerId = playerIds[0]
        const player = !isNaN(playerId) ? getPlayerSync(playerId) : null

        if (player === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        // get character data
        const characterData = getPlayerCharacterSync(playerId, characterId)
        if (characterData === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Character not owned."
        })

        const bondTokenReceivable = characterData.bondTokenList[manaBoardIndex - 1]?.status === 1
        if (!bondTokenReceivable) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Cannot receive bond token."
        })

        // reward the bond token
        const newBondTokens = player.bondToken + 1
        updatePlayerSync({
            id: playerId,
            bondToken: newBondTokens
        })

        // update bond token status
        updatePlayerCharacterBondTokenSync(playerId, characterId, {
            manaBoardIndex: manaBoardIndex,
            status: 2
        });

        // build bond token list for response
        let bondTokenList: Object[] = []
        for (const entry of characterData.bondTokenList) {
            const entryIndex = entry.manaBoardIndex
            bondTokenList.push({
                "mana_board_index": entryIndex,
                "status": entryIndex === manaBoardIndex ? 2 : entry.status
            })
        }

        // active missions: a bond token was received
        const activeMissionList = trackActiveMissionProgress(playerId, { recompute: [8, 1048] })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            // Mission screen: "Obtain a total of N Amity Scrolls" (the recorded reply clears mission 39 here)
            "data": withMissionRewards(playerId, {
                "user_info": {
                    "bond_token": newBondTokens
                },
                "character_list": [
                    {
                        "character_id": characterId,
                        "bond_token_list": bondTokenList,
                        "create_time": clientSerializeDate(characterData.joinTime),
                        "update_time": clientSerializeDate(characterData.updateTime),
                        "join_time": clientSerializeDate(characterData.joinTime)
                    }
                ],
                "mail_arrived": false,
                ...(activeMissionList.length > 0 ? { "active_mission_list": activeMissionList } : {})
            })
        })
    })

    fastify.post("/open_mana_board", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ReceiveBondTokenBody

        const viewerId = body.viewer_id
        const characterId = body.character_id
        const manaBoardIndex = body.mana_board_index
        if (isNaN(viewerId) || isNaN(characterId) || isNaN(manaBoardIndex)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        const playerIds = await getAccountPlayers(viewerIdSession.accountId)
        const playerId = playerIds[0]

        if (isNaN(playerId)) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        // get character data
        const characterData = getPlayerCharacterSync(playerId, characterId)
        if (characterData === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Character not owned."
        })

        // get character asset data
        const characterAssetData = getCharacterDataSync(characterId)
        if (characterAssetData === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No character asset data found."
        })

        // Mana Board 2 not out yet on the server clock (src/nya/mb2Lock.ts)
        if (manaBoardIndex >= 2 && mb2Locked(characterId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "This unit's Mana Board 2 isn't available yet."
        })

        // make sure that the mana board index is valid
        if (!characterData.bondTokenList[manaBoardIndex - 1]) return reply.status(400).send({
            "error": "Bad Request",
            "message": `Character does not have mana board with index ${manaBoardIndex}.`
        })

        // ensure that the mana board can be opened
        // TODO: Add level check.  5*: Level 80, 4*: Level 70, 3*: Level 60.
        if (openManaBoardRequiredUncaps[characterAssetData.rarity] > characterData.overLimitStep) return reply.status(400).send({
            "error": "Bad Request",
            "message": `Character is not uncapped enough to unlock mana board.`
        })
        if (1 > characterData.bondTokenList[manaBoardIndex - 2]?.status) return reply.status(400).send({
            "error": "Bad Request",
            "message": `Must unlock all previous mana board nodes.`
        })

        updatePlayerCharacterSync(playerId, characterId, {
            manaBoardIndex: manaBoardIndex
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            // Mission screen: "Unlock N 2nd Mana Board(s)" (the recorded reply clears mission 95 here)
            "data": withMissionRewards(playerId, {
                "character_list": [
                    {
                        "viewer_id": viewerId,
                        "character_id": characterId,
                        "mana_board_index": manaBoardIndex,
                        "create_time": clientSerializeDate(characterData.joinTime),
                        "update_time": clientSerializeDate(characterData.updateTime),
                        "join_time": clientSerializeDate(characterData.joinTime)
                    }
                ],
                "mail_arrived": false
            })
        })
    })

    fastify.post("/learn_mana_node", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as LearnManaNodeBody

        const viewerId = body.viewer_id
        const characterId = body.character_id
        const toUnlockNodeIds = body.mana_node_multiplied_id_list
        if (!viewerId || isNaN(viewerId) || !characterId || isNaN(characterId) || !toUnlockNodeIds) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerIds = await getAccountPlayers(viewerIdSession.accountId)
        const playerId = playerIds[0]
        const player = !isNaN(playerId) ? getPlayerSync(playerId) : null

        if (player === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        // get character data
        const characterData = getPlayerCharacterSync(playerId, characterId)
        if (characterData === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Character not owned."
        })

        // compute the combined cost of each node
        let manaCost = 0
        const itemsCosts: Record<string, number> = {}

        const userCharacterManaNodeListItem: Object[] = []

        // get mana node data from assets
        const currentManaNodeIndex = characterData.manaBoardIndex;
        const characterManaNodes = getCharacterManaNodesSync(characterId, currentManaNodeIndex)
        if (characterManaNodes === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": `Character does not have mana nodes of index '${currentManaNodeIndex}'.`
        })

        // get currently unlocked nodes
        const unlockedManaNodes = getPlayerCharacterManaNodesSync(playerId, characterId);
        const unlockedManaNodesRecord: Record<string, boolean> = {}
        let indexUnlockedNodesCount = 0 // the number of nodes that have been unlocked for the selected index
        for (const manaNodeId of unlockedManaNodes) {
            unlockedManaNodesRecord[manaNodeId] = true
            indexUnlockedNodesCount += characterManaNodes[manaNodeId] === undefined ? 0 : 1
        }

        for (const manaNodeId of toUnlockNodeIds) {
            if (unlockedManaNodesRecord[manaNodeId]) return reply.status(400).send({
                "error": "Bad Request",
                "message": `Mana node '${manaNodeId}' already unlocked.`
            })

            const nodeData = characterManaNodes[manaNodeId];
            if (nodeData === undefined) return reply.status(400).send({
                "error": "Bad Request",
                "message": `Mana node '${manaNodeId}' does not exist.`
            })

            if (nodeData !== null) {
                manaCost += nodeData.manaCost

                for (const [itemId, itemCost] of Object.entries(nodeData.items)) {
                    const existing = itemsCosts[itemId]
                    itemsCosts[itemId] = existing ? existing + itemCost : itemCost
                }

                userCharacterManaNodeListItem.push({
                    "mana_node_multiplied_id": manaNodeId
                })
            }
        }

        // validate that the player has enough materials to unlock these nodes
        // TODO: Allow the usage of paidMana
        const newMana = player.freeMana - manaCost
        if (0 > newMana) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Not enough mana."
        })

        for (const [itemId, itemCost] of Object.entries(itemsCosts)) {
            const item = getPlayerItemSync(playerId, itemId)
            const newAmount = item === null ? -1 : item - itemCost
            if (0 > newAmount) return reply.status(400).send({
                "error": "Bad Request",
                "message": `Not enough of item with id ${itemId}`
            })

            // replace the object value with the newAmount for deduction later
            itemsCosts[itemId] = newAmount
        }

        // deduct mana
        updatePlayerSync({
            id: playerId,
            freeMana: newMana
        })

        // deduct item amounts
        for (const [itemId, newAmount] of Object.entries(itemsCosts)) {
            updatePlayerItemSync(playerId, itemId, newAmount)
        }

        // awakening: once every Board 1 ability slot has a node learned and the skill evolution node is
        // learned (src/lib/characterEvolution.ts), not on the first node learned
        let characterEvolutionLevel = characterData.evolutionLevel
        const boardOneNodes = getCharacterManaNodesSync(characterId, 1) ?? {}
        const learnedNodeIds = new Set<number>([...unlockedManaNodes, ...toUnlockNodeIds].map(Number))
        const reachedLevel = evolutionLevelFromManaNodes(boardOneNodes, learnedNodeIds)
        const evolutionData = evolutionResponse(characterId, characterEvolutionLevel, reachedLevel)
        if (reachedLevel > characterEvolutionLevel) {
            characterEvolutionLevel = reachedLevel
            updatePlayerCharacterSync(playerId, characterId, {
                evolutionLevel: characterEvolutionLevel
            })
        }

        // give bond reward, if available
        const amityScrollReceivable = characterData.bondTokenList[currentManaNodeIndex - 1]?.status === 0
        const bondTokenList: Object[] = []
        if (amityScrollReceivable && (indexUnlockedNodesCount + toUnlockNodeIds.length) === Object.keys(characterManaNodes).length) {
            updatePlayerCharacterBondTokenSync(playerId, characterId, {
                manaBoardIndex: currentManaNodeIndex,
                status: 1
            });

            for (const entry of characterData.bondTokenList) {
                const entryIndex = entry.manaBoardIndex
                bondTokenList.push({
                    "mana_board_index": entryIndex,
                    "status": entryIndex === currentManaNodeIndex ? 1 : entry.status
                })
            }
        }

        // insert new mana nodes
        insertPlayerCharacterManaNodesSync(playerId, characterId, toUnlockNodeIds)

        // active missions: mana nodes were learned (and the character may have awakened)
        const activeMissionList = trackActiveMissionProgress(playerId, { recompute: [62, 61] })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            // Mission screen: mana board advances, completed 2nd boards
            "data": withMissionRewards(playerId, {
                "user_info": {
                    "free_mana": newMana
                },
                "character_list": [
                    {
                        "evolution_level": characterEvolutionLevel,
                        "evolution_img_level": characterEvolutionLevel,
                        "character_id": characterId,
                        "create_time": clientSerializeDate(characterData.joinTime),
                        "update_time": clientSerializeDate(characterData.updateTime),
                        "join_time": clientSerializeDate(characterData.joinTime),
                        "bond_token_list": bondTokenList
                    }
                ],
                "evolution": evolutionData,
                "item_list": itemsCosts,
                "user_character_mana_node_list": {
                    [String(characterId)]: userCharacterManaNodeListItem
                },
                "mail_arrived": false,
                ...(activeMissionList.length > 0 ? { "active_mission_list": activeMissionList } : {})
            }, manaCost > 0 ? [{ kind: COUNTER_KINDS.MANA_SPENT, amount: manaCost }] : [])
        })
    })

    // CN node awakening (src/nya/manaAwake.ts)
    fastify.post("/awake_mana_node", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, character_id: number, mana_node_multiplied_id_list: number[], awake_level: number }
        const viewerId = body.viewer_id, characterId = body.character_id
        if (!viewerId || isNaN(viewerId) || !characterId || !Array.isArray(body.mana_node_multiplied_id_list)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })
        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })
        const playerId = (await getAccountPlayers(viewerIdSession.accountId))[0]
        const characterData = !isNaN(playerId) ? getPlayerCharacterSync(playerId, characterId) : null
        if (characterData === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Character not owned."
        })
        const result = awakeManaNodesSync(playerId, characterId, body.mana_node_multiplied_id_list.map(Number), Number(body.awake_level))
        if (!result.ok) return reply.status(400).send({ "error": "Bad Request", "message": result.message })
        const { mana_board_awake, ...rest } = result.data as Record<string, any>
        // active missions that count awakened nodes
        const activeMissionList = trackActiveMissionProgress(playerId, { recompute: [62, 61] })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                ...rest,
                "character_list": [{
                    "evolution_level": characterData.evolutionLevel,
                    "evolution_img_level": characterData.evolutionLevel,
                    "character_id": characterId,
                    "create_time": clientSerializeDate(characterData.joinTime),
                    "update_time": clientSerializeDate(characterData.updateTime),
                    "join_time": clientSerializeDate(characterData.joinTime),
                    "mana_board_awake": mana_board_awake[String(characterId)] ?? {},
                }],
                "mail_arrived": false,
                ...(activeMissionList.length > 0 ? { "active_mission_list": activeMissionList } : {}),
            },
        })
    })

    fastify.post("/over_limit", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as OverLimitBody

        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerIds = await getAccountPlayers(viewerIdSession.accountId)
        const playerId = playerIds[0]
        const player = !isNaN(playerId) ? getPlayerSync(playerId) : null

        if (player === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        // get character data
        const characterId = body.character_id
        const playerCharacterData = getPlayerCharacterSync(playerId, characterId)
        if (playerCharacterData === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Character not owned."
        })

        // get character asset data
        const characterAssetData = getCharacterDataSync(characterId)
        if (characterAssetData === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No character asset data found."
        })

        // calculate new over limit
        const overLimitCount = body.over_limit_count
        const newOverLimit = playerCharacterData.overLimitStep + overLimitCount
        const characterRarity = characterAssetData.rarity
        if (newOverLimit > characterMaxOverLimits[characterRarity]) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Character cannot be uncapped further."
        })

        let stack = playerCharacterData.stack
        const item_list: Record<number, number> = {}

        if (body.use_stack) {
            // stack uncapping

            // ensure that the character has enough stack
            stack = stack - overLimitCount
            if (0 > stack) return reply.status(400).send({
                "error": "Bad Request",
                "message": "Character does not have enough duplicates to uncap."
            })

            // update the character
            updatePlayerCharacterSync(playerId, characterId, {
                overLimitStep: newOverLimit,
                stack: stack
            })
        } else {
            // item uncapping
            const itemId = body.item_id

            // ensure that the item trying to be used is valid
            // 5* characters can only be uncapped by item 10003 (awaking_crystal_5)
            // 4* characters and below can only be uncapped by items 10002 (awaking_crystal_4) and 10001 (awaking_crystal_3)
            if ((characterRarity === 5 && itemId !== 10003)
                || (4 >= characterRarity && (itemId !== 10002 && itemId !== 10001))
            ) return reply.status(400).send({
                "error": "Bad Request",
                "message": "Attempted to use invalid item."
            })

            const itemData = getPlayerItemSync(playerId, itemId)
            if (itemData === null) return reply.status(400).send({
                "error": "Bad Request",
                "message": "Attempted to use unowned item."
            })

            // make sure that the player has enough of the item
            const newAmount = itemData - overLimitCount
            if (0 > newAmount) return reply.status(400).send({
                "error": "Bad Request",
                "message": "Not enough of item to uncap."
            })

            // update the item count
            updatePlayerItemSync(playerId, itemId, newAmount)
            item_list[itemId] = newAmount // add to items table

            // update the character
            updatePlayerCharacterSync(playerId, characterId, {
                overLimitStep: newOverLimit
            })
        }

        // active missions: a character was raised over its limit
        const activeMissionList = trackActiveMissionProgress(playerId, { recompute: [9] })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            // Mission screen: "Perform a unit uncap N times"
            "data": withMissionRewards(playerId, {
                "character_list": [
                    {
                        "over_limit_step": newOverLimit,
                        "character_id": characterId,
                        "stack": stack,
                        "create_time": clientSerializeDate(playerCharacterData.joinTime),
                        "update_time": clientSerializeDate(new Date()),
                        "join_time": clientSerializeDate(playerCharacterData.joinTime)
                    }
                ],
                "item_list": item_list,
                "mail_arrived": false,
                ...(activeMissionList.length > 0 ? { "active_mission_list": activeMissionList } : {})
            })
        })
    })

    // Select all -> uncap: every unit with spare copies is uncapped with them, up to its maximum
    // (src/lib/characterStack.ts). Copies only, no items; the body has only viewer_id, as in the
    // Chinese fork.
    fastify.post("/bulk_over_limit", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, api_count?: number }

        const viewerId = body?.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        const playerIds = await getAccountPlayers(viewerIdSession.accountId)
        const playerId = playerIds[0]
        if (isNaN(playerId)) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        const owned = getPlayerCharactersSync(playerId)
        const stacked = Object.entries(owned).flatMap(([id, character]) => {
            const asset = getCharacterDataSync(Number(id))
            return asset === null ? [] : [{
                characterId: Number(id),
                rarity: asset.rarity,
                stack: character.stack,
                overLimitStep: character.overLimitStep,
                protection: character.protection,
            }]
        })
        const updates = selectBulkOverLimits(stacked, characterMaxOverLimits)
        for (const update of updates) {
            updatePlayerCharacterSync(playerId, update.characterId, {
                overLimitStep: update.overLimitStep,
                stack: update.stack
            })
        }

        // active missions: characters were raised over their limit
        const activeMissionList = updates.length > 0 ? trackActiveMissionProgress(playerId, { recompute: [9] }) : []

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            // Mission screen: "Perform a unit uncap N times"
            "data": withMissionRewards(playerId, {
                "character_list": updates.map(update => {
                    const character = owned[String(update.characterId)]
                    return {
                        "over_limit_step": update.overLimitStep,
                        "character_id": update.characterId,
                        "stack": update.stack,
                        "create_time": clientSerializeDate(character.joinTime),
                        "update_time": clientSerializeDate(new Date()),
                        "join_time": clientSerializeDate(character.joinTime)
                    }
                }),
                "item_list": {},
                "mail_arrived": false,
                ...(activeMissionList.length > 0 ? { "active_mission_list": activeMissionList } : {})
            })
        })
    })

    fastify.post("/add_character_from_town", async (request: FastifyRequest, reply: FastifyReply) => {
        const { viewer_id: viewerId, character_id: characterId } = request.body as { viewer_id: number, character_id: number }

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerIds = await getAccountPlayers(viewerIdSession.accountId)
        const playerId = playerIds[0]
        if (isNaN(playerId)) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        const giveResult = givePlayerCharacterSync(playerId, characterId)
        if (giveResult === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Could not give player character."
        })

        // active missions: a character was obtained
        const activeMissionList = trackActiveMissionProgress(playerId, { recompute: [4] })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "character_list": [
                    giveResult?.character
                ],
                "item_list": giveResult.item !== undefined ? {
                    [giveResult.item.id]: giveResult.item.count
                } : [],
                "mail_arrived": false,
                ...(activeMissionList.length > 0 ? { "active_mission_list": activeMissionList } : {})
            }
        })
    })
}

export default routes;