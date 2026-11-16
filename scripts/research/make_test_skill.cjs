// RESEARCH (docs/research/skill-effects.md, "Tested: a skill script of our own"): builds a test skill script from
// Clara's (junior_yearngirl_1): her HP branch removed, her self attack-up kept, the party Power Flip buff removed, and
// the round whirlwind-slash attack area moved <y> below the unit. Not a GlobalPoint feature; for experiments only.
//
//   node scripts/research/make_test_skill.cjs <out file> [y offset, default 500]
//     out file: e.g. gp_test_harpy_2.action.dsl.amf3.deflate (raw deflate + AMF3, like the game's own scripts)
//
// Ship it in a CN update at a new path (scripts/build_cn_patch.cjs with CDN_DIR pointing at a scratch copy), then
// point a unit's skill rows (master/skill/action_skill column 7) at that path with a change file.
const zlib = require("zlib")
const fs = require("fs")
const { readCn } = require("../cn_read.cjs")
const { readAmf3, writeAmf3 } = require("../amf3.cjs")

;(async () => {
    const out = process.argv[2]
    const y = Number(process.argv[3] ?? 500)
    if (!out || !Number.isFinite(y)) throw new Error("usage: make_test_skill.cjs <out file> [y offset]")
    const src = await readCn("battle/action/skill/action/rare3/junior_yearngirl$junior_yearngirl_1.action.dsl.amf3.deflate")
    if (!src) throw new Error("Clara's skill script isn't in the CN files (CN_CDN_DIR)")
    const dsl = readAmf3(zlib.inflateRawSync(src))
    // ["ActionDsl", ..., ["Block", [ ["Command", ["ConditionalsHealthPointRatio", 60, highBlock, lowBlock]] ]]]
    const root = dsl[dsl.length - 1]
    const branch = root[1][0][1]
    if (branch[0] !== "ConditionalsHealthPointRatio") throw new Error("not the expected script: " + branch[0])
    const high = branch[2][1] // the "60% HP or more" commands
    const selfAtk = high.find(c => c[1][0] === "CreateCondition")
    const area = JSON.parse(JSON.stringify(high.find(c => c[1][0] === "CreateHitArea")))
    // CreateHitArea: [name, label, attached to, coordinate system, offset x, offset y, rotation, follow pos, follow dir, shape, ...]
    if (area[1][2] !== -18 || area[1][3][0] !== "AB") throw new Error("unexpected attack area layout")
    area[1][5] = y
    root[1] = [selfAtk, area]
    const raw = writeAmf3(dsl)
    if (JSON.stringify(readAmf3(raw)) !== JSON.stringify(dsl)) throw new Error("round trip differs")
    fs.writeFileSync(out, zlib.deflateRawSync(raw, { level: 9 }))
    console.log(`${out}: ${root[1].map(c => c[1][0]).join(", ")}; attack area ${y} below the unit`)
})().catch(e => { console.error(e); process.exit(1) })
