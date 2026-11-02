// Co-op (multiplayer) battles, played alone with COM partners made from the player's own parties.
//
// Flow (as recorded on global): create_room -> prepare -> select_room (returns the battle server's
// address) -> the game connects (src/coop/tcp.ts) -> summon (COM partners) -> start -> battle -> finish.
// start, finish, abort and play_continue run the solo battle routes, so stamina, rewards and missions
// work the same way; the replies are then marked as multiplayer.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { unpack } from "msgpackr";
import { getAccountPlayers, getSession } from "../../data/wdfpData";
import { generateDataHeaders } from "../../utils";
import { summonParty } from "../../lib/coop";
import { coopHost, coopPlayerInfo, coopPort, coopSummonSeconds, createCoopRoom, deleteCoopRoom, getCoopRoom, getHostRoom, partnerParties } from "../../nya/coop";
import { logHttp, notifyRoomDisbanded } from "../../coop/tcp";
import { markActiveQuestCoop } from "./singleBattleQuest";
import { CN_INTERNAL_HEADER, inCnRequest } from "../../lib/cnClient";

interface GetRoomsBody {
    event_id: number,
    viewer_id: number,
    category_id: number
}

// the recorded global share_room reply (attention/recruitment settings; nothing here uses them)
const SHARE_ROOM_CONFIG = {
    "attention_recruitment_interval_seconds": 15, "attention_recruitment_redeliver_limit": 20,
    "attention_polling_interval_seconds_normal": 10, "attention_polling_interval_seconds_battle": 15,
    "multi_attention_lifetime_seconds": 30, "contribution_score_rate_to_parasite": 0.25,
    "attention_log_interval_seconds": 600, "disable_finish_duration_seconds": 5,
    "disable_decline_count_seconds": 60, "disable_decline_count_limit": 14, "disable_decline_duration_seconds": 30,
    "disable_intent_disconnect_duration_seconds": 300, "disable_unintent_disconnect_duration_seconds": 5,
    "disable_remote_error_duration_seconds": 300, "attention_animation_time_seconds": 6,
    "disable_expire_count_limit": 4, "disable_expire_duration_seconds": 180,
    "polling_delay_normal_seconds_range_min": 1, "polling_delay_normal_seconds_range_max": 10,
    "polling_delay_battle_seconds_range_min": 1, "polling_delay_battle_seconds_range_max": 15,
    "return_attention_max_num": 3
}

const SINGLE = "/latest/api/index.php/single_battle_quest"

/** The viewer's player id, or null when the viewer id isn't a valid session. */
async function viewerPlayer(viewerId: unknown): Promise<number | null> {
    if (!viewerId || isNaN(Number(viewerId))) return null
    const session = await getSession(String(viewerId))
    if (!session) return null
    const playerId = (await getAccountPlayers(session.accountId))[0]
    return isNaN(playerId) ? null : playerId
}

const bad = (reply: FastifyReply, message = "Invalid request body.") => reply.status(400).send({ "error": "Bad Request", "message": message })

function ok(reply: FastifyReply, viewerId: number, data: unknown) {
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({
        "data_headers": generateDataHeaders({ viewer_id: viewerId }),
        "data": data
    })
}

/** The room connection reply (select_room; the recorded global shape). */
function roomConnection(room: NonNullable<ReturnType<typeof getCoopRoom>>, requestHost?: string) {
    return {
        "room_number": room.roomNumber,
        "category_id": room.category,
        "quest_id": room.questId,
        "ip_address": coopHost(requestHost),
        "port": coopPort(),
        "application_update_url": "",
        "host_entry_time": room.hostEntryTime,
        "raising_state": room.state === 2 ? 1 : room.state,
        "is_pickup": false,
        "room_sequence": room.roomSequence
    }
}

const routes = async (fastify: FastifyInstance) => {
    // while co-op is being tested, the game's co-op HTTP calls go to the frame log too
    fastify.addHook("preHandler", async (request) => logHttp(request.url, request.body))

    /**
     * Runs a solo battle route with this body and returns its decoded reply, or the error reply as is.
     * The solo routes accept JSON as well as the game's encoded bodies.
     */
    async function runSolo(path: string, body: object): Promise<{ status: number, data: any }> {
        const res = await fastify.inject({ method: "POST", url: SINGLE + path, headers: { "content-type": "application/json", ...(inCnRequest() ? { [CN_INTERNAL_HEADER]: "1" } : {}) }, payload: JSON.stringify(body) })
        let data: any
        try { data = unpack(Buffer.from(res.body, "base64")) } catch { try { data = JSON.parse(res.body) } catch { data = res.body } }
        return { status: res.statusCode, data }
    }

    /** Sends a solo route's reply on as a co-op one (is_multi "multi"; finish also has follow_info). */
    function forwardAsMulti(reply: FastifyReply, result: { status: number, data: any }, extra: object = {}) {
        if (result.status !== 200 || typeof result.data !== "object" || result.data === null) return reply.status(result.status).send(result.data)
        const data = result.data.data
        if (data && typeof data === "object" && !Array.isArray(data)) {
            if ("is_multi" in data) data.is_multi = "multi"
            Object.assign(data, extra)
        }
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send(result.data)
    }

    fastify.post("/get_rooms", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GetRoomsBody
        const viewerId = body.viewer_id
        if (await viewerPlayer(viewerId) === null) return bad(reply)
        // no other players to find rooms of
        return ok(reply, viewerId, { "rooms": [] })
    })

    fastify.post("/create_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, quest_id: number, party_id: number, category: number }
        const playerId = await viewerPlayer(body.viewer_id)
        if (playerId === null || !Number.isInteger(body.quest_id) || !Number.isInteger(body.category)) return bad(reply)
        const room = createCoopRoom(Number(body.viewer_id), playerId, body.category, body.quest_id, Number(body.party_id) || 1)
        return ok(reply, body.viewer_id, {
            "room_number": room.roomNumber,
            "room_url": `https://localhost/latest/api/index.php/multi_invitation/join?k=${room.roomNumber}`
        })
    })

    fastify.post("/prepare", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, room_number: string }
        if (await viewerPlayer(body.viewer_id) === null) return bad(reply)
        return ok(reply, body.viewer_id, [])
    })

    fastify.post("/select_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, room_number: string, party_id?: number }
        const playerId = await viewerPlayer(body.viewer_id)
        if (playerId === null) return bad(reply)
        const room = getCoopRoom(body.room_number)
        if (!room) return ok(reply, body.viewer_id, { ...missingRoom(body.room_number) })
        if (Number.isInteger(body.party_id)) room.partyId = Number(body.party_id)
        console.log(`[coop] Room ${room.roomNumber}: battle server ${coopHost(request.headers.host)}:${coopPort()} sent to the game.`)
        return ok(reply, body.viewer_id, roomConnection(room, request.headers.host))
    })

    fastify.post("/restore_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, room_number: string }
        if (await viewerPlayer(body.viewer_id) === null) return bad(reply)
        const room = getCoopRoom(body.room_number)
        return ok(reply, body.viewer_id, room ? roomConnection(room, request.headers.host) : missingRoom(body.room_number))
    })

    // COM partners: the player's own parties (src/lib/coop.ts pickPartnerParties)
    fastify.post("/summon", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, room_number: string }
        const playerId = await viewerPlayer(body.viewer_id)
        if (playerId === null) return bad(reply)
        const room = getCoopRoom(body.room_number)
        if (!room || room.hostViewerId !== Number(body.viewer_id)) return bad(reply, "Room not found.")
        const info = coopPlayerInfo(playerId, Number(body.viewer_id))
        if (info === null) return bad(reply)
        const partners = partnerParties(playerId, room.partyId)
        const mate = (index: number) => {
            const partner = partners[index]
            if (!partner) return null
            return { "com_id": index + 1, "rank": info.rank, "party": summonParty(partner.party, room.cn ? "map" : "list"), "degree_id": info.degreeId }
        }
        console.log(`[coop] Room ${room.roomNumber}: COM partners from parties ${partners.map(p => p.partyId).join(", ")}.`)
        return ok(reply, body.viewer_id, { "mate1": mate(0), "mate2": mate(1) })
    })

    fastify.post("/share_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number }
        if (await viewerPlayer(body.viewer_id) === null) return bad(reply)
        // summon_com_seconds: how long the game waits after Recruit before calling /summon
        return ok(reply, body.viewer_id, { "config": { ...SHARE_ROOM_CONFIG, "summon_com_seconds": coopSummonSeconds() } })
    })

    fastify.post("/disband_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, room_number: string }
        if (await viewerPlayer(body.viewer_id) === null) return bad(reply)
        const room = getCoopRoom(body.room_number)
        if (room && room.hostViewerId === Number(body.viewer_id)) {
            notifyRoomDisbanded(room.roomNumber)
            deleteCoopRoom(room.roomNumber)
        }
        return ok(reply, body.viewer_id, [])
    })

    // the battle itself: the solo routes, marked as multiplayer
    fastify.post("/start", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        const playerId = await viewerPlayer(body?.viewer_id)
        if (playerId === null) return bad(reply)
        const room = getCoopRoom(body.room_number)
        if (room) room.state = 4
        const result = await runSolo("/start", {
            viewer_id: body.viewer_id, api_count: body.api_count,
            quest_id: body.quest_id, category: body.category, party_id: body.party_id, play_id: body.play_id,
            use_boost_point: !!body.use_boost_point, use_boss_boost_point: !!body.use_boss_boost_point,
            is_auto_start_mode: !!body.is_auto_start_mode,
        })
        // the finish then counts it as a hosted multiplayer battle (missions)
        if (result.status === 200) markActiveQuestCoop(playerId)
        return forwardAsMulti(reply, result)
    })

    fastify.post("/finish", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        if (await viewerPlayer(body?.viewer_id) === null) return bad(reply)
        const result = await runSolo("/finish", body)
        for (const room of roomsOf(Number(body.viewer_id))) { room.state = 1; room.battleStarted = false; room.battleReady.clear() }
        return forwardAsMulti(reply, result, { "follow_info": [] })
    })

    fastify.post("/abort", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        if (await viewerPlayer(body?.viewer_id) === null) return bad(reply)
        const result = await runSolo("/abort", body)
        for (const room of roomsOf(Number(body.viewer_id))) { notifyRoomDisbanded(room.roomNumber); deleteCoopRoom(room.roomNumber) }
        return forwardAsMulti(reply, result)
    })

    fastify.post("/play_continue", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any
        if (await viewerPlayer(body?.viewer_id) === null) return bad(reply)
        return forwardAsMulti(reply, await runSolo("/play_continue", body))
    })
}

/** The room the viewer hosts, as a list (empty when there is none). */
function roomsOf(viewerId: number) {
    const room = getHostRoom(viewerId)
    return room ? [room] : []
}


/** A room that no longer exists (raising_state 9, as in the Chinese fork). */
function missingRoom(roomNumber: string) {
    return {
        "room_number": String(roomNumber ?? ""),
        "category_id": 0,
        "quest_id": 0,
        "ip_address": "",
        "port": 0,
        "application_update_url": "",
        "host_entry_time": 0,
        "raising_state": 9,
        "is_pickup": null,
        "room_sequence": 0
    }
}

export default routes;
