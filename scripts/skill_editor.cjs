// The skill editor (dashboard /unit-editor, Skill tab): a unit's skill scripts as blocks of commands; checks and saves.
// What each command and parameter is: assets/skill_editor/commands.json (scripts/research/skill_commands_from_pcode.cjs,
// docs/research/skill-commands.md). How scripts are stored: AMF3, raw deflate, <path>.action.dsl.amf3.deflate.
// An edited script is saved as a new file under the custom units folder (skills/<path>...), a new name per content,
// and the skill row's column 7 points at it; the CN update ships it like the game's own files.
const zlib = require("zlib")
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { readAmf3, writeAmf3 } = require("./amf3.cjs")
const CU = require("./custom_units.cjs")

const COMMANDS = require(path.join(__dirname, "..", "assets", "skill_editor", "commands.json"))
const EFFECTS = new Set(COMMANDS.effects.map(e => e.how + "|" + e.path))

// the subjects every script has (ActionEvaluationResolver); commands bind more inside their blocks
const SUBJECTS = { "-17": "the unit", "-18": "the unit's ball", "-33": "the party", "-1": "battlefield centre", "-2": "battlefield top-left" }
const SUFFIX = ".action.dsl.amf3.deflate"
const CUSTOM_PREFIX = "battle/action/skill/action/custom/"

// how big a script may get, by mode (a borrowed script bigger than this may stay as big as it was)
const LIMITS = {
    default: { commands: 60, areas: 8, depth: 10 },
    advanced: { commands: 200, areas: 20, depth: 16 },
    unrestricted: { commands: 1000, areas: 100, depth: 40 },
}

/** A skill script's path as the skill row has it (column 7): only skill scripts are read. */
const isScriptPath = p => typeof p === "string" && /^battle\/action\/skill\/[\w$\/.-]+$/.test(p) && !p.includes("..")
const customFile = logical => path.join(CU.customUnitsDir(), "skills", logical + SUFFIX)

/** A skill script as JSON (["ActionDsl", 1, ..., ["Block", [...]]]), or null when there is no such file. */
async function readScript(logical) {
    if (!isScriptPath(logical)) throw new Error(`not a skill script path: ${logical}`)
    const own = customFile(logical)
    const buf = fs.existsSync(own) ? fs.readFileSync(own) : await require("./cn_read.cjs").readCn(logical + SUFFIX)
    if (!buf) return null
    let raw
    try { raw = zlib.inflateRawSync(buf) } catch { raw = zlib.inflateSync(buf) }
    return readAmf3(raw)
}

/** What the page needs: commands and events (Wait, Repeat...) with labels, parameter kinds, the values CN uses; effects; subjects; limits. */
function skillData() {
    return { commands: COMMANDS.commands, events: COMMANDS.events, effects: COMMANDS.effects, effectSizes: COMMANDS.effectSizes, scripts: COMMANDS.scripts, subjects: SUBJECTS, limits: LIMITS }
}

// ---- checking -----------------------------------------------------------------------------------------------

const isEnum = v => Array.isArray(v) && typeof v[0] === "string" && /^[A-Z]/.test(v[0]) && v[0] !== "Block"
const isRange = v => Array.isArray(v) && v.length > 0 && v.every(x => x && typeof x === "object" && !Array.isArray(x) && "min" in x)
const isBlock = v => Array.isArray(v) && v[0] === "Block" && Array.isArray(v[1])
const isItem = v => Array.isArray(v) && (v[0] === "Command" || v[0] === "Event") && Array.isArray(v[1])
// a block slot may hold a block or a single command
const isExpr = v => isBlock(v) || isItem(v)
const asBlock = v => isBlock(v) ? v : ["Block", [v]]
// settings that may be ids (of an area, group, point...): named ids, and whole numbers whose meaning isn't known
const mayBeId = (meta, v) => Number.isInteger(v) && (meta.kind === "binds" || (meta.kind !== "subject" && (!meta.label || meta.label.startsWith("(inferred)"))))
const shapeOf = v => v === null || v === undefined ? "none" : typeof v === "boolean" ? "bool" : typeof v === "number" ? "number"
    : typeof v === "string" ? "string" : Array.isArray(v) ? (v[0] === "Block" ? "block" : isEnum(v) ? "enum" : isRange(v) ? "range" : "list") : "object"
const fin = n => typeof n === "number" && Number.isFinite(n)

/** Size of a script: commands (and events), attack areas, effects, how deep blocks go. */
function scriptStats(program) {
    const st = { commands: 0, areas: 0, effects: 0, depth: 0 }
    const root = Array.isArray(program) ? program[11] : null
    if (!isBlock(root)) return st
    ;(function walk(block, d) {
        st.depth = Math.max(st.depth, d)
        for (const it of block[1]) {
            if (isBlock(it)) { walk(it, d); continue }
            if (!Array.isArray(it) || !Array.isArray(it[1])) continue
            st.commands++
            if (it[1][0] === "CreateHitArea") st.areas++
            if (it[1][0] === "ShowEffect") st.effects++
            for (const p of it[1].slice(1)) if (isExpr(p)) walk(asBlock(p), d + 1)
        }
    })(root, 1)
    return st
}

/**
 * Problems with a script. errors: it can't be saved (the game can't read it, or Default/Advanced doesn't allow it).
 * warnings: things CN's skills never do (Unrestricted lets them through). original: the script it was opened from,
 * so a borrowed big script may stay as big as it was.
 */
function checkScript(program, mode = "default", original = null) {
    const errors = [], warnings = []
    const free = mode === "unrestricted"
    const flag = (where, text) => (free ? warnings : errors).push(`${where}: ${text}${free ? " (untested)" : ""}`)
    if (!Array.isArray(program) || program[0] !== "ActionDsl" || program.length !== 12 || !isBlock(program[11]))
        return { errors: ["not a skill script (ActionDsl with 11 settings and a command block)"], warnings, stats: scriptStats(null) }
    // the script's own settings: kept as the game has them
    if (!Number.isInteger(program[1]) || !isEnum(program[2]) || !program.slice(3, 10).every(b => typeof b === "boolean") || !Number.isInteger(program[10]))
        errors.push("the script's settings (before the first block) aren't as the game writes them")

    const value = (where, label, meta, v, scope) => {
        const sh = shapeOf(v)
        const type = meta.type
        if (type === "int" && !Number.isInteger(v)) return errors.push(`${where}: ${label} must be a whole number`)
        if (type === "Number" && !fin(v)) return errors.push(`${where}: ${label} must be a number`)
        if (type === "Boolean" && typeof v !== "boolean") return errors.push(`${where}: ${label} must be yes or no`)
        if (type === "String" && typeof v !== "string") return errors.push(`${where}: ${label} must be text`)
        if (type === "String" && /[\u0000-\u001f]/.test(v)) return errors.push(`${where}: ${label} can't have line breaks`)
        // (an empty block slot is null where CN's scripts leave it empty)
        if (type === "ActionDslExpression" && !isExpr(v) && !(v === null && meta.shapes?.includes("none"))) return errors.push(`${where}: ${label} must be a block`)
        if (type === "Array" && !Array.isArray(v)) return errors.push(`${where}: ${label} must be a list`)
        if (meta.shapes?.length && !meta.shapes.includes(sh)) flag(where, `${label} is ${sh === "none" ? "empty" : "a " + sh}, which CN's skills never have here`)
        if (sh === "range" && !v.every(x => fin(x.min) && fin(x.max))) errors.push(`${where}: ${label}: each value needs a lowest and highest number`)
        if (meta.kind === "subject" && Number.isInteger(v) && !(String(v) in SUBJECTS) && !scope.has(v))
            errors.push(`${where}: ${label} is #${v}, which nothing above has named (an area, a group, a point...)`)
        const opts = Object.keys(meta.options ?? {})
        const choices = sh === "enum" ? [v] : sh === "list" ? v.filter(isEnum) : []
        for (const e of choices) {
            if (opts.length && !opts.includes(e[0])) flag(where, `${label} "${e[0]}" isn't one CN's skills use`)
            effect(where, e)
        }
        if (sh === "enum" || sh === "list") nestedChecks(where, label, v)
    }
    // inside choices: numbers are numbers, ranges complete, effects known
    const nestedChecks = (where, label, v) => {
        if (Array.isArray(v)) for (const x of v) {
            if (isRange(x) && !x.every(r => fin(r.min) && fin(r.max))) errors.push(`${where}: ${label}: each value needs a lowest and highest number`)
            else if (typeof x === "number" && !fin(x)) errors.push(`${where}: ${label}: not a number`)
            else if (isEnum(x)) { effect(where, x); nestedChecks(where, label, x) }
            else if (Array.isArray(x)) nestedChecks(where, label, x)
        }
    }
    const effect = (where, e) => {
        if ((e[0] === "ResolveByElement" || e[0] === "SpecifyEffectDirectly") && typeof e[1] === "string") {
            if (!/^battle\/effect\/[\w\/.-]+$/.test(e[1]) || e[1].includes("..")) errors.push(`${where}: "${e[1]}" isn't an effect path`)
            else if (!EFFECTS.has(e[0] + "|" + e[1])) flag(where, `the effect ${e[1]} isn't one CN's skills show this way`)
        }
    }
    // scope: ids named by enclosing commands and by earlier commands in the same block
    const walk = (block, outer, where) => {
        const scope = new Set(outer)
        for (const [n, it] of block[1].entries()) {
            if (isBlock(it)) { walk(it, scope, where); continue }
            if (!Array.isArray(it) || (it[0] !== "Command" && it[0] !== "Event") || !Array.isArray(it[1]) || typeof it[1][0] !== "string") {
                errors.push(`${where || "Script"}: item ${n + 1} isn't a command`); continue
            }
            const [name, ...ps] = it[1]
            const info = (it[0] === "Event" ? COMMANDS.events : COMMANDS.commands)[name]
            const here = `${where ? where + " › " : ""}${info?.label ?? name}`
            if (!info) { errors.push(`${here}: the game has no ${it[0].toLowerCase()} "${name}"`); continue }
            if (ps.length !== info.params.length) { errors.push(`${here}: has ${ps.length} settings, the game reads ${info.params.length}`); continue }
            if (!info.skills) flag(here, "CN's skills never use this")
            const named = ps.filter((p, i) => mayBeId(info.params[i], p))
            const inner = new Set([...scope, ...named])
            ps.forEach((p, i) => {
                const meta = info.params[i], label = meta.label || `setting ${i + 1}`
                if (meta.type === "ActionDslExpression" && isExpr(p)) walk(asBlock(p), inner, `${here} › ${label}`)
                else value(here, label, meta, p, meta.kind === "binds" ? new Set() : scope)
            })
            for (const id of named) scope.add(id)
        }
    }
    walk(program[11], new Set(), "")

    const stats = scriptStats(program), was = original ? scriptStats(original) : { commands: 0, areas: 0, depth: 0 }
    const lim = LIMITS[mode] ?? LIMITS.default
    const over = (k, what) => { if (stats[k] > Math.max(lim[k], was[k])) errors.push(`${stats[k]} ${what}; the most in ${mode in LIMITS ? mode : "default"} mode is ${lim[k]}${was[k] > lim[k] ? ` (or ${was[k]}, as the script you started from)` : ""}`) }
    over("commands", "commands"); over("areas", "attack areas"); over("depth", "levels of blocks")
    return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], stats }
}

// ---- saving -------------------------------------------------------------------------------------------------

/** Writes an edited script under the custom units folder; returns its path (as the skill row's column 7 has it). */
function writeScript(unitId, plus, program) {
    const raw = writeAmf3(program)
    const hash = crypto.createHash("sha1").update(raw).digest("hex").slice(0, 10)
    const logical = `${CUSTOM_PREFIX}${unitId}_${plus ? 2 : 1}_${hash}`
    const file = customFile(logical)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, zlib.deflateRawSync(raw))
    return logical
}

/** Removes a unit's edited scripts that its skill rows no longer point at (keep: the paths still used). */
function pruneScripts(unitId, keep) {
    for (const [logical, file] of customScripts()) {
        if (!logical.startsWith(`${CUSTOM_PREFIX}${unitId}_`) || keep.includes(logical)) continue
        try { fs.unlinkSync(file) } catch { }
    }
}

// ---- kits: a unit's edited scripts travel inside its kit file (base64 of the stored file) ----

const SCRIPT_RE = /battle\/action\/skill\/action\/custom\/[\w$.-]+/g
/** The edited-script paths some rows point at (any text: row values, a change file). */
const scriptsIn = text => [...new Set(String(text).match(SCRIPT_RE) ?? [])]

/** The stored file of an edited script as base64, or null when this PC doesn't have it. */
function exportScript(logical) {
    const file = customFile(logical)
    return isScriptPath(logical) && fs.existsSync(file) ? fs.readFileSync(file).toString("base64") : null
}

/**
 * Writes an edited script from a kit file, after checking it: the unit's own path, a script the game can read,
 * no errors in Unrestricted mode (the person who made it chose the mode). Returns null, or why it was refused.
 */
function importScript(unitId, logical, base64) {
    if (!isScriptPath(logical) || !logical.startsWith(`${CUSTOM_PREFIX}${unitId}_`)) return `${logical} isn't one of this unit's skill scripts`
    let buf, program
    try {
        buf = Buffer.from(String(base64), "base64")
        program = readAmf3(zlib.inflateRawSync(buf))
    } catch { return `${logical} can't be read` }
    const check = checkScript(program, "unrestricted", null)
    if (check.errors.length) return `${logical}: ${check.errors[0]}`
    const file = customFile(logical)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, buf)
    return null
}

/** Every edited script file (logical path -> file), for the CN update. */
function customScripts() {
    const dir = path.join(CU.customUnitsDir(), "skills")
    const out = new Map()
    if (!fs.existsSync(dir)) return out
    ;(function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const f = path.join(d, e.name)
            if (e.isDirectory()) walk(f)
            else if (e.name.endsWith(SUFFIX)) out.set(path.relative(dir, f).split(path.sep).join("/").slice(0, -SUFFIX.length), f)
        }
    })(dir)
    return out
}

module.exports = { readScript, skillData, isScriptPath, checkScript, scriptStats, writeScript, customScripts, pruneScripts, scriptsIn, exportScript, importScript, SUBJECTS, LIMITS, CUSTOM_PREFIX }
