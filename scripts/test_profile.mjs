// Tests the profile rules (src/lib/profile.ts) and the title mission helpers (src/lib/mission.ts),
// without a database.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_profile.mjs

import { readFileSync } from "node:fs"
import { DEFAULT_PROFILE_SETTINGS, applyProfileSettings, cleanComment, cleanName, favoritePartyFromEdit, favoritePartyGroupList } from "../out/lib/profile.js"
import { MISSION_CATEGORIES, clientReportedEvents, unitStateCharacterId } from "../out/lib/mission.js"

const missions = JSON.parse(readFileSync(new URL("../assets/missions.json", import.meta.url), "utf8")).missions
const degrees = JSON.parse(readFileSync(new URL("../assets/degree.json", import.meta.url), "utf8")).degrees
let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

// data
check("titles: 1282, title 1 is World Voyager", Object.keys(degrees).length === 1282 && degrees["1"].name === "World Voyager")
check("title missions: category 5 has 1154, each pays one title that exists", Object.keys(missions["5"]).length === 1154
    && Object.values(missions["5"]).every(m => m.stages.every(s => s.rewards.length === 1 && s.rewards[0].kind === 6 && degrees[String(s.rewards[0].degreeId)])))
check("category 5 is listed", MISSION_CATEGORIES.includes(5))
check("Reach Rank 50 (1000) is kind 1, target 50, title 1000", missions["5"]["1000"].kind === 1 && missions["5"]["1000"].stages[0].target === 50 && missions["5"]["1000"].stages[0].rewards[0].degreeId === 1000)

// per-unit title missions
check("Vagner's title mission asks about unit 111001", unitStateCharacterId(missions["5"]["111001"]) === 111001)
check("a whole-account mission isn't per-unit", unitStateCharacterId(missions["5"]["55000"]) === null)
check("454 'level to 100 + Amity Scroll' missions are per-unit", Object.values(missions["5"]).filter(m => m.kind === 41 && unitStateCharacterId(m) !== null).length === 454)

// client-reported progress
check("town tap reported -> kind 39 +1", JSON.stringify(clientReportedEvents([{ progress_value: 1, mission_pattern: "home_tap_town_character_count" }])) === JSON.stringify([{ kind: 39, amount: 1 }]))
check("unknown pattern, zero, negative and huge amounts are ignored", clientReportedEvents([{ progress_value: 1, mission_pattern: "twitter_check" }, { progress_value: 0, mission_pattern: "home_change_voice_count" }, { progress_value: -3, mission_pattern: "home_change_voice_count" }, { progress_value: 1e9, mission_pattern: "home_change_voice_count" }]).length === 0)
check("not a list -> nothing", clientReportedEvents(null).length === 0)

// settings
check("settings: one field changes, the others stay", JSON.stringify(applyProfileSettings(DEFAULT_PROFILE_SETTINGS, { show_owned_degree_count: false })) === JSON.stringify({ ...DEFAULT_PROFILE_SETTINGS, showOwnedDegreeCount: false }))
check("settings: a non-boolean is refused", applyProfileSettings(DEFAULT_PROFILE_SETTINGS, { show_owned_degree_count: 0 }) === null)
check("settings: nothing known is refused", applyProfileSettings(DEFAULT_PROFILE_SETTINGS, { other: true }) === null && applyProfileSettings(DEFAULT_PROFILE_SETTINGS, null) === null)

// name and comment
check("name: trimmed", cleanName("  Distant ") === "Distant")
check("name: blank, too long or not text is refused", cleanName("   ") === null && cleanName("x".repeat(21)) === null && cleanName(5) === null)
check("comment: blank allowed, 100 max", cleanComment("") === "" && cleanComment("y".repeat(100)) !== null && cleanComment("y".repeat(101)) === null)

// favorite units
const fav = favoritePartyFromEdit({ party_name: "Faves", character_ids: [1, 2], unison_character_ids: [3, "x", null], equipment_ids: [], ability_soul_ids: [4, 5, 6], options: { allow_other_players_to_heal_me: false }, party_edited: true })
check("favorite from an edit: three slots each, odd values emptied", JSON.stringify(fav.characterIds) === "[1,2,null]" && JSON.stringify(fav.unisonCharacterIds) === "[3,null,null]" && fav.allowOtherPlayersToHealMe === false)
const group = favoritePartyGroupList(fav)[0]
check("favorite group: the recorded global shape (group 1, color 7, party 1)", group.party_group_id === 1 && group.party_group_color_id === 7 && group.party_list[0].party_id === 1 && group.party_list[0].party_name === "Faves" && group.party_list[0].options.allow_other_players_to_heal_me === false)

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
