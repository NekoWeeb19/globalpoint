// Co-op rooms (in memory) and the player's data for them (src/lib/coop.ts has the pure parts).
// A room lives while the server runs: a single-player server has no reason to keep it across restarts.

import os from "os"
import { inCnRequest } from "../lib/cnClient"
import {
    getPlayerCharacterManaNodesSync,
    getPlayerCharacterSync,
    getPlayerCharactersSync,
    getPlayerEquipmentSync,
    getPlayerPartyGroupListSync,
    getPlayerSync,
} from "../data/wdfpData"
import { PartyCategory } from "../data/types"
import { CoopCharacter, CoopParty, CoopPlayerInfo, ManaNodeFormat, SavedParty, newRoomNumber, partyGroupSlot, pickPartnerParties } from "../lib/coop"
import { getRankByPt } from "./player"

export interface CoopRoom {
    roomNumber: string
    hostViewerId: number
    hostPlayerId: number
    category: number
    questId: number
    partyId: number
    /** 2 waiting for the host, 1 ready (in the room), 4 in battle. */
    state: number
    hostEntryTime: number
    roomSequence: number
    /** The member entries sent to the game (host first, then COM partners). */
    mates: any[]
    hostConnectionId: string | null
    battleReady: Set<string>
    battleStarted: boolean
    /** Made from the CN client, which numbers some co-op messages differently (src/coop/tcp.ts). */
    cn: boolean
}

const rooms = new Map<string, CoopRoom>()
let roomSequence = 16_000_000

export const getCoopRoom = (roomNumber: string): CoopRoom | undefined => rooms.get(String(roomNumber))

/** The room a host already has (one at a time here). */
export const getHostRoom = (viewerId: number): CoopRoom | undefined => [...rooms.values()].find(r => r.hostViewerId === viewerId)

export function createCoopRoom(hostViewerId: number, hostPlayerId: number, category: number, questId: number, partyId: number): CoopRoom {
    // a player has one room at a time
    for (const room of [...rooms.values()]) if (room.hostViewerId === hostViewerId) rooms.delete(room.roomNumber)
    const room: CoopRoom = {
        roomNumber: newRoomNumber(number => rooms.has(number)),
        hostViewerId, hostPlayerId, category, questId, partyId,
        state: 2,
        hostEntryTime: Math.floor(Date.now() / 1000),
        roomSequence: ++roomSequence,
        mates: [],
        hostConnectionId: null,
        battleReady: new Set(),
        battleStarted: false,
        cn: inCnRequest(),
    }
    rooms.set(room.roomNumber, room)
    console.log(`[coop] Room ${room.roomNumber} created by viewer ${hostViewerId} (category ${category}, quest ${questId}, party ${partyId}).`)
    return room
}

export function deleteCoopRoom(roomNumber: string): boolean {
    const deleted = rooms.delete(String(roomNumber))
    if (deleted) console.log(`[coop] Room ${roomNumber} closed.`)
    return deleted
}

/** The session party's mana node format: a list, as the global game sends (COOP_MANA_NODE_FORMAT=map for the CN fork's). */
export const coopManaNodeFormat = (): ManaNodeFormat => process.env.COOP_MANA_NODE_FORMAT === "map" ? "map" : "list"

/** The battle connection's port (COOP_PORT, default 18888 as on global). */
export const coopPort = (): number => {
    const port = Number(process.env.COOP_PORT)
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : 18888
}

/**
 * Seconds after Recruit (share_room) before the game asks /summon for COM partners
 * (COOP_SUMMON_SECONDS, default 10). The game reads it as config.summon_com_seconds from the
 * attention/check and share_room replies; without it the game uses its CDN value.
 */
export const coopSummonSeconds = (): number => {
    const seconds = Number(process.env.COOP_SUMMON_SECONDS)
    return Number.isInteger(seconds) && seconds >= 0 && seconds <= 3600 ? seconds : 10
}

/**
 * The address the game connects to for the battle connection: COOP_HOST; else the IPv4 address the
 * game reached the server on (the Host header of its request: 127.0.0.1 for the emulator build, which
 * comes in through `adb reverse`, the PC's LAN address for the phone build); else this PC's first
 * local network (LAN) IPv4 address. Going through the same path as the HTTP requests matters on the
 * emulator: its connections to the PC's LAN address (through LDPlayer's virtual network) failed now
 * and then (S3001:2031), while 127.0.0.1 goes through the adb forward for COOP_PORT.
 */
export function coopHost(requestHost?: string): string {
    const configured = process.env.COOP_HOST?.trim()
    if (configured) return configured
    const hostname = (requestHost ?? "").replace(/:\d+$/, "")
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname
    return lanAddresses()[0] ?? "127.0.0.1"
}

/** This PC's local network (LAN) IPv4 addresses, the usual home network ranges first. */
export function lanAddresses(): string[] {
    const candidates: string[] = []
    for (const list of Object.values(os.networkInterfaces())) {
        for (const address of list ?? []) {
            if (address.family === "IPv4" && !address.internal) candidates.push(address.address)
        }
    }
    const rank = (a: string) => a.startsWith("192.168.") ? 0 : a.startsWith("10.") ? 1 : 2
    return candidates.sort((a, b) => rank(a) - rank(b))
}

export function coopPlayerInfo(playerId: number, viewerId: number): CoopPlayerInfo | null {
    const player = getPlayerSync(playerId)
    if (player === null) return null
    return {
        viewerId,
        name: player.name,
        rank: getRankByPt(player.rankPoint)?.rank ?? 1,
        degreeId: player.degreeId || 1,
        mainCharacterId: player.leaderCharacterId,
    }
}

function coopCharacter(playerId: number, characterId: number | null): CoopCharacter | null {
    if (!characterId) return null
    const character = getPlayerCharacterSync(playerId, characterId)
    if (character === null) return null
    return {
        id: characterId,
        evolutionLevel: character.evolutionLevel,
        exp: character.exp,
        overLimitStep: character.overLimitStep,
        manaNodeIds: getPlayerCharacterManaNodesSync(playerId, characterId),
        ...(character.exBoost ? { exBoost: character.exBoost } : {}),
    }
}

/** A saved party with its units and armaments looked up, or null when the party doesn't exist. */
export function loadCoopParty(playerId: number, partyId: number): CoopParty | null {
    if (partyGroupSlot(partyId) === null) return null
    // parties are saved under the game's own party number (group 2 holds 11-20, group 3 21-30, ...), not 1-10 per group
    const party = Object.values(getPlayerPartyGroupListSync(playerId, PartyCategory.NORMAL))
        .map(group => group.list[String(partyId)])
        .find(found => found !== undefined)
    if (!party) return null
    return {
        characters: party.characterIds.map(id => coopCharacter(playerId, id)),
        unisonCharacters: party.unisonCharacterIds.map(id => coopCharacter(playerId, id)),
        equipments: party.equipmentIds.map(id => {
            if (!id) return null
            const equipment = getPlayerEquipmentSync(playerId, id)
            return equipment === null ? null : { id, level: equipment.level, enhancementLevel: equipment.enhancementLevel }
        }),
        abilitySoulIds: [...party.abilitySoulIds],
    }
}

/** All the player's saved (normal) parties, for choosing partners. */
export function savedParties(playerId: number): SavedParty[] {
    const out: SavedParty[] = []
    for (const group of Object.values(getPlayerPartyGroupListSync(playerId, PartyCategory.NORMAL))) {
        for (const [slot, party] of Object.entries(group.list)) {
            // the saved slot is already the game's party number (group 2 is 11-20): the partner picker used to make
            // (group - 1) * 10 + slot of it (21-30 for group 2), which never loaded, so a player whose strongest
            // parties were outside group 1 got no COM partners and the room's battle never started
            const partyId = Number(slot)
            const strength = party.characterIds.reduce((total: number, id) => total + (id ? getPlayerCharacterSync(playerId, id)?.exp ?? 0 : 0), 0)
            out.push({ partyId, name: party.name ?? "", characterIds: party.characterIds, strength })
        }
    }
    return out
}

/** A party of the player's most built-up units (by EXP): partners when no saved party can be used. */
export function strongestUnitsParty(playerId: number): CoopParty | null {
    const ids = Object.entries(getPlayerCharactersSync(playerId))
        .sort(([, a], [, b]) => (b.exp ?? 0) - (a.exp ?? 0))
        .map(([id]) => Number(id))
    if (ids.length === 0) return null
    const pick = (from: number) => [0, 1, 2].map(i => ids[from + i] === undefined ? null : coopCharacter(playerId, ids[from + i]))
    return { characters: pick(0), unisonCharacters: pick(3), equipments: [null, null, null], abilitySoulIds: [null, null, null] }
}

/**
 * The two partner parties for a room (see pickPartnerParties), loaded. A room without partners never starts its battle,
 * so when those can't be loaded the slots are filled from any other saved party with units, then the party in use, then
 * the player's strongest units (party id 0): the room always gets two.
 */
export function partnerParties(playerId: number, currentPartyId: number): { partyId: number, party: CoopParty }[] {
    const saved = savedParties(playerId)
    const load = (partyId: number) => ({ partyId, party: loadCoopParty(playerId, partyId) })
    const loaded = (p: { partyId: number, party: CoopParty | null }): p is { partyId: number, party: CoopParty } =>
        p.party !== null && p.party.characters.some(c => c !== null)
    const partners = pickPartnerParties(saved, currentPartyId).map(load).filter(loaded)
    if (partners.length >= 2) return partners
    const others = saved
        .filter(p => p.partyId !== currentPartyId && !partners.some(q => q.partyId === p.partyId))
        .sort((a, b) => b.strength - a.strength || a.partyId - b.partyId)
        .map(p => load(p.partyId)).filter(loaded)
    const current = [load(currentPartyId)].filter(loaded)
    const strongest = strongestUnitsParty(playerId)
    const fill = [...others, ...current, ...(strongest ? [{ partyId: 0, party: strongest }] : [])]
    for (let i = 0; partners.length < 2 && fill.length > 0; i++) partners.push(fill[Math.min(i, fill.length - 1)])
    return partners
}
