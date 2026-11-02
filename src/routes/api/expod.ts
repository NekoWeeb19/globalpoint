// Handles the insertion of mana into characters.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { collectPlayerPooledExpSync, getAccountPlayers, getPlayerCharacterSync, getPlayerSync, getPlayerCharactersSync, getSession, givePlayerItemSync, updatePlayerCharacterSync, updatePlayerSync } from "../../data/wdfpData";
import { givePlayerCharactersExpSync } from "../../lib/character";
import { generateDataHeaders, epochOf, getServerTime } from "../../utils";
import { getCharacterDataSync } from "../../lib/assets";
import { clientSerializeDate } from "../../data/utils";
import { trackActiveMissionProgress } from "../../nya/activeMissionProgress";
import { withMissionRewards } from "../../nya/mission";
import { STACK_CONVERT_ITEM_ID, selectBulkConversions, stackConversion } from "../../lib/characterStack";
import { characterMaxOverLimits } from "./character";

interface InjectExpBody {
    character_id: number,
    viewer_id: number,
    exp: number,
    api_count: number
}

interface StackToExpBody {
    character_id: number,
    api_count: number,
    number: number,
    viewer_id: number
}


const rewardItemId = STACK_CONVERT_ITEM_ID



const routes = async (fastify: FastifyInstance) => {
    fastify.post("/stack_to_exp", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as StackToExpBody

        const viewerId = body.viewer_id
        const characterId = body.character_id
        const convertCount = body.number
        if (isNaN(viewerId) || isNaN(characterId) || isNaN(convertCount)) return reply.status(400).send({
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

        // get character asset data
        const characterAssetData = getCharacterDataSync(characterId)
        if (characterAssetData === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Character does not exist."
        })

        // get character
        const character = getPlayerCharacterSync(playerId, characterId)
        if (character === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Player does not own character."
        })
        
        const afterStack = character.stack - convertCount
        if (0 > afterStack) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Not enough stack."
        })

        // get amounts to add
        const conversion = stackConversion(characterId, characterAssetData.rarity, convertCount)
        if (conversion === null || convertCount < 1) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Cannot convert this character."
        })
        const increaseExp = conversion.exp
        const increaseItemCount = conversion.items

        const afterExp = player.expPool + increaseExp

        // update player
        updatePlayerSync({
            id: playerId,
            expPool: afterExp
        })

        // remove the converted copies (this was missing, so the same copy could be converted again)
        updatePlayerCharacterSync(playerId, characterId, { stack: afterStack })

        // add item
        const afterItemCount = givePlayerItemSync(playerId, rewardItemId, increaseItemCount)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "user_info": {
                    "exp_pool": afterExp,
                    "exp_pooled_time": epochOf(player.expPooledTime)
                },
                "character_list": [
                    {
                        "viewer_id": viewerId,
                        "character_id": characterId,
                        "stack": afterStack,
                        "exp": character.exp,
                        "exp_total": character.exp,
                        "create_time": clientSerializeDate(character.joinTime),
                        "update_time": clientSerializeDate(character.updateTime),
                        "join_time": clientSerializeDate(character.joinTime)
                    }
                ],
                "converted_exp_info": {
                    "add_exp": increaseExp
                },
                "item_list": {
                    [rewardItemId]: afterItemCount
                },
                "mail_arrived": false
            }
        })
    })

    // Select all -> convert to EXP: every spare copy of every fully uncapped, unlocked unit
    // (src/lib/characterStack.ts). The body has only viewer_id, as in the Chinese fork.
    fastify.post("/bulk_stack_to_exp", async (request: FastifyRequest, reply: FastifyReply) => {
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
        const player = !isNaN(playerId) ? getPlayerSync(playerId) : null
        if (player === null) return reply.status(500).send({
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
        const conversions = selectBulkConversions(stacked, characterMaxOverLimits)
        const addExp = conversions.reduce((total, c) => total + c.exp, 0)
        const addItems = conversions.reduce((total, c) => total + c.items, 0)

        const afterExp = player.expPool + addExp
        if (conversions.length > 0) {
            updatePlayerSync({ id: playerId, expPool: afterExp })
            for (const c of conversions) updatePlayerCharacterSync(playerId, c.characterId, { stack: 0 })
        }
        const afterItemCount = addItems > 0 ? givePlayerItemSync(playerId, rewardItemId, addItems) : null

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "user_info": {
                    "exp_pool": afterExp,
                    "exp_pooled_time": epochOf(player.expPooledTime)
                },
                "character_list": conversions.map(c => {
                    const character = owned[String(c.characterId)]
                    return {
                        "viewer_id": viewerId,
                        "character_id": c.characterId,
                        "stack": 0,
                        "exp": character.exp,
                        "exp_total": character.exp,
                        "create_time": clientSerializeDate(character.joinTime),
                        "update_time": clientSerializeDate(character.updateTime),
                        "join_time": clientSerializeDate(character.joinTime)
                    }
                }),
                "converted_exp_info": {
                    "add_exp": addExp
                },
                "item_list": afterItemCount === null ? {} : {
                    [rewardItemId]: afterItemCount
                },
                "mail_arrived": false
            }
        })
    })

    fastify.post("/inject_exp", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as InjectExpBody

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
        // the pool refills by 1 a minute, and the game offers the refilled amount, so collect it first
        // (it used to be collected only at /load, and injecting more than the stored amount failed)
        if (!isNaN(playerId)) collectPlayerPooledExpSync(playerId)
        const player = !isNaN(playerId) ? getPlayerSync(playerId) : null

        if (player === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        // increase character exp
        const characterId = body.character_id
        const character = getPlayerCharacterSync(playerId, characterId)
        if (character === null) return reply.status(400).send({
            "error": "Internal Server Error",
            "message": "Player does not own character."
        })

        // make sure that the player has enough exp
        const addExp = Math.abs(body.exp)
        const playerExpPool = player.expPool
        if (addExp > playerExpPool) return reply.status(400).send({
            "error": "Internal Server Error",
            "message": "Not enough exp."
        })
        
        const playerAfterExpPool = player.expPool - addExp

        // decrease player exp
        updatePlayerSync({
            id: playerId,
            expPool: playerAfterExpPool
        })

        // add exp to the character
        const rewardResult = givePlayerCharactersExpSync(playerId, [characterId], addExp, false)

        // active missions: the first exp injection, and the character may have reached a new level
        const activeMissionList = trackActiveMissionProgress(playerId, { recompute: [5, 63] })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            // Mission screen: unit levels (the recorded reply clears a mission here)
            "data": withMissionRewards(playerId, {
                "add_exp_list": rewardResult.add_exp_list,
                "character_list": rewardResult.character_list,
                "user_info": {
                    "exp_pool": rewardResult.exp_pool,
                    "exp_pooled_time": epochOf(player.expPooledTime)
                },
                ...(activeMissionList.length > 0 ? { "active_mission_list": activeMissionList } : {})
            })
        })
    })
}

export default routes;