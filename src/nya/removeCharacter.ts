// Takes one unit out of a player's save (dashboard: Players > a player > Remove a unit), e.g. before a custom
// unit is deleted (docs/CUSTOM_UNITS.md): a save holding a unit the game's tables don't have stops with C8601.
// Everything that names the unit goes with it, so nothing left behind points at it:
// - the unit itself, its Mana Board nodes, amity (bond token) rows and awakened nodes;
// - the leader (home unit) and party slots: emptied, and a party left with no main unit gets the new leader;
// - the Favorite Units party (profile), Rush records and played parties, Score Attack history that used it;
// - item log entries (players_receive_history) and unclaimed mails that give it.
// Armaments and ability souls are separate items and stay.
import getDatabase, { Database } from "../data"
import { removeCharacterMails, MAIL_TYPE } from "./mail"

export interface RemoveCharacterResult {
    newLeader: number | null
    partySlots: number
    otherRecords: number
    mails: number
}

/** Whether a JSON value holds this unit under a key naming a character (e.g. character_id, characterIds). */
function mentions(value: unknown, characterId: number, underCharacterKey = false): boolean {
    if (typeof value === "number") return underCharacterKey && value === characterId
    if (Array.isArray(value)) return value.some(v => mentions(v, characterId, underCharacterKey))
    if (value && typeof value === "object") {
        return Object.entries(value).some(([k, v]) => mentions(v, characterId, underCharacterKey || /character/i.test(k)))
    }
    return false
}

const tableExists = (name: string) =>
    getDatabase(Database.WDFP_DATA).prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined

/** Removes a unit from a player's save. Null when the player doesn't have it. */
export function removeCharacterFromSaveSync(playerId: number, characterId: number): RemoveCharacterResult | null {
    const db = getDatabase(Database.WDFP_DATA)
    const owned = db.prepare(`SELECT 1 FROM players_characters WHERE player_id = ? AND id = ?`).get(playerId, characterId)
    if (owned === undefined) return null
    const result: RemoveCharacterResult = { newLeader: null, partySlots: 0, otherRecords: 0, mails: 0 }

    db.transaction(() => {
        db.prepare(`DELETE FROM players_characters_mana_nodes WHERE player_id = ? AND character_id = ?`).run(playerId, characterId)
        db.prepare(`DELETE FROM players_characters_bond_tokens WHERE player_id = ? AND character_id = ?`).run(playerId, characterId)
        db.prepare(`DELETE FROM players_characters WHERE player_id = ? AND id = ?`).run(playerId, characterId)
        if (tableExists("players_mana_node_awake")) {
            db.prepare(`DELETE FROM players_mana_node_awake WHERE player_id = ? AND character_id = ?`).run(playerId, characterId)
        }

        // a unit still owned for the leader and empty parties: the hero (1) if owned, else the first one
        const replacement = (db.prepare(`SELECT id FROM players_characters WHERE player_id = ? ORDER BY (id = 1) DESC, join_time, id LIMIT 1`)
            .get(playerId) as { id: number } | undefined)?.id ?? null
        const player = db.prepare(`SELECT leader_character_id FROM players WHERE id = ?`).get(playerId) as { leader_character_id: number } | undefined
        if (player?.leader_character_id === characterId && replacement !== null) {
            db.prepare(`UPDATE players SET leader_character_id = ? WHERE id = ?`).run(replacement, playerId)
            result.newLeader = replacement
        }

        for (const column of ["character_id_1", "character_id_2", "character_id_3", "unison_character_1", "unison_character_2", "unison_character_3"]) {
            result.partySlots += db.prepare(`UPDATE players_parties SET ${column} = NULL WHERE player_id = ? AND ${column} = ?`).run(playerId, characterId).changes
        }
        if (replacement !== null) {
            db.prepare(`UPDATE players_parties SET character_id_1 = ? WHERE player_id = ? AND character_id_1 IS NULL AND character_id_2 IS NULL AND character_id_3 IS NULL`)
                .run(replacement, playerId)
        }

        const profile = db.prepare(`SELECT favorite_party FROM players_profile WHERE player_id = ?`).get(playerId) as { favorite_party: string | null } | undefined
        if (profile?.favorite_party) {
            try {
                const party = JSON.parse(profile.favorite_party) as { characterIds?: (number | null)[], unisonCharacterIds?: (number | null)[] }
                if (mentions(party, characterId)) {
                    const clear = (ids?: (number | null)[]) => ids?.map(id => id === characterId ? null : id)
                    party.characterIds = clear(party.characterIds)
                    party.unisonCharacterIds = clear(party.unisonCharacterIds)
                    if (party.characterIds && party.characterIds.every(id => id === null)) party.characterIds[0] = replacement
                    db.prepare(`UPDATE players_profile SET favorite_party = ? WHERE player_id = ?`).run(JSON.stringify(party), playerId)
                    result.otherRecords++
                }
            } catch { /* an unreadable party falls back to the default when read */ }
        }

        for (let i = 1; i <= 3; i++) {
            result.otherRecords += db.prepare(`UPDATE players_rush_events SET endless_battle_max_round_character_id_${i} = NULL,
                endless_battle_max_round_character_evolution_img_lvl_${i} = NULL
                WHERE player_id = ? AND endless_battle_max_round_character_id_${i} = ?`).run(playerId, characterId).changes
        }
        result.otherRecords += db.prepare(`DELETE FROM players_rush_events_played_parties WHERE player_id = ? AND ? IN
            (character_id_1, character_id_2, character_id_3, unison_character_id_1, unison_character_id_2, unison_character_id_3)`)
            .run(playerId, characterId).changes

        const history = db.prepare(`SELECT id, record FROM players_score_attack_history WHERE player_id = ?`).all(playerId) as { id: number, record: string }[]
        for (const row of history) {
            let record: unknown
            try { record = JSON.parse(row.record) } catch { continue }
            if (mentions(record, characterId)) result.otherRecords += db.prepare(`DELETE FROM players_score_attack_history WHERE id = ?`).run(row.id).changes
        }

        if (tableExists("players_receive_history")) {
            result.otherRecords += db.prepare(`DELETE FROM players_receive_history WHERE player_id = ? AND type = ? AND type_id = ?`)
                .run(playerId, MAIL_TYPE.CHARACTER, characterId).changes
        }
    })()

    result.mails = removeCharacterMails(playerId, characterId)
    console.log(`[remove unit] player ${playerId}: unit ${characterId} removed (${JSON.stringify(result)})`)
    return result
}
