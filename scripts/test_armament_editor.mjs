// Tests the armament editor (scripts/armament_editor.cjs, docs/UNIT_EDITOR.md "Armaments") without the game files:
// two made-up armaments whose effects are lines of the example unit docs/examples/custom_units/111907.json. Reading,
// the armament rules (versions by level, at most 10 effects and 3 versions, level-1 armaments can't scale), the
// wording by armament level, saving as a change file, kits and reset.
//
//   node scripts/test_armament_editor.mjs
import { createRequire } from "module"
import fs from "fs"
import os from "os"
import path from "path"

const require = createRequire(import.meta.url)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "armament-editor-"))
process.env.CUSTOM_UNITS_DIR = dir
const UE = require("./unit_editor.cjs")
const AE = require("./armament_editor.cjs")
const CU = require("./custom_units.cjs")
const { uploadPath } = require("./cdn_hash.cjs")
const { abilityToSoul } = UE._internal

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

const example = JSON.parse(fs.readFileSync(new URL("../docs/examples/custom_units/111907.json", import.meta.url), "utf8"))
const flat = (rows, prefix = "") => Object.entries(rows ?? {}).flatMap(([k, v]) => typeof v === "string" ? [[prefix + k, v.replace(/\n$/, "")]] : flat(v, prefix + k + "/"))
const table = logical => Object.fromEntries(flat(example.rows[uploadPath(logical).replace(/^production\//, "")]))
const unitBase = {
    ability: table("master/ability/ability.orderedmap"), leader: table("master/ability/leader_ability.orderedmap"),
    status: table("master/character/character_status.orderedmap"), skill: table("master/skill/action_skill.orderedmap"),
    character: table("master/character/character.orderedmap"), text: table("master/character/character_text.orderedmap"),
}
const UNIT = "111907", ARM = "9990001", ARM1 = "9990002"
UE._setBase({ ...unitBase, soul: {} })
const unit = await UE.getUnit(UNIT)
// the unit's own "when" lines without its unique buffs, as armament lines (slot, learn level, ...)
const plain = unit.abilities.flatMap(a => a.lines).filter(c => c[5] === "0" && UE._internal.uniqueIds(c).length === 0)
const soulLine = (c, slot, learn) => { const s = abilityToSoul(c); s[0] = String(slot); s[1] = String(learn); return s.join(",") }
const CODES = require("../assets/unit_editor/ability_codes.json")
// a line with every min = max (what a level-1 armament needs)
const flatLine = c => {
    const out = [...c]
    for (const [part, at] of [["condition", 6], ["condition", 13], ["condition", 20], ["whenTrigger", 27], ["whenEffect", 47], ["whileTrigger", 97], ["whileEffect", 109]])
        for (const d of Object.values(CODES[part]?.[out[at]]?.fields ?? {})) if (d.pair) out[d.cols[1]] = out[d.cols[0]]
    return out
}
const equipment = (name, maxLevel) => Object.assign(Array(16).fill("0"), { 0: "x", 1: name, 7: name + " description", 8: String(maxLevel) }).join(",")
const soul = {
    // effect 1: one version; effect 2: a version from level 1 and one from level 5
    [ARM]: [soulLine(plain[0], 0, 1), soulLine(plain[1], 1, 1), soulLine(plain[2] ?? plain[1], 1, 5)].join("\n"),
    [ARM1]: soulLine(flatLine(plain[0]), 0, 1),
}
const armBase = {
    equipment: { [ARM]: equipment("Test Blade", 5), [ARM1]: equipment("Test Charm", 1) },
    status: { [`${ARM}/1`]: "100,50", [`${ARM}/5`]: "150,75", [`${ARM1}/1`]: "80,40" },
    soul,
}
UE._setBase({ ...unitBase, soul })
AE._setBase(armBase)

try {
    // reading
    const arm = await AE.getArmament(ARM)
    check("the armament is read: 2 effects (the second with 2 versions), 2 stat levels, max level 5",
        arm && arm.abilities.length === 2 && arm.abilities[1].lines.length === 2 && arm.stats.length === 2 && arm.maxLevel === 5, arm && [arm.abilities.map(a => a.lines.length), arm.stats.length, arm.maxLevel])
    check("a version's armament level is in column 2 (and converts back to the soul row)",
        arm.abilities[1].lines.map(c => c[2]).join() === "1,5" && abilityToSoul(arm.abilities[1].lines[1])[1] === "5")
    check("the list has both armaments", (await AE.listArmaments()).map(a => a.id).sort().join() === [ARM, ARM1].join())
    const edit = () => JSON.parse(JSON.stringify(arm))

    // checks
    const own = await AE.checkArmament(ARM, arm, false)
    check("the armament's own lines pass the default checks", own.ok, own)
    check("... and its wording is by armament level: level 1 uses only the level-1 versions", own.texts?.armament === true && Array.isArray(own.texts.abilities[0].low), own.texts)

    const same = edit(); same.abilities[1].lines[1][2] = "1"
    check("two versions from the same armament level are refused", (await AE.checkArmament(ARM, same, true)).tooMany.some(t => t.includes("same armament level")))
    const high = edit(); high.abilities[0].lines[0][2] = "6"
    check("a version from a level the armament doesn't have is refused", (await AE.checkArmament(ARM, high, true)).abilities[0][0].errors.some(e => e.includes("1 to 5")))
    const versions = edit(); for (const lv of ["2", "3"]) { const c = [...versions.abilities[1].lines[0]]; c[2] = lv; versions.abilities[1].lines.push(c) }
    check("more than 3 versions in an effect is refused", (await AE.checkArmament(ARM, versions, true)).tooMany.some(t => t.includes("the most is 3")))
    const effects = edit(); while (effects.abilities.length < 11) effects.abilities.push(JSON.parse(JSON.stringify(effects.abilities[0])))
    check("more than 10 effects is refused", (await AE.checkArmament(ARM, effects, true)).tooMany.some(t => t.includes("the most is 10")))
    effects.abilities.pop()
    check("... and 10 is fine", (await AE.checkArmament(ARM, effects, false)).tooMany.length === 0)

    // a level-1 armament can't scale: every min must equal its max
    const one = await AE.getArmament(ARM1)
    check("a level-1 armament's own (equal) values pass", (await AE.checkArmament(ARM1, one, false)).ok)
    // the effect's value pair (the field the effect code reads) made unequal

    const differ = JSON.parse(JSON.stringify(one)), dc = differ.abilities[0].lines[0]
    const pair = Object.values(CODES.whenEffect[dc[47]]?.fields ?? {}).find(d => d.pair)
    dc[pair.cols[0]] = "10000"; dc[pair.cols[1]] = "20000"
    const rd = await AE.checkArmament(ARM1, differ, true)
    check("a level-1 armament with a min different from its max is refused (the game stops on it)", rd.abilities[0][0].errors.some(e => e.includes("only level 1")), rd.abilities[0][0])
    check("... the same line is fine on a level-5 armament", (await AE.checkArmament(ARM, { ...arm, abilities: [{ ...arm.abilities[0], lines: [dc] }] }, true)).abilities[0][0].errors.length === 0)

    // saving
    const e1 = edit()
    e1.stats[1].hp = 999
    e1.details = { ...e1.details, name: "Test Blade+", description: "Sharper." }
    e1.abilities.reverse()
    const saved = await AE.saveArmament(ARM, e1, false)
    const file = path.join(dir, "changes", `armament-editor-${ARM}.json`)
    const written = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8"))[ARM].rows : null
    check("save writes the 3 changed rows: abilities, the level-5 stats, name and description", saved.rows === 3 && written && Object.keys(written).length === 3, { saved, written })
    check("... stats as 'hp,atk', the text as columns", written?.[`master/item/equipment_status.orderedmap#${ARM}/5`] === "999,75"
        && JSON.stringify(written?.[`master/item/equipment.orderedmap#${ARM}`]) === JSON.stringify({ cols: { 1: "Test Blade+", 7: "Sharper." } }), written)
    const soulRows = written?.[`master/ability/ability_soul.orderedmap#${ARM}`]?.split("\n").map(l => l.split(","))
    check("... the abilities as the whole soul row, effects renumbered from 0", soulRows && soulRows.map(c => c[0] + "@" + c[1]).join() === "0@1,0@5,1@1" && soulRows.every(c => c.length === 123), soulRows?.map(c => [c[0], c[1], c.length]))
    const changes = CU.readUnitChanges(dir)
    check("the schedule build's change reader takes the file", changes.problems.length === 0 && changes.rows.get(uploadPath("master/ability/ability_soul.orderedmap"))?.has(ARM), changes.problems)
    const again = await AE.getArmament(ARM)
    check("the armament then shows the saved values", again.saved && again.name === "Test Blade+" && again.stats[1].hp === 999 && again.stats[1].game.hp === 150 && again.abilities[0].lines.length === 2)

    const bad = edit(); bad.abilities[0].lines[0][47] = "99999"
    const refused = await AE.saveArmament(ARM, bad, false)
    check("a line the game can't read is refused, and the saved file stays", refused.errors && JSON.parse(fs.readFileSync(file, "utf8"))[ARM].rows[`master/item/equipment_status.orderedmap#${ARM}/5`] === "999,75")

    // kits
    const kit = AE.exportArmamentKits([ARM])
    check("a kit download holds the armament's changes", kit._format === "globalpoint-armament-kits" && Object.keys(kit[ARM]?.rows ?? {}).length === 3, kit)
    check("reset removes the editor's changes", AE.resetArmament(ARM) === true && !fs.existsSync(file) && AE.resetArmament(ARM) === false)
    const back = await AE.importArmamentKits(kit)
    check("importing the kit gives the same changes back", back.imported[0] === ARM && JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8"))[ARM].rows) === JSON.stringify(kit[ARM].rows), back)
    const foreign = await AE.importArmamentKits({ [ARM]: { rows: { [`master/ability/ability_soul.orderedmap#${ARM1}`]: "x" } }, "9999999": { rows: {} } })
    check("a kit with another armament's rows, or for an armament that doesn't exist, is refused", foreign.imported.length === 0 && foreign.refused.length === 2, foreign)
    const broken = { [ARM]: { rows: { [`master/ability/ability_soul.orderedmap#${ARM}`]: soul[ARM].split("\n").map(l => { const c = l.split(","); c[44] = "99999"; return c.join(",") }).join("\n") } } }
    const rb = await AE.importArmamentKits(broken)
    check("a kit with a line the game can't read is refused, and the saved changes stay", rb.imported.length === 0 && JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8"))[ARM].rows) === JSON.stringify(kit[ARM].rows), rb)

    await AE.saveArmament(ARM, edit(), false)
    check("saving the game's own values removes the change file", !fs.existsSync(file))
} finally {
    fs.rmSync(dir, { recursive: true, force: true })
}

console.log(failures === 0 ? "armament editor: all passed" : `armament editor: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
