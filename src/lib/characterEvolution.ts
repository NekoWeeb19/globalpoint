// Character awakening (evolution level 1, the awakened illustration), worked out from the Mana Board.
//
// The rule (from the Chinese StarPoint fork's src/lib/character-evolution.ts, read from the client):
// a character awakens once, on Mana Board 1, every ability slot has at least one node learned (the
// three "statues", one per ability) and the skill evolution node is learned too. Learning other
// nodes, or only some of those, doesn't awaken it.
//
// Node fields (assets/mana_node.json, the same as the fork's): field1 "1" is a character episode node;
// otherwise field5 says what the node does: "0" an ability (field6 is its slot, 1-3 on Board 1),
// "1" a skill level, "2" the skill evolution.

export interface ManaNodeFields {
    field1: string
    field5: string
    field6: string
}

/**
 * The evolution level a character's learned Board 1 nodes give: 1 when awakened, else 0.
 *
 * @param boardOneNodes The character's Mana Board 1 nodes (node id -> fields).
 * @param learnedNodeIds Every node the character has learned (any board).
 */
export function evolutionLevelFromManaNodes(
    boardOneNodes: Readonly<Record<string, ManaNodeFields>>,
    learnedNodeIds: ReadonlySet<number>
): number {
    const abilitySlots = new Map<string, number[]>()
    const skillEvolutionNodes: number[] = []
    for (const [id, node] of Object.entries(boardOneNodes)) {
        if (node.field1 === "1") continue // an episode node
        if (node.field5 === "0" && node.field6 !== "") {
            const slot = abilitySlots.get(node.field6) ?? []
            slot.push(Number(id))
            abilitySlots.set(node.field6, slot)
        } else if (node.field5 === "2") {
            skillEvolutionNodes.push(Number(id))
        }
    }
    // a board with nothing to unlock never awakens anything
    if (abilitySlots.size === 0 && skillEvolutionNodes.length === 0) return 0

    const everyAbilitySlot = [...abilitySlots.values()].every(slot => slot.some(id => learnedNodeIds.has(id)))
    const skillEvolution = skillEvolutionNodes.length === 0 || skillEvolutionNodes.some(id => learnedNodeIds.has(id))
    return everyAbilitySlot && skillEvolution ? 1 : 0
}

/** The reply's "evolution" block: the new level when it went up, else an empty list (as recorded). */
export function evolutionResponse(characterId: number, previousLevel: number, level: number): Object {
    return level > previousLevel ? { "character_id": characterId, "level": level, "img_level": level } : []
}
