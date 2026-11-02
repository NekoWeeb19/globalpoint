// Co-op (multiplayer) battles played alone with COM partners: the pure parts.
//
// The protocol follows the Chinese StarPoint fork (src/multi/, docs/protocol/multi-battle.md), worked
// out from its client, and the global recordings in docs/routes/multi_battle_quest_*.md. The partners
// are the player's own parties: on global the server's /summon handed out other players' teams;
// here there are no other players, so the player's saved parties stand in.
//
// Two party formats exist and must not be mixed:
// - HTTP /summon (as recorded on global): snake_case, mana_node_ids a list, plain null slots.
// - The battle connection's session party (as in the fork): camelCase equipment and cores, every slot
//   wrapped as an Option ([0, value] or [1] for empty), mana_node_ids a map { nodeId: awakeLevel }.
//   Global has no node awakening, so the map's values are 0; COOP_MANA_NODE_FORMAT=list sends a list
//   instead, in case the global client expects that.

export type Option<T> = readonly [0, T] | readonly [1]
const some = <T>(value: T): Option<T> => [0, value]
const none = <T>(): Option<T> => [1]

export interface CoopCharacter {
    id: number
    evolutionLevel: number
    exp: number
    overLimitStep: number
    manaNodeIds: number[]
    exBoost?: { statusId: number, abilityIdList: number[] }
}

export interface CoopEquipment {
    id: number
    level: number
    enhancementLevel: number
}

/** A party with its units and armaments looked up (null for an empty slot or a missing unit). */
export interface CoopParty {
    characters: (CoopCharacter | null)[]
    unisonCharacters: (CoopCharacter | null)[]
    equipments: (CoopEquipment | null)[]
    abilitySoulIds: (number | null)[]
}

export type ManaNodeFormat = "map" | "list"

const three = <T>(list: (T | null | undefined)[]): (T | null)[] => [0, 1, 2].map(i => list[i] ?? null)

function sessionCharacter(c: CoopCharacter | null, format: ManaNodeFormat): Option<object> {
    if (c === null) return none()
    return some({
        id: c.id,
        evolution_level: c.evolutionLevel,
        exp: c.exp,
        over_limit_step: c.overLimitStep,
        mana_node_ids: format === "list" ? [...c.manaNodeIds] : Object.fromEntries(c.manaNodeIds.map(id => [String(id), 0])),
        ex_boost: c.exBoost && c.exBoost.abilityIdList.length > 0
            ? some({ ability_id_list: [...c.exBoost.abilityIdList], status_id: c.exBoost.statusId })
            : none(),
        illustration_settings: none(),
    })
}

/**
 * The party as the battle connection sends it (Welcome, Mates, Start), in the shape the global game
 * itself sends (its Enter message): the CN fork's fields plus `options: null`, Mana nodes a list.
 */
export function sessionParty(party: CoopParty, format: ManaNodeFormat = "list") {
    return {
        equipments: three(party.equipments).map(e => e === null ? none() : some({ level: e.level, equipmentId: e.id, enhancementLevel: e.enhancementLevel })),
        abilitySoulIds: three(party.abilitySoulIds).map(id => id === null ? none() : some(id)),
        options: null,
        unison_characters: three(party.unisonCharacters).map(c => sessionCharacter(c, format)),
        characters: three(party.characters).map(c => sessionCharacter(c, format)),
    }
}

/**
 * The party as HTTP /summon returns it (the recorded global shape). The CN client reads mana_node_ids
 * as a map { node id: awake level } here too (a list stops it with C8601, "key=0").
 */
export function summonParty(party: CoopParty, format: ManaNodeFormat = "list") {
    const character = (c: CoopCharacter | null) => c === null ? null : {
        id: c.id,
        mana_node_ids: format === "map" ? Object.fromEntries(c.manaNodeIds.map(id => [String(id), 0])) : [...c.manaNodeIds],
        evolution_level: c.evolutionLevel,
        exp: c.exp,
        over_limit_step: c.overLimitStep,
    }
    return {
        characters: three(party.characters).map(character),
        unison_characters: three(party.unisonCharacters).map(character),
        equipments: three(party.equipments).map(e => e === null ? null : { equipment_id: e.id, level: e.level, enhancement_level: e.enhancementLevel }),
        ability_soul_ids: three(party.abilitySoulIds),
    }
}

export interface CoopPlayerInfo {
    viewerId: number
    name: string
    rank: number
    degreeId: number
    mainCharacterId: number
}

/**
 * A room member entry: the host, or a COM partner. Exactly the fields the global game sends for itself
 * in its Enter message (logged from the game; the CN fork's version has isHost, isNewbie,
 * mainCharacterId and currentPartyId, which the global game doesn't, and lacks comId, which it needs):
 * comId is null for a player and the partner's number for a COM.
 */
export function memberEntry(
    player: CoopPlayerInfo,
    party: CoopParty,
    connectionId: string,
    options: { comId?: number, name?: string, viewerId?: number, format?: ManaNodeFormat, entryTime: number, playerRoleKind?: number }
) {
    const isCom = options.comId !== undefined
    return {
        party: sessionParty(party, options.format),
        viewerId: options.viewerId ?? player.viewerId,
        comId: isCom ? options.comId : null,
        autoSpeedLevel: 1,
        skillAbilityBehaviorMode: 1,
        autoplayMode: isCom,
        autoStart: false,
        rank: player.rank,
        playerRoleKind: options.playerRoleKind ?? (isCom ? 99 : 1),
        dashBehaviorMode: 1,
        allowHealFromOtherPlayers: true,
        autoskillMode: 1,
        entryTime: options.entryTime,
        connectionId,
        name: options.name ?? player.name,
        state: [0],
        degreeId: player.degreeId,
    }
}

/** A saved party, by its global id (1-120: group (id-1)/10+1, slot (id-1)%10+1). */
export interface SavedParty {
    partyId: number
    name: string
    characterIds: (number | null)[]
    /** Total EXP of its main units, to rank parties by how built-up they are. */
    strength: number
}

/**
 * The two parties that partner the player: parties named with "NPC" first (as in the fork), then the
 * player's other strongest parties, never the party the player is using; if there aren't enough, the
 * player's own party fills in.
 */
export function pickPartnerParties(parties: SavedParty[], currentPartyId: number): number[] {
    const usable = parties.filter(p => p.partyId !== currentPartyId && p.characterIds.some(id => id !== null))
    const named = usable.filter(p => p.name.toUpperCase().includes("NPC"))
    const rest = usable.filter(p => !named.includes(p)).sort((a, b) => b.strength - a.strength || a.partyId - b.partyId)
    const picked = [...named, ...rest].slice(0, 2).map(p => p.partyId)
    while (picked.length < 2) picked.push(currentPartyId)
    return picked
}

/** The global party id's group and slot. */
export function partyGroupSlot(partyId: number): { group: number, slot: number } | null {
    if (!Number.isInteger(partyId) || partyId < 1 || partyId > 120) return null
    return { group: Math.floor((partyId - 1) / 10) + 1, slot: ((partyId - 1) % 10) + 1 }
}

/** A six-digit room number not already in use. */
export function newRoomNumber(inUse: (roomNumber: string) => boolean, random: () => number = Math.random): string {
    for (let i = 0; i < 1000; i++) {
        const number = String(100000 + Math.floor(random() * 900000))
        if (!inUse(number)) return number
    }
    throw new Error("No free room number.")
}

/** Splits a TCP stream into its \0-terminated JSON frames; returns the frames and the unfinished rest. */
export function splitFrames(buffer: string): { frames: unknown[], rest: string, invalid: number } {
    const parts = buffer.split("\0")
    const rest = parts.pop() ?? ""
    const frames: unknown[] = []
    let invalid = 0
    for (const part of parts) {
        if (part.trim() === "") continue
        try { frames.push(JSON.parse(part)) } catch { invalid++ }
    }
    return { frames, rest, invalid }
}
