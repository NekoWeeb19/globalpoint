// Connects the profile (src/lib/profile.ts) to the database: the profile settings and the
// "Favorite Units" party live in players_profile; titles in players_degrees (src/nya/degree.ts).

import manaNodeData from "../../assets/mana_node.json"
import getDatabase, { Database } from "../data"
import { getPlayerCharactersSync, getPlayerSync } from "../data/wdfpData"
import { DEFAULT_FAVORITE_PARTY, DEFAULT_PROFILE_SETTINGS, FavoriteParty, ProfileSettings, exBoostEntry } from "../lib/profile"
import { getCharactersEvolutionImgLevels } from "../lib/character"
import { DEGREE_COUNT, getOwnedDegreeIdsSync } from "./degree"

interface ProfileRow {
    show_owned_character_count: number
    show_opened_mana_board_second_count: number
    show_owned_degree_count: number
    favorite_party: string | null
}

const manaBoards = manaNodeData as Record<string, Record<string, unknown>>
/** Playable units (they have a Mana Board) and units with a 2nd board: the profile's maximums. */
const MAX_OWNED_CHARACTER_COUNT = Object.values(manaBoards).filter(boards => boards["1"] !== undefined).length
const MAX_SECOND_BOARD_COUNT = Object.values(manaBoards).filter(boards => boards["2"] !== undefined).length

function getRow(playerId: number): ProfileRow | null {
    return (getDatabase(Database.WDFP_DATA).prepare(`
    SELECT show_owned_character_count, show_opened_mana_board_second_count, show_owned_degree_count, favorite_party
    FROM players_profile WHERE player_id = ?
    `).get(playerId) as ProfileRow | undefined) ?? null
}

export function getProfileSettingsSync(playerId: number): ProfileSettings {
    const row = getRow(playerId)
    if (row === null) return { ...DEFAULT_PROFILE_SETTINGS }
    return {
        showOwnedCharacterCount: row.show_owned_character_count !== 0,
        showOpenedManaBoardSecondCount: row.show_opened_mana_board_second_count !== 0,
        showOwnedDegreeCount: row.show_owned_degree_count !== 0,
    }
}

export function saveProfileSettingsSync(playerId: number, settings: ProfileSettings) {
    getDatabase(Database.WDFP_DATA).prepare(`
    INSERT INTO players_profile (show_owned_character_count, show_opened_mana_board_second_count, show_owned_degree_count, player_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (player_id) DO UPDATE SET
        show_owned_character_count = excluded.show_owned_character_count,
        show_opened_mana_board_second_count = excluded.show_opened_mana_board_second_count,
        show_owned_degree_count = excluded.show_owned_degree_count
    `).run(settings.showOwnedCharacterCount ? 1 : 0, settings.showOpenedManaBoardSecondCount ? 1 : 0, settings.showOwnedDegreeCount ? 1 : 0, playerId)
}

/** The "Favorite Units" party, or the default (the hero alone) if it was never set. */
export function getFavoritePartySync(playerId: number): FavoriteParty {
    const saved = getRow(playerId)?.favorite_party
    if (!saved) return { ...DEFAULT_FAVORITE_PARTY }
    try {
        return { ...DEFAULT_FAVORITE_PARTY, ...JSON.parse(saved) as FavoriteParty }
    } catch {
        return { ...DEFAULT_FAVORITE_PARTY }
    }
}

export function saveFavoritePartySync(playerId: number, party: FavoriteParty) {
    getDatabase(Database.WDFP_DATA).prepare(`
    INSERT INTO players_profile (favorite_party, player_id) VALUES (?, ?)
    ON CONFLICT (player_id) DO UPDATE SET favorite_party = excluded.favorite_party
    `).run(JSON.stringify(party), playerId)
}

/** The counts the profile shows (profile_info, and the same fields in target_user_info). */
export function getProfileInfoSync(playerId: number) {
    const player = getPlayerSync(playerId)
    const characters = getPlayerCharactersSync(playerId)
    return {
        owned_character_count: Object.keys(characters).length,
        max_owned_character_count: MAX_OWNED_CHARACTER_COUNT,
        opened_mana_board_second_count: Object.values(characters).filter(character => character.manaBoardIndex >= 2).length,
        max_opened_mana_board_second_count: MAX_SECOND_BOARD_COUNT,
        owned_degree_count: getOwnedDegreeIdsSync(playerId, player?.degreeId ?? 1).length,
        max_owned_degree_count: DEGREE_COUNT,
    }
}

/** The favorite_character block of /profile/get_profile (3 units, 3 unison units, their EX Boosts). */
export function getFavoriteCharacterSync(playerId: number) {
    const party = getFavoritePartySync(playerId)
    const characters = getPlayerCharactersSync(playerId)
    const boost = (id: number | null) => id === null ? null : exBoostEntry(characters[String(id)]?.exBoost)
    return {
        character_ids: [...party.characterIds],
        unison_character_ids: [...party.unisonCharacterIds],
        character_ex_boost: party.characterIds.map(boost),
        unison_character_ex_boost: party.unisonCharacterIds.map(boost),
    }
}

/** The evolution (awakening) art level of the profile's leader, for its full picture. */
export function leaderEvolutionLevelSync(playerId: number): number {
    const leader = getFavoritePartySync(playerId).characterIds.find(id => id !== null) ?? null
    if (leader === null) return 0
    return getCharactersEvolutionImgLevels(playerId, [leader])[0] ?? 0
}
