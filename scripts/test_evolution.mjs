// Tests the awakening rule (src/lib/characterEvolution.ts) against every character's Mana Board 1.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_evolution.mjs

import { readFileSync } from "node:fs"
import { evolutionLevelFromManaNodes, evolutionResponse } from "../out/lib/characterEvolution.js"

const manaNodes = JSON.parse(readFileSync(new URL("../assets/mana_node.json", import.meta.url), "utf8"))
let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

// the three ability slots' first nodes and the skill evolution node of a board
function keyNodes(board) {
    const slots = new Map(), skill = []
    for (const [id, n] of Object.entries(board)) {
        if (n.field1 === "1") continue
        if (n.field5 === "0" && n.field6 !== "") { if (!slots.has(n.field6)) slots.set(n.field6, Number(id)) }
        else if (n.field5 === "2") skill.push(Number(id))
    }
    return { slots: [...slots.values()], skill }
}

// character 1 (the recorded one): nodes 2201.. on Board 1
const one = manaNodes["1"]["1"]
const k1 = keyNodes(one)
check(`character 1 has 3 ability slots and 1 skill evolution node (${k1.slots.join(",")} + ${k1.skill.join(",")})`, k1.slots.length === 3 && k1.skill.length === 1, k1)
check("character 1: the first node alone doesn't awaken", evolutionLevelFromManaNodes(one, new Set([2201])) === 0)
check("character 1: all three statues without the skill evolution node don't awaken", evolutionLevelFromManaNodes(one, new Set(k1.slots)) === 0)
check("character 1: two statues + skill evolution don't awaken", evolutionLevelFromManaNodes(one, new Set([...k1.slots.slice(0, 2), ...k1.skill])) === 0)
check("character 1: three statues + skill evolution awaken (level 1)", evolutionLevelFromManaNodes(one, new Set([...k1.slots, ...k1.skill])) === 1)
check("character 1: any node of each slot counts, not just the first", evolutionLevelFromManaNodes(one, new Set([2206, 2212, 2218, ...k1.skill])) === 1)
check("character 1: Board 2 nodes don't count", evolutionLevelFromManaNodes(one, new Set(Object.keys(manaNodes["1"]["2"]).map(Number))) === 0)
check("nothing learned, nothing awakened", evolutionLevelFromManaNodes(one, new Set()) === 0)
check("an empty board never awakens", evolutionLevelFromManaNodes({}, new Set([1])) === 0)

// every character in the game data
let characters = 0, ok = 0, odd = [], shapes = {}
for (const [characterId, boards] of Object.entries(manaNodes)) {
    const board = boards["1"]
    if (!board) continue
    characters++
    const { slots, skill } = keyNodes(board)
    const all = new Set(Object.keys(board).map(Number))
    const firstOnly = new Set([Number(Object.keys(board)[0])])
    const keyed = new Set([...slots, ...skill])
    if (evolutionLevelFromManaNodes(board, all) === 1 && evolutionLevelFromManaNodes(board, keyed) === 1
        && (slots.length + skill.length <= 1 || evolutionLevelFromManaNodes(board, firstOnly) === 0)) ok++
    else odd.push(characterId)
    shapes[`${slots.length} slots + ${skill.length} skill`] = (shapes[`${slots.length} slots + ${skill.length} skill`] ?? 0) + 1
    if (slots.length < 2 || slots.length > 3 || skill.length !== 1) odd.push(`${characterId}: ${slots.length} slots, ${skill.length} skill`)
}
console.log("Board 1 shapes:", JSON.stringify(shapes))
check(`all ${characters} characters: a full Board 1 and the key nodes awaken, a single node doesn't`, ok === characters && odd.length === 0, odd.slice(0, 10))

// the reply block
check("reply: level going 0 -> 1 gives the evolution block", JSON.stringify(evolutionResponse(5, 0, 1)) === JSON.stringify({ character_id: 5, level: 1, img_level: 1 }))
check("reply: no change gives [] (as recorded on global)", JSON.stringify(evolutionResponse(5, 1, 1)) === "[]" && JSON.stringify(evolutionResponse(5, 0, 0)) === "[]")

console.log(failures === 0 ? "\nAll evolution tests passed." : `\n${failures} evolution test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
