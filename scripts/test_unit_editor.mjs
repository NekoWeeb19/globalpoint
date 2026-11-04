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
    check("any effect goes with a trigger CN uses, with no warning", otherEffect !== undefined && rn.errors.length === 0 && rn.warnings.length === 0, rn)

    const noWho = [...whenLine]; noWho[27] = "0"; noWho[48] = "7"
    const rw = UE.checkLine(noWho, cat, true)
    check("'for the unit that triggered it' with a trigger that has no 'who' is refused, in advanced mode too", rw.errors.some(e => e.includes("unit that triggered it")), rw)

    const unusedTrigger = Object.keys(require("../assets/unit_editor/ability_codes.json").whenTrigger).find(k => !cat.used.whenTrigger.includes(k))
    const strong = [...whenLine]; strong[27] = unusedTrigger
    check("a trigger the game never uses: refused by default", UE.checkLine(strong, cat, false).errors.length > 0)
    check("... and allowed in advanced mode with 'Unused trigger ... may not work or crash the game'", UE.checkLine(strong, cat, true).warnings.some(w => w.level === "strong" && w.text.startsWith("Unused trigger")))

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

    // details: text and character columns, as columns (the rest of the row stays)
    const e3 = edit(); e3.details = { ...e3.details, name: "Haruhi (Edited)", title: "New Title", class: "4", role: "Healer" }
    await UE.saveUnit(ID, e3, false)
    const w3 = JSON.parse(fs.readFileSync(file, "utf8"))[ID].rows
    check("details are saved as columns of the text and character rows",
        JSON.stringify(w3[`master/character/character_text.orderedmap#${ID}`]) === JSON.stringify({ cols: { 0: "Haruhi (Edited)", 3: "New Title" } })
        && JSON.stringify(w3[`master/character/character.orderedmap#${ID}`]) === JSON.stringify({ cols: { 6: "4", 26: "Healer" } }), w3)
    const shown = (await UE.getUnit(ID)).details
    check("... and read back", shown.name === "Haruhi (Edited)" && shown.class === "4" && shown.game.class !== "4", shown)
    const badDetails = edit(); badDetails.details = { ...badDetails.details, name: " ", class: "9" }
    check("an empty name or an unknown class is refused", (await UE.checkEdit(badDetails, true)).details.length === 2)

    // kits: export as one file (itself a change file), import back
    const kit = UE.exportKits([ID])
    check("a kit download holds the unit's changes", kit._format === "globalpoint-unit-kits" && kit[ID]?.rows && Object.keys(kit[ID].rows).length === 2, kit)
    UE.resetUnit(ID)
    const back = await UE.importKits(kit)
    check("importing it gives the same changes back", back.imported[0] === ID && JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8"))[ID].rows) === JSON.stringify(kit[ID].rows), back)
    const foreign = await UE.importKits({ [ID]: { rows: { "master/ability/ability.orderedmap#1110691": "x" } }, "999998": { rows: {} } })
    check("a kit with another unit's rows, or for a unit that doesn't exist, is refused", foreign.imported.length === 0 && foreign.refused.length === 2, foreign)
    const broken = { [ID]: { rows: { [`master/ability/ability.orderedmap#${ID}1`]: unit.abilities[0].lines.map(l => { const c = [...l]; c[47] = "99999"; return c.join(",") }).join("\n") } } }
    const rb = await UE.importKits(broken)
    check("a kit with a line the game can't read is refused, and the saved changes stay", rb.imported.length === 0 && JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8"))[ID].rows) === JSON.stringify(kit[ID].rows), rb)
    UE.resetUnit(ID)

    // the game's own wording (scripts/unit_editor_text.cjs), with the game's pieces for one line
    const TX = require("./unit_editor_text.cjs"), CODES = require("../assets/unit_editor/ability_codes.json")
    check("the template engine fills names and if/else like the game's", TX.render("::if once::A::elseif (n >= 2)::B ::n::::else::C::end::", { once: false, n: 3 }) === "B 3")
    const pieces = {
        ability_description_instant_trigger_kind_myself: "when this unit is a/the ::constraint::",
        ability_description_instant_trigger_kind_elapsed_time: "::second:: seconds have passed::if once::::else::::end::",
        ability_description_instant_content_add_combo: "::count:: Combo",
        ability_description_count_up: "::if (0 <= count)::+::count::::else::-::(-count)::::end::",
    }
    const line = Array(126).fill(""); line[1] = "true"; line[5] = "0"; line[6] = "3"; line[11] = "Blue"; line[13] = "0"; line[20] = "0"
    line[27] = "77"; line[30] = "36000000"; line[31] = "6000000"; line[47] = "226"; line[51] = "5000000"; line[52] = "10000000"
    // the text Amelia's unit page showed on the emulator for this line (2026-11-03)
    check("a line in the game's words, as its unit page shows it", TX.lineText(line, "low", pieces, CODES) === "When this unit is a/the ⟨Water⟩ unit → 6 seconds have passed → +50 Combo", TX.lineText(line, "low", pieces, CODES))
    check("... and at the top of its range", TX.lineText(line, "high", pieces, CODES) === "When this unit is a/the ⟨Water⟩ unit → 1 seconds have passed → +100 Combo")
    // lines with the same conditions and trigger are one sentence joined with "&", as the unit page shows them
    const pieces2 = { ...pieces, ability_description_common_content_attack: "::percent_up_down:: to attack for ::target::", ability_description_target_myself: "this unit",
        ability_description_target_leader: "Leader", ability_description_instant_trigger_kind_first_flip: "when a battle starts, ", ability_description_percent_up: "+&nbsp;::percent::&nbsp;%" }
    const atk = Array(126).fill(""); atk[1] = "true"; atk[5] = "0"; atk[6] = "0"; atk[13] = "0"; atk[20] = "0"; atk[27] = "0"; atk[47] = "32"; atk[48] = "0"; atk[51] = "15000"; atk[52] = "30000"
    const atkLeader = [...atk]; atkLeader[48] = "2"
    const grouped = TX.abilityText([atk, atkLeader, line], "low", pieces2, CODES)
    check("same trigger: one sentence joined with '&'; a new trigger: a new paragraph", grouped.length === 2 && grouped[0] === "+ 15 % to attack for this unit & + 15 % to attack for Leader", grouped)

    // a unit-specific buff (another unit's own) is refused
    const foreignBuff = edit(); const fb = [...foreignBuff.abilities[0].lines[0]]; fb[68] = "13"; foreignBuff.abilities[0].lines.push(fb)
    const rf = await UE.checkEdit({ ...foreignBuff, id: ID }, true)
    check("another unit's own buff (unique condition) is refused, in advanced mode too", rf.abilities[0].at(-1).errors.some(e => e.includes("another unit's own buff")), rf.abilities[0].at(-1))

    const unknownPiece = [...line]; unknownPiece[47] = "704"
    check("a line with a part it can't word yet gives null (the page keeps its own sentence)", TX.lineText(unknownPiece, "low", pieces, CODES) === null)
} finally {
    fs.rmSync(dir, { recursive: true, force: true })
}

console.log(failures === 0 ? "unit editor: all passed" : `unit editor: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
