// The skill editor (dashboard /unit-editor, Skill tab): reads a unit's skill scripts as blocks of commands.
// What each command and parameter is: assets/skill_editor/commands.json (scripts/research/skill_commands_from_pcode.cjs,
// docs/research/skill-commands.md). How scripts are stored: AMF3, raw deflate, <path>.action.dsl.amf3.deflate.
const zlib = require("zlib")
const path = require("path")
const { readAmf3 } = require("./amf3.cjs")

const COMMANDS = require(path.join(__dirname, "..", "assets", "skill_editor", "commands.json"))

// the subjects every script has (ActionEvaluationResolver); commands bind more inside their blocks
const SUBJECTS = { "-17": "the unit", "-18": "the unit's ball", "-33": "the party", "-1": "battlefield centre", "-2": "battlefield top-left" }

/** A skill script's path as the skill row has it (column 7): only the game's skill scripts are read. */
const isScriptPath = p => typeof p === "string" && /^battle\/action\/skill\/[\w$\/.-]+$/.test(p) && !p.includes("..")

/** A skill script as JSON (["ActionDsl", 1, ..., ["Block", [...]]]), or null when the game has no such file. */
async function readScript(logical) {
    if (!isScriptPath(logical)) throw new Error(`not a skill script path: ${logical}`)
    const buf = await require("./cn_read.cjs").readCn(logical + ".action.dsl.amf3.deflate")
    if (!buf) return null
    let raw
    try { raw = zlib.inflateRawSync(buf) } catch { raw = zlib.inflateSync(buf) }
    return readAmf3(raw)
}

/** What the page needs: commands and events (Wait, Repeat...) with labels, parameter kinds, the values CN uses; the fixed subjects. */
function skillData() {
    return { commands: COMMANDS.commands, events: COMMANDS.events, scripts: COMMANDS.scripts, subjects: SUBJECTS }
}

module.exports = { readScript, skillData, isScriptPath, SUBJECTS }
