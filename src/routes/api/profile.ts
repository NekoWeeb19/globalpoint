// Player profile: view it, change the name, comment and title, and choose which counts it shows.
//
// get_my_profile follows the recorded global reply (docs/routes/profile_get_my_profile.md). The other
// routes weren't recorded on global: their replies use the field paths the global client reads
// (data.target_user_info.*, data.favorite_character.*, data.degree_ids, data.user_info.name /
// comment / degree_id), and their rules follow the Chinese fork (routes/api/profile.ts).
// Single player: any profile asked for (yourself, or a COM partner in co-op) is your own.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAccountPlayers, getPlayerSync, getSession, updatePlayerSync } from "../../data/wdfpData";
import { generateDataHeaders } from "../../utils";
import { applyProfileSettings, cleanComment, cleanName, favoritePartyGroupList, serializeProfileSettings } from "../../lib/profile";
import { getFavoriteCharacterSync, getFavoritePartySync, getProfileInfoSync, getProfileSettingsSync, leaderEvolutionLevelSync, saveProfileSettingsSync } from "../../nya/profile";
import { degreeExists, getOwnedDegreeIdsSync, givePlayerDegreeSync } from "../../nya/degree";
import { getRankByPt } from "../../nya/player";
import { withMissionRewards } from "../../nya/mission";
import { COUNTER_KINDS } from "../../lib/mission";

const bad = (reply: FastifyReply, message = "Invalid request body.") => reply.status(400).send({ "error": "Bad Request", "message": message })

function ok(reply: FastifyReply, viewerId: number, data: unknown) {
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({ "data_headers": generateDataHeaders({ viewer_id: viewerId }), "data": data })
}

/** The viewer's player id, or null. */
async function viewerPlayer(viewerId: unknown): Promise<number | null> {
    if (!viewerId || isNaN(Number(viewerId))) return null
    const session = await getSession(String(viewerId))
    if (!session) return null
    const playerId = (await getAccountPlayers(session.accountId))[0]
    return playerId === undefined || isNaN(playerId) || getPlayerSync(playerId) === null ? null : playerId
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/get_my_profile", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number }
        const playerId = await viewerPlayer(body?.viewer_id)
        if (playerId === null) return bad(reply)
        // CN "view your own profile" missions
        return ok(reply, body.viewer_id, withMissionRewards(playerId, {
            "profile_info": getProfileInfoSync(playerId),
            "profile_settings": serializeProfileSettings(getProfileSettingsSync(playerId)),
            "user_party_group_list": favoritePartyGroupList(getFavoritePartySync(playerId)),
        }, [{ kind: COUNTER_KINDS.CN_PROFILE_VIEWED, amount: 1 }]))
    })

    fastify.post("/get_profile", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, target_viewer_id?: number }
        const playerId = await viewerPlayer(body?.viewer_id)
        if (playerId === null) return bad(reply)
        const player = getPlayerSync(playerId)!
        const settings = getProfileSettingsSync(playerId)
        const info = getProfileInfoSync(playerId)
        const targetViewerId = Number(body.target_viewer_id) > 0 ? Number(body.target_viewer_id) : Number(body.viewer_id)
        return ok(reply, body.viewer_id, {
            "target_user_info": {
                "viewer_id": targetViewerId,
                "kakao_pid": "",
                "name": player.name,
                "comment": player.comment ?? "",
                "rank": getRankByPt(player.rankPoint)?.rank ?? 1,
                "role": player.role || 1,
                "degree_id": player.degreeId || 1,
                "follow_state": 0,
                "leader_character_full_shot_evolution_level": leaderEvolutionLevelSync(playerId),
                // hidden counts are sent as null, like a profile with them switched off
                "owned_character_count": settings.showOwnedCharacterCount ? info.owned_character_count : null,
                "max_owned_character_count": settings.showOwnedCharacterCount ? info.max_owned_character_count : null,
                "opened_mana_board_second_count": settings.showOpenedManaBoardSecondCount ? info.opened_mana_board_second_count : null,
                "max_opened_mana_board_second_count": settings.showOpenedManaBoardSecondCount ? info.max_opened_mana_board_second_count : null,
                "owned_degree_count": settings.showOwnedDegreeCount ? info.owned_degree_count : null,
                "max_owned_degree_count": settings.showOwnedDegreeCount ? info.max_owned_degree_count : null,
            },
            "favorite_character": getFavoriteCharacterSync(playerId),
        })
    })

    // CN client only: the region shown on a profile (CN shows where the player last logged in from).
    // The client reads data.region; the Chinese fork sends "CN".
    fastify.post("/get_last_login_region", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number }
        const playerId = await viewerPlayer(body?.viewer_id)
        if (playerId === null) return bad(reply)
        return ok(reply, body.viewer_id, { "region": "CN" })
    })

    fastify.post("/get_degree_list", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number }
        const playerId = await viewerPlayer(body?.viewer_id)
        if (playerId === null) return bad(reply)
        const player = getPlayerSync(playerId)!
        return ok(reply, body.viewer_id, { "degree_ids": getOwnedDegreeIdsSync(playerId, player.degreeId) })
    })

    fastify.post("/update_degree", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, degree_id: number }
        const playerId = await viewerPlayer(body?.viewer_id)
        const degreeId = Number(body?.degree_id)
        if (playerId === null || !degreeExists(degreeId)) return bad(reply)
        const player = getPlayerSync(playerId)!
        if (!getOwnedDegreeIdsSync(playerId, player.degreeId).includes(degreeId)) return bad(reply, "Title not owned.")
        // the title worn until now stays owned (a save from global may wear one it earned there)
        givePlayerDegreeSync(playerId, player.degreeId)
        updatePlayerSync({ id: playerId, degreeId })
        return ok(reply, body.viewer_id, { "user_info": { "degree_id": degreeId } })
    })

    fastify.post("/rename", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, name: unknown }
        const playerId = await viewerPlayer(body?.viewer_id)
        const name = cleanName(body?.name)
        if (playerId === null || name === null) return bad(reply)
        updatePlayerSync({ id: playerId, name })
        return ok(reply, body.viewer_id, { "user_info": { "name": name } })
    })

    fastify.post("/update_comment", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, comment: unknown }
        const playerId = await viewerPlayer(body?.viewer_id)
        const comment = cleanComment(body?.comment ?? "")
        if (playerId === null || comment === null) return bad(reply)
        updatePlayerSync({ id: playerId, comment })
        return ok(reply, body.viewer_id, { "user_info": { "comment": comment } })
    })

    fastify.post("/update_profile_settings", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, profile_settings: unknown }
        const playerId = await viewerPlayer(body?.viewer_id)
        if (playerId === null) return bad(reply)
        const next = applyProfileSettings(getProfileSettingsSync(playerId), body.profile_settings)
        if (next === null) return bad(reply, "Invalid profile settings.")
        saveProfileSettingsSync(playerId, next)
        return ok(reply, body.viewer_id, { "profile_settings": serializeProfileSettings(next) })
    })
}

export default routes;
