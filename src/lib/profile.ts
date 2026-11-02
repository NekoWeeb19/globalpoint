// The player profile: the pure parts. Reply shapes are the recorded global /profile/get_my_profile
// reply and the field paths the global client reads (data.target_user_info.*, data.favorite_character.*,
// data.user_info.name / comment / degree_id); the rules follow the Chinese fork's routes/api/profile.ts.

export interface ProfileSettings {
    showOwnedCharacterCount: boolean
    showOpenedManaBoardSecondCount: boolean
    showOwnedDegreeCount: boolean
}

export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = Object.freeze({
    showOwnedCharacterCount: true,
    showOpenedManaBoardSecondCount: true,
    showOwnedDegreeCount: true,
})

const SETTING_FIELDS = {
    show_owned_character_count: "showOwnedCharacterCount",
    show_opened_mana_board_second_count: "showOpenedManaBoardSecondCount",
    show_owned_degree_count: "showOwnedDegreeCount",
} as const

export function serializeProfileSettings(settings: ProfileSettings) {
    return {
        show_owned_character_count: settings.showOwnedCharacterCount,
        show_opened_mana_board_second_count: settings.showOpenedManaBoardSecondCount,
        show_owned_degree_count: settings.showOwnedDegreeCount,
    }
}

/**
 * The settings after an /update_profile_settings request, or null when the request is malformed
 * (not an object, nothing known in it, or a known field that isn't true/false).
 */
export function applyProfileSettings(current: ProfileSettings, requested: unknown): ProfileSettings | null {
    if (requested === null || typeof requested !== "object" || Array.isArray(requested)) return null
    const body = requested as Record<string, unknown>
    const known = Object.keys(SETTING_FIELDS).filter(field => field in body)
    if (known.length === 0) return null
    const next: ProfileSettings = { ...current }
    for (const field of known) {
        const value = body[field]
        if (typeof value !== "boolean") return null
        next[SETTING_FIELDS[field as keyof typeof SETTING_FIELDS]] = value
    }
    return next
}

/**
 * Name limits: not blank, at most 20 characters. The game's own name box sets the real limit; this
 * is only a safety cap (the Chinese fork uses the same 20).
 */
export const MAX_NAME_LENGTH = 20
/** Comment limit (the Chinese fork uses 100; blank is allowed). */
export const MAX_COMMENT_LENGTH = 100

/** A cleaned-up name, or null if it can't be used. */
export function cleanName(value: unknown): string | null {
    if (typeof value !== "string") return null
    const name = value.trim()
    if (name.length === 0 || [...name].length > MAX_NAME_LENGTH || /[\u0000-\u001f]/.test(name)) return null
    return name
}

/** A cleaned-up comment, or null if it can't be used. */
export function cleanComment(value: unknown): string | null {
    if (typeof value !== "string") return null
    if ([...value].length > MAX_COMMENT_LENGTH || /[\u0000-\u0009\u000b-\u001f]/.test(value)) return null
    return value
}

/** The "Favorite Units" party shown on the profile (one party of three units, three unison units). */
export interface FavoriteParty {
    name: string
    characterIds: (number | null)[]
    unisonCharacterIds: (number | null)[]
    equipmentIds: (number | null)[]
    abilitySoulIds: (number | null)[]
    allowOtherPlayersToHealMe: boolean
    edited: boolean
}

/** What an account that never set its favorites shows (the recorded global reply: the hero alone). */
export const DEFAULT_FAVORITE_PARTY: FavoriteParty = Object.freeze({
    name: "Setting Favorite Units",
    characterIds: [1, null, null],
    unisonCharacterIds: [null, null, null],
    equipmentIds: [null, null, null],
    abilitySoulIds: [null, null, null],
    allowOtherPlayersToHealMe: true,
    edited: false,
})

const three = (list: unknown): (number | null)[] => {
    const values = Array.isArray(list) ? list : []
    return [0, 1, 2].map(i => {
        const value = values[i]
        return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null
    })
}

/** A favorite party from a /party/edit party_info entry (unknown values become empty slots). */
export function favoritePartyFromEdit(info: Record<string, any>): FavoriteParty {
    return {
        name: typeof info.party_name === "string" ? info.party_name : DEFAULT_FAVORITE_PARTY.name,
        characterIds: three(info.character_ids),
        unisonCharacterIds: three(info.unison_character_ids),
        equipmentIds: three(info.equipment_ids),
        abilitySoulIds: three(info.ability_soul_ids),
        allowOtherPlayersToHealMe: info.options?.allow_other_players_to_heal_me !== false,
        edited: info.party_edited === true,
    }
}

/** The recorded global user_party_group_list for the profile: group 1 (color 7) with the one party. */
export function favoritePartyGroupList(party: FavoriteParty) {
    return [{
        party_group_id: 1,
        party_group_color_id: 7,
        party_list: [{
            party_id: 1,
            party_group_id: 1,
            party_name: party.name,
            character_ids: [...party.characterIds],
            unison_character_ids: [...party.unisonCharacterIds],
            equipment_ids: [...party.equipmentIds],
            ability_soul_ids: [...party.abilitySoulIds],
            options: { allow_other_players_to_heal_me: party.allowOtherPlayersToHealMe },
            party_edited: party.edited,
        }],
    }]
}

/** A unit's EX Boost as the profile shows it, or null without one. */
export function exBoostEntry(exBoost: { statusId: number, abilityIdList: number[] } | undefined | null) {
    if (!exBoost || !(exBoost.statusId > 0) || exBoost.abilityIdList.length === 0) return null
    return { status_id: exBoost.statusId, ability_id_list: [...exBoost.abilityIdList] }
}
