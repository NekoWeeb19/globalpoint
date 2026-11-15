// Tests the element-tagged "NPC" co-op partners (src/lib/coop.ts partyNameElement, pickPartnerParties): on a stage
// with a recommended element, "NPC" parties named with that element ("Thunder NPC") are picked first, then "NPC"
// parties with no element, then other-element ones, then the strongest parties; stages without an element keep the
// old order. Pure functions, no database:
//   npx tsc
//   node scripts/test_coop_element_partners.mjs
import { createRequire } from "module"
import path from "path"

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..")
const require = createRequire(path.join(repo, "package.json"))
const { partyNameElement, pickPartnerParties } = require(path.join(repo, "out/lib/coop.js"))
const { questElement } = require(path.join(repo, "out/lib/quest.js"))

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const FIRE = 0, WATER = 1, THUNDER = 2, WIND = 3, LIGHT = 4, DARK = 5

// names
const names = [
    ["Thunder NPC", THUNDER], ["[Water NPC]", WATER], ["fire npc", FIRE], ["WIND-NPC", WIND], ["Lightning NPC", THUNDER],
    ["Light NPC", LIGHT], ["[Dark NPC]", DARK], ["雷 NPC", THUNDER], ["风NPC", WIND], ["風 NPC", WIND], ["光NPC", LIGHT],
    ["NPC", undefined], ["Party A", undefined], ["Fire Water NPC", undefined], ["Firefly NPC", undefined], ["Darkness NPC", undefined],
]
for (const [name, want] of names) check(`"${name}" -> ${want}`, partyNameElement(name) === want, partyNameElement(name))

const party = (partyId, name, strength = 0) => ({ partyId, name, characterIds: [1, null, null], strength })
const parties = [
    party(1, "Party A", 900),        // the party in use
    party(2, "Water NPC", 10),
    party(3, "NPC", 20),
    party(4, "Party D", 800),
    party(13, "Thunder NPC", 5),     // group 2
    party(14, "[Thunder NPC]", 1),
    party(15, "Party E", 700),
]

check("thunder stage: both Thunder NPC parties, in party order",
    JSON.stringify(pickPartnerParties(parties, 1, THUNDER)) === "[13,14]", pickPartnerParties(parties, 1, THUNDER))
check("water stage: Water NPC, then plain NPC",
    JSON.stringify(pickPartnerParties(parties, 1, WATER)) === "[2,3]", pickPartnerParties(parties, 1, WATER))
check("fire stage (no Fire NPC): plain NPC first, then another element's NPC",
    JSON.stringify(pickPartnerParties(parties, 1, FIRE)) === "[3,2]", pickPartnerParties(parties, 1, FIRE))
check("no stage element: NPC parties in party order, as before",
    JSON.stringify(pickPartnerParties(parties, 1)) === "[2,3]", pickPartnerParties(parties, 1))

const one = [party(1, "Party A", 900), party(2, "Thunder NPC", 10), party(3, "NPC", 20), party(4, "Party D", 800)]
check("one Thunder NPC + one plain NPC: both used, Thunder first",
    JSON.stringify(pickPartnerParties(one, 1, THUNDER)) === "[2,3]", pickPartnerParties(one, 1, THUNDER))
const solo = [party(1, "Party A", 900), party(2, "Thunder NPC", 10), party(4, "Party D", 800), party(5, "Party E", 850)]
check("one Thunder NPC only: it, then the strongest other party",
    JSON.stringify(pickPartnerParties(solo, 1, THUNDER)) === "[2,5]", pickPartnerParties(solo, 1, THUNDER))
const twins = [party(1, "Party A", 900), party(6, "Dark NPC", 10), party(7, "Dark NPC", 10)]
check("two slots with the same name and units: both used",
    JSON.stringify(pickPartnerParties(twins, 1, DARK)) === "[6,7]", pickPartnerParties(twins, 1, DARK))
check("the party in use is never picked while others exist",
    !pickPartnerParties([party(1, "Thunder NPC"), party(2, "NPC"), party(3, "x", 5)], 1, THUNDER).includes(1))
check("no NPC parties: strongest parties, as before",
    JSON.stringify(pickPartnerParties([party(1, "A", 9), party(2, "B", 5), party(3, "C", 7)], 1, FIRE)) === "[3,2]")

// stage elements the room looks up (category, quest id): hard multi and advent have them; an unknown table is undefined
const elements = require(path.join(repo, "assets/quest_elements.json"))
const hardId = Object.keys(elements.hard_multi_event_quest ?? {})[0]
check("a hard multi stage has its element", hardId !== undefined && questElement(26, Number(hardId)) === elements.hard_multi_event_quest[hardId], hardId)
const adventId = Object.keys(elements.advent_event_quest)[0]
check("an advent stage has its element", questElement(7, Number(adventId)) === elements.advent_event_quest[adventId])
check("a category without element data gives none (old order)", questElement(9999, 1) === undefined)

console.log(failures ? `\n${failures} element partner test(s) failed.` : "\nAll element partner tests passed.")
process.exit(failures ? 1 : 0)
