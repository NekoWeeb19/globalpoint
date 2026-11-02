// The co-op battle connection: a TCP server the game connects to after /multi_battle_quest/select_room
// (at the address and port that reply gives it). Messages are JSON, each ending with a \0 byte. The
// first one is a handshake object ({ socklet: "cooperation_room" | "cooperation_battle", ... }); after
// that every message is an array, [message index, values...].
//
// Message numbers and shapes follow the Chinese StarPoint fork (src/multi/tcp/lobby.ts, battle.ts,
// handshake.ts and docs/protocol/multi-battle.md). This is a single-player version: the host is the
// only real player, and the COM partners are the host's own parties (src/nya/coop.ts), which the
// game itself plays.

import * as net from "net"
import * as fs from "fs"
import * as path from "path"
import { memberEntry, splitFrames } from "../lib/coop"
import { coopManaNodeFormat, coopPlayerInfo, getCoopRoom, CoopRoom, loadCoopParty, partnerParties } from "../nya/coop"

interface Client {
    socket: net.Socket
    kind: "room" | "battle" | null
    roomNumber: string | null
    viewerId: number | null
    connectionId: string | null
    buffer: string
}

/**
 * The global client's room messages (server -> game), from its own decoder tables
 * (TypePackerResource2 in worldflipper_android_release.swf, version 0.0.81). The CN fork's client
 * numbers the last two 10 and 11, which the global client can't read (error C5602).
 *   Room, game -> server: 0 Enter, 1 Bye, 2 ChangeParty, 3 Ready, 4 Heartbeat, 5 Suspend, 6 StartBattle,
 *     7 ChangeAutoplayMode, 8 ChangeAutoStart, 9 Log, 10 EnterComs
 *   Battle, game -> server: 0 SceneReady, 1 Finalize, 2 Measurement, 3 LineSpeedWarning, 4 Heartbeat
 *   Battle, server -> game: 0 Leave, 1 BattleStart, 2 Finalized, 3 Measurement, 4 LineSpeedWarning
 *   Handshake: 0 Accept, 1 Denied, 2 Reconnect, 3 Exception, 4 Complete; ReadyState: 0 Preparation, 1 Ready
 */
const SERVER = Object.freeze({
    Welcome: 0, Mates: 1, StateChanged: 2, AutoplayModeChanged: 3, AutoStartChanged: 4, Start: 5,
    Disbanded: 6, RemainingTime: 7, Update: 8, StartRemainingTime: 9, AckHeartbeat: 10,
})
/**
 * The CN client (rooms made from it: room.cn) numbers two room messages one later, and has one more
 * battle message (LevelNext at 1) before Finalize, so its battle messages from 1 on are one higher
 * (the Chinese fork's lobby.ts and battle.ts).
 */
const CN_SERVER = Object.freeze({ ...SERVER, StartRemainingTime: 10, AckHeartbeat: 11 })
const serverIds = (room: CoopRoom | undefined | null) => room?.cn ? CN_SERVER : SERVER

const roomClients = new Map<string, Set<Client>>()
const NPC_JOIN_DELAY_MS = 2000
const NPC_READY_DELAY_MS = 500
const MEASUREMENT_WARNING_MS = 2000

// While co-op is being tested, every message in both directions goes to logs/coop_frames.log
// (COOP_DEBUG=0 turns it off).
const FRAME_LOG = path.join(process.cwd(), "logs", "coop_frames.log")
function logFrame(client: Client, direction: string, message: unknown): void {
    if (process.env.COOP_DEBUG === "0") return
    try {
        fs.mkdirSync(path.dirname(FRAME_LOG), { recursive: true })
        fs.appendFileSync(FRAME_LOG, `${new Date().toISOString()} [${client.kind ?? "new"} ${client.roomNumber ?? "-"}] ${direction} ${JSON.stringify(message)}\n`)
    } catch { /* logging must never break the battle */ }
}

/** Logs a co-op HTTP request next to the frames, so the order of both is visible. */
export function logHttp(url: string, body: unknown): void {
    if (process.env.COOP_DEBUG === "0") return
    try {
        fs.mkdirSync(path.dirname(FRAME_LOG), { recursive: true })
        fs.appendFileSync(FRAME_LOG, `${new Date().toISOString()} [http] ${url} ${JSON.stringify(body)}\n`)
    } catch { /* logging must never break the request */ }
}

function send(client: Client, message: unknown): void {
    if (client.socket.destroyed) return
    logFrame(client, "server->game", message)
    client.socket.write(JSON.stringify(message) + "\0")
}

function sendToRoom(roomNumber: string, message: unknown, kind: "room" | "battle" = "room"): void {
    for (const client of roomClients.get(roomNumber) ?? []) if (client.kind === kind) send(client, message)
}

const log = (text: string) => console.log(`[coop tcp] ${text}`)

/** Tells everyone in a room it was closed (/disband_room, abort). */
export function notifyRoomDisbanded(roomNumber: string): void {
    sendToRoom(roomNumber, [1, [6, "multibattle_room_dismissed"]])
}

function joinRoom(client: Client, roomNumber: string): void {
    let set = roomClients.get(roomNumber)
    if (!set) roomClients.set(roomNumber, set = new Set())
    set.add(client)
}

function leave(client: Client): void {
    if (client.roomNumber) roomClients.get(client.roomNumber)?.delete(client)
}

// --- handshake -----------------------------------------------------------------------------------

function handshake(client: Client, data: any): void {
    const roomNumber = String(data?.room_number ?? data?.roomNumber ?? "")
    const room = getCoopRoom(roomNumber)

    if (data?.socklet === "cooperation_room") {
        const viewerId = Number(data.viewerId ?? data.viewer_id)
        if (!room || viewerId !== room.hostViewerId) {
            log(`room handshake denied (room ${roomNumber} ${room ? "is not this player's" : "doesn't exist"})`)
            send(client, [3, "HANDSHAKE_DENIED"])
            client.socket.end()
            return
        }
        client.kind = "room"
        client.roomNumber = roomNumber
        client.viewerId = viewerId
        client.connectionId = String(data.connection_id ?? data.connectionId ?? `${roomNumber}-${viewerId}`)
        room.hostConnectionId = client.connectionId
        joinRoom(client, roomNumber)
        send(client, [0, client.connectionId, roomNumber])
        log(`room ${roomNumber}: host connected (connection ${client.connectionId})`)
        return
    }

    if (data?.socklet === "cooperation_battle") {
        if (!room || room.state !== 4) {
            log(`battle handshake denied (room ${roomNumber} ${room ? `is in state ${room.state}` : "doesn't exist"})`)
            send(client, [3, "HANDSHAKE_DENIED"])
            client.socket.end()
            return
        }
        client.kind = "battle"
        client.roomNumber = roomNumber
        client.viewerId = room.hostViewerId
        client.connectionId = String(data.connection_id ?? data.connectionId ?? room.hostConnectionId ?? `${roomNumber}-${room.hostViewerId}`)
        joinRoom(client, roomNumber)
        send(client, [0, roomNumber, ""])
        log(`room ${roomNumber}: battle connected`)
        return
    }

    send(client, [1, "DENIED"])
    client.socket.end()
}

// --- the room (lobby) --------------------------------------------------------------------------

function hostMate(room: CoopRoom): any | undefined {
    return room.mates.find(mate => !mate.comId)
}

/** The host's member entry, made from the save (the party is replaced by the one the game sends). */
function buildHost(room: CoopRoom, connectionId: string): any | null {
    const info = coopPlayerInfo(room.hostPlayerId, room.hostViewerId)
    if (info === null) return null
    const party = loadCoopParty(room.hostPlayerId, room.partyId) ?? { characters: [], unisonCharacters: [], equipments: [], abilitySoulIds: [] }
    return memberEntry(info, party, connectionId, {
        format: room.cn ? "map" : coopManaNodeFormat(), entryTime: Date.now(),
    })
}

/**
 * Enter: the game sends its own member entry (and its party number). That entry is sent back as is,
 * so it's always in the shape the game reads; only if it's missing is one made from the save.
 */
function enter(client: Client, room: CoopRoom, enterData: any, partyId: unknown): void {
    if (room.state === 4) return
    if (Number.isInteger(partyId)) room.partyId = Number(partyId)
    let host: any
    if (enterData && typeof enterData === "object" && enterData.party) {
        host = { ...enterData, connectionId: enterData.connectionId ?? client.connectionId, comId: null }
    } else {
        host = hostMate(room) ?? buildHost(room, client.connectionId!)
        if (!host) return
    }
    room.mates = [host, ...room.mates.filter(mate => mate.comId)]
    room.state = 1
    send(client, [1, [0, host, [host]]])
    // coming back for another round ("Back to Room"): the partners are still here. They're ready, so
    // the host is made ready again and the countdown restarts, as after EnterComs; otherwise the host
    // stays "Preparing" and Start can't be pressed.
    if (room.mates.length > 1) {
        send(client, [1, [1, room.mates]])
        setTimeout(() => {
            if (room.state === 4 || hostMate(room) !== host) return
            for (const com of room.mates.filter(mate => mate.comId)) {
                com.state = [1]
                sendToRoom(room.roomNumber, [1, [2, com.connectionId, [1]]])
            }
            host.state = [1]
            sendToRoom(room.roomNumber, [1, [2, host.connectionId, [1]]])
            sendToRoom(room.roomNumber, [1, [serverIds(room).StartRemainingTime, 2]])
        }, NPC_READY_DELAY_MS)
    }
    log(`room ${room.roomNumber}: host entered`)
}

/** EnterComs: the two COM partners join (after a short delay, as on the fork), then get ready. */
function enterComs(room: CoopRoom): void {
    if (room.state === 4) return
    const host = hostMate(room)
    const info = coopPlayerInfo(room.hostPlayerId, room.hostViewerId)
    if (!host || info === null) return
    const partners = partnerParties(room.hostPlayerId, room.partyId)
    // the partners copy the host's rank and title as the game shows them
    const shown = { ...info, rank: Number(host.rank) || info.rank, degreeId: Number(host.degreeId) || info.degreeId }
    const coms = partners.slice(0, 2).map((partner, index) => memberEntry(shown, partner.party, `${room.roomNumber}-npc-${index + 1}`, {
        comId: index + 1, viewerId: 900000001 + index, name: `${info.name} (party ${partner.partyId})`,
        format: room.cn ? "map" : coopManaNodeFormat(), entryTime: Date.now(),
    }))
    room.mates = [host, ...coms]
    log(`room ${room.roomNumber}: COM partners from parties ${partners.map(p => p.partyId).join(", ")}`)

    setTimeout(() => {
        sendToRoom(room.roomNumber, [1, [1, room.mates]])
        setTimeout(() => {
            for (const com of coms) {
                com.state = [1]
                sendToRoom(room.roomNumber, [1, [2, com.connectionId, [1]]])
            }
            // everyone else is ready: the host is made ready too, and the countdown starts
            host.state = [1]
            sendToRoom(room.roomNumber, [1, [2, host.connectionId, [1]]])
            sendToRoom(room.roomNumber, [1, [serverIds(room).StartRemainingTime, 2]])
        }, NPC_READY_DELAY_MS)
    }, NPC_JOIN_DELAY_MS)
}

function roomMessage(client: Client, data: any[]): void {
    const room = getCoopRoom(client.roomNumber ?? "")
    if (!room) return
    if (data[0] !== 0) return // Broadcast/Send: there are no other players to pass them to
    const notify = Array.isArray(data[1]) ? data[1] : []
    switch (notify[0]) {
        case 0: enter(client, room, notify[1], notify[2]); break
        case 1: // Bye: the room connection is closing (also when switching to the battle)
            log(`room ${room.roomNumber}: room connection closing (state ${room.state})`)
            break
        case 2: { // ChangeParty(party, flag, party number) in the global client
            const host = hostMate(room)
            const party = notify[1]?.party ?? (notify[1]?.characters ? notify[1] : null)
            if (host && party && room.state !== 4) {
                host.party = party
                if (Number.isInteger(notify[3])) room.partyId = notify[3]
                sendToRoom(room.roomNumber, [1, [SERVER.Mates, room.mates]])
            }
            break
        }
        case 3: { // Ready
            const host = hostMate(room)
            if (host && room.state !== 4) {
                host.state = Array.isArray(notify[1]) ? notify[1] : [1]
                sendToRoom(room.roomNumber, [1, [2, host.connectionId, host.state]])
            }
            break
        }
        case 4: send(client, [1, [serverIds(room).AckHeartbeat, client.connectionId]]); break // Heartbeat
        case 6: // StartBattle
            if (room.state === 4) break
            room.state = 4
            room.battleReady.clear()
            room.battleStarted = false
            sendToRoom(room.roomNumber, [1, [5, room.mates]])
            log(`room ${room.roomNumber}: battle starting with ${room.mates.length} member(s)`)
            break
        case 7: { // ChangeAutoplayMode(mode, reset speed) -> AutoplayModeChanged(connection, mode, reset)
            const host = hostMate(room)
            if (host && typeof notify[1] === "boolean") {
                host.autoplayMode = notify[1]
                if (notify[2] === true) host.autoSpeedLevel = 1
                sendToRoom(room.roomNumber, [1, [SERVER.AutoplayModeChanged, host.connectionId, notify[1], notify[2] === true]])
            }
            break
        }
        case 8: { // ChangeAutoStart(on) -> AutoStartChanged(connection, on)
            const host = hostMate(room)
            if (host && typeof notify[1] === "boolean") {
                host.autoStart = notify[1]
                sendToRoom(room.roomNumber, [1, [SERVER.AutoStartChanged, host.connectionId, notify[1]]])
            }
            break
        }
        case 10: enterComs(room); break // EnterComs
        default: break // Suspend (5), Log (9)
    }
}

// --- the battle ------------------------------------------------------------------------------------

function battleMessage(client: Client, data: any[]): void {
    const room = getCoopRoom(client.roomNumber ?? "")
    if (!room) return
    if (data[0] === 1 || data[0] === 2) {
        // Broadcast/Send: nobody to pass them to; acknowledge as the fork does
        send(client, [1, [3, 0, 0, Date.now()]])
        return
    }
    if (data[0] !== 0) return
    const notify = Array.isArray(data[1]) ? data[1] : []
    // CN: 1 LevelNext (the next scene; nothing to answer), then everything one later than global
    if (room.cn && notify[0] === 1) return
    const kind = room.cn && notify[0] > 1 ? notify[0] - 1 : notify[0]
    switch (kind) {
        case 0: // SceneReady: the only real player is ready, so the battle (or next scene) starts
            room.battleReady.add(client.connectionId!)
            if (!room.battleStarted) {
                room.battleStarted = true
                send(client, [1, [1]])
                log(`room ${room.roomNumber}: battle started`)
            }
            break
        case 1: send(client, [1, [2]]); log(`room ${room.roomNumber}: battle finished`); break // Finalize -> Finalized
        case 2: send(client, [1, [3, notify[1] ?? 0, notify[2] ?? 0, MEASUREMENT_WARNING_MS]]); break // Measurement
        default: break // LineSpeedWarning (3), Heartbeat (4)
    }
}

// --- the server ------------------------------------------------------------------------------------

function onFrame(client: Client, frame: unknown): void {
    logFrame(client, "game->server", frame)
    if (client.kind === null) return handshake(client, frame)
    if (!Array.isArray(frame)) return
    if (client.kind === "room") roomMessage(client, frame)
    else battleMessage(client, frame)
}

let server: net.Server | null = null

/** Starts the battle connection server (once). Listens on every network address, so a phone can reach it. */
/** The co-op server's address: COOP_LISTEN_HOST, else the web server's LISTEN_HOST, else every address.
 *  A phone playing over Wi-Fi needs 0.0.0.0; an emulator (adb reverse) or the phone companion 127.0.0.1. */
export function coopListenHost(): string {
    return process.env.COOP_LISTEN_HOST || process.env.LISTEN_HOST || "0.0.0.0"
}

export function startCoopServer(port: number, host = coopListenHost()): net.Server {
    if (server) return server
    server = net.createServer(socket => {
        const client: Client = { socket, kind: null, roomNumber: null, viewerId: null, connectionId: null, buffer: "" }
        socket.setEncoding("utf8")
        socket.setNoDelay(true)
        socket.setKeepAlive(true, 10_000)
        socket.on("data", (chunk: string) => {
            client.buffer += chunk
            if (client.buffer.length > 4 * 1024 * 1024) { socket.destroy(); return }
            const { frames, rest, invalid } = splitFrames(client.buffer)
            client.buffer = rest
            if (invalid > 0) {
                log(`${invalid} message(s) from the game weren't JSON`)
                logFrame(client, "game->server (not JSON)", rest)
            }
            for (const frame of frames) {
                try { onFrame(client, frame) } catch (error) { console.error("[coop tcp] message failed:", error) }
            }
        })
        socket.on("close", () => {
            leave(client)
            if (client.kind) log(`room ${client.roomNumber}: ${client.kind} connection closed`)
        })
        socket.on("error", () => { /* closed below */ })
    })
    server.on("error", error => console.error(`[coop tcp] server error: ${(error as Error).message}`))
    server.listen(port, host, () => log(`co-op battle server listening on ${host}:${port}`))
    return server
}

export function stopCoopServer(): Promise<void> {
    return new Promise(resolve => {
        if (!server) return resolve()
        server.close(() => resolve())
        for (const set of roomClients.values()) for (const client of set) client.socket.destroy()
        roomClients.clear()
        server = null
    })
}
