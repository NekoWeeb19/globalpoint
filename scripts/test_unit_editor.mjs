// Tests the unit editor (scripts/unit_editor.cjs, docs/UNIT_EDITOR.md) without the game files: the example unit
// docs/examples/custom_units/111907.json stands in for the game's tables. Reading a unit, the checks (guard rails,
// contradictions, unknown codes), saving only what differs as a change file the schedule build reads, and reset.
//
//   node scripts/test_unit_editor.mjs
import { createRequire } from "module"
import fs from "fs"
import os from "os"
import path from "path"

const require = createRequire(import.meta.url)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unit-editor-"))
process.env.CUSTOM_UNITS_DIR = dir
const UE = require("./unit_editor.cjs")
const CU = require("./custom_units.cjs")
const { uploadPath } = require("./cdn_hash.cjs")

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

// the example unit's rows as the "game's" tables (keyed like the game's: "<key>/<sub key>")
const example = JSON.parse(fs.readFileSync(new URL("../docs/examples/custom_units/111907.json", import.meta.url), "utf8"))
const flat = (rows, prefix = "") => Object.entries(rows ?? {}).flatMap(([k, v]) => typeof v === "string" ? [[prefix + k, v.replace(/\n$/, "")]] : flat(v, prefix + k + "/"))
const table = logical => Object.fromEntries(flat(example.rows[uploadPath(logical).replace(/^production\//, "")]))
UE._setBase({
    ability: table("master/ability/ability.orderedmap"), leader: table("master/ability/leader_ability.orderedmap"),
    status: table("master/character/character_status.orderedmap"), skill: table("master/skill/action_skill.orderedmap"),
    character: table("master/character/character.orderedmap"), text: table("master/character/character_text.orderedmap"),
})
const ID = "111907"

try {
    // reading
    const unit = await UE.getUnit(ID)
    check("the unit is read: 6 abilities, a leader skill, 4 stat levels, skill and skill+", unit && unit.abilities.length === 6 && unit.leader !== null && unit.stats.length === 4 && unit.skills.length === 2, unit && [unit.abilities.length, unit.stats.length, unit.skills.length])
    check("leader lines use the ability layout (and convert back)", JSON.stringify(UE.abilityToLeader(UE.leaderToAbility(["a", "0", "1"]))) === JSON.stringify(["a", "0", "1"]))
    const edit = () => JSON.parse(JSON.stringify(unit))

    // checks
    const ok = await UE.checkEdit(unit, false)
    check("the game's own lines pass the default checks", ok.ok, ok)
    const cat = await UE.catalog()
    const whenLine = unit.abilities.flatMap(a => a.lines).find(c => c[5] === "0")
    const whileLine = unit.abilities.flatMap(a => a.lines).find(c => c[5] === "1")

    const contra = [...whileLine]; contra[97] = "4"; contra[6] = "186"
    const rc = UE.checkLine(contra, cat, true)
    check("'not in Fever' + 'while in Fever' is refused, in advanced mode too", rc.errors.some(e => e.includes("can't both be true")), rc)

    const unknown = [...whenLine]; unknown[47] = "99999"
    check("an effect code the game doesn't know is refused", UE.checkLine(unknown, cat, true).errors.some(e => e.includes("isn't one the game knows")))

    const otherEffect = cat.used.whenEffect.find(e => !cat.pairs.trigEffect.includes(`0|${whenLine[27]}|${e}`))
    const notice = [...whenLine]; notice[47] = otherEffect
    const rn = UE.checkLine(notice, cat, false)
    check("an effect never paired with the trigger: allowed with the 'not seen before' notice", otherEffect !== undefined && rn.errors.length === 0 && rn.warnings.some(w => w.level === "notice"), rn)

    const unusedTrigger = Object.keys(require("../assets/unit_editor/ability_codes.json").whenTrigger).find(k => !cat.used.whenTrigger.includes(k))
    const strong = [...whenLine]; strong[27] = unusedTrigger
    check("a trigger the game never uses: refused by default", UE.checkLine(strong, cat, false).errors.length > 0)
    check("... and allowed in advanced mode with the strong warning", UE.checkLine(strong, cat, true).warnings.some(w => w.level === "strong"))

    const pair = [...whenLine]; pair[13] = "12"
    const rp = UE.checkLine(pair, cat, false)
    check("a condition never used with this trigger: refused by default", rp.errors.some(e => e.includes("together")) || !cat.used.condition.includes("12"), rp)

    // saving
    const e1 = edit()
    e1.stats.find(s => s.level === "80").hp = 3000
    e1.abilities[0].lines[0][52] = String(Number(e1.abilities[0].lines[0][52]) * 2)
    const saved = await UE.saveUnit(ID, e1, false)
    const file = path.join(dir, "changes", `unit-editor-${ID}.json`)
    const written = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8"))[ID] : null
    check("save writes only the 2 changed rows", saved.rows === 2 && written && Object.keys(written.rows).length === 2, { saved, written })
    check("... stats as the row, the ability as its whole row", written && written.rows[`master/character/character_status.orderedmap#${ID}/80`] === `3000,${unit.stats.find(s => s.level === "80").atk}`
        && written.rows[`master/ability/ability.orderedmap#${ID}1`].split("\n").length === unit.abilities[0].lines.length, written?.rows)
    const changes = CU.readUnitChanges(dir)
    check("the schedule build's change reader takes the file", changes.problems.length === 0 && changes.rows.get(uploadPath("master/ability/ability.orderedmap"))?.has(`${ID}1`), changes.problems)
    const again = await UE.getUnit(ID)
    check("the unit then shows the saved values", again.saved && again.stats.find(s => s.level === "80").hp === 3000 && again.stats.find(s => s.level === "80").game.hp !== 3000)

    const e2 = edit(); e2.skills[1].gaugeMax = 500
    await UE.saveUnit(ID, e2, false)
    const w2 = JSON.parse(fs.readFileSync(file, "utf8"))[ID].rows
    check("a skill gauge change is saved as columns (the skill's text stays)", JSON.stringify(Object.values(w2)) === JSON.stringify([{ cols: { 5: "500" } }]), w2)

    const bad = edit(); bad.abilities[0].lines[0][47] = "99999"
    const refused = await UE.saveUnit(ID, bad, false)
    check("a line that can't be saved is refused, and nothing is written", refused.errors && JSON.parse(fs.readFileSync(file, "utf8"))[ID].rows[`master/skill/action_skill.orderedmap#gp_test_haruhi/2`] !== undefined)

    await UE.saveUnit(ID, edit(), false)
    check("saving the game's own values removes the change file", !fs.existsSync(file))

    await UE.saveUnit(ID, e1, false)
    check("reset removes the editor's changes", UE.resetUnit(ID) === true && !fs.existsSync(file) && UE.resetUnit(ID) === false)
} finally {
    fs.rmSync(dir, { recursive: true, force: true })
}

console.log(failures === 0 ? "unit editor: all passed" : `unit editor: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
