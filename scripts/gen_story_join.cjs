// Builds assets/story_join_character.json (units that join through the story) from the global client's
// master/character/story_join_character table (see scripts/cdn_master.cjs).
//
//   node scripts/gen_story_join.cjs
//
// One row per unit: 0 the kind of stage (0 main story, 1 EX, 2 boss battle, ...), 1-3 the stage's
// numbers, 4 the stage id, 5 priority, 6 how it joins ("town": tapped in Starview Village once the
// stage is cleared; "quest": joins when the stage is cleared), 7 temporary. Layout and stage-id rule
// from the Chinese StarPoint fork (src/lib/story-join-character.ts).

const path = require("path")
const fs = require("fs")
const { ROOT, readTable, parseCsvLine, int } = require("./cdn_master.cjs")

const OUT = path.join(ROOT, "assets", "story_join_character.json")

;(async () => {
    const table = await readTable("master/character/story_join_character.orderedmap", false)
    const units = []
    for (const [characterId, line] of Object.entries(table)) {
        const c = parseCsvLine(line)
        if (c.length !== 8) throw new Error(`story_join_character ${characterId}: expected 8 columns, got ${c.length}.`)
        const kind = int(c[0]), questId = int(c[4])
        if (kind === null || questId === null) throw new Error(`story_join_character ${characterId}: bad stage.`)
        if (c[6] !== "town" && c[6] !== "quest") throw new Error(`story_join_character ${characterId}: unknown join type ${c[6]}.`)
        units.push({ characterId: Number(characterId), stageKind: kind, questId, joinType: c[6], temporary: c[7] === "true" })
    }
    fs.writeFileSync(OUT, JSON.stringify({ units }, null, 2) + "\n")
    console.log(`Wrote ${units.length} story join units to ${path.relative(ROOT, OUT)}: ${units.map(u => `${u.characterId} (${u.joinType}, stage ${u.questId})`).join(", ")}`)
})().catch(e => { console.error(e); process.exit(1) })
