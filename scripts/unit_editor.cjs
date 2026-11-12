// Unit editor (dashboard page /unit-editor, docs/UNIT_EDITOR.md): reads a unit's ability, leader skill, stats and
// skill gauge rows, checks edited ability lines against what the CN client can read and what CN's own units use,
// and saves the edits as a unit change file (<custom units folder>/changes/unit-editor-<id>.json,
// scripts/custom_units.cjs) or, for a custom unit, into its own file. The CN schedule build then ships them.
//
// Ability lines are passed around as arrays of columns in the ability table's layout. Leader lines use the same
// layout (leaderToAbility/abilityToLeader), so one set of rules covers both. What each column means comes from
// the client's own parser: assets/unit_editor/ability_codes.json (scripts/research/ability_codes_from_pcode.cjs).
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const CU = require("./custom_units.cjs")
const TEXT = require("./unit_editor_text.cjs")
const { uploadPath } = require("./cdn_hash.cjs")

const CODES = require(path.join(__dirname, "..", "assets", "unit_editor", "ability_codes.json"))
const WORDS = require(path.join(__dirname, "..", "assets", "unit_editor", "words.json"))

const T = {
    ability: "master/ability/ability.orderedmap",
    leader: "master/ability/leader_ability.orderedmap",
    status: "master/character/character_status.orderedmap",
    skill: "master/skill/action_skill.orderedmap",
    character: "master/character/character.orderedmap",
    text: "master/character/character_text.orderedmap",
}
const FILE = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, uploadPath(v)]))
const STATUS_LEVELS = ["1", "10", "80", "100"]
const ABILITY_COLUMNS = 126
/** The most lines an ability or leader skill may have (decided with the user; CN uses up to 8) */
const MAX_LINES = 8
const PREFIX = "unit-editor-"

// ---- reading the game's tables ----------------------------------------------------------------------------

/** The game's own copy of a table: the translated (English) one when there is one, else CN's, as the schedule build. */
async function gameTable(logical) {
    const file = uploadPath(logical)
    const dir = require("./cn_archives.cjs").cnTextDir()
    const list = path.join(dir, "files.json")
    let from = null
    try { from = new Map(JSON.parse(fs.readFileSync(list, "utf8")).map(f => [f.path, f.from])).get(file) } catch { }
    const translated = from && fs.existsSync(from) ? from : path.join(dir, file)
    let buf = fs.existsSync(translated) ? fs.readFileSync(translated) : null
    if (!buf) buf = await require("./cn_read.cjs").readCn(logical)
    if (!buf) throw new Error(`no game table ${logical}`)
    const out = {}
    for (const { path: keys, leaf } of R.leaves(R.decodeFile(buf))) out[keys.join("/")] = leaf.text.replace(/\n$/, "")
    return out
}

let base = null
/** The six tables the editor reads, from the game (cached: they only change with a game or translation update). */
async function baseTables() {
    if (base) return base
    const out = {}
    for (const [k, logical] of Object.entries(T)) out[k] = await gameTable(logical)
    base = out
    return base
}

const lines = text => R.splitCsvLines(String(text ?? "").replace(/\n$/, "")).map(l => R.splitCsv(l))
const join = cols => cols.map(R.csvField).join(",")
const rowText = lineCols => lineCols.map(join).join("\n")
const leaderToAbility = c => [c[0], "", "", ...c.slice(1)]
// an armament line (ability_soul: slot, learn level, kind, ...) in the ability layout: slot in column 0, learn level in
// column 2 (columns the checks and the wording don't read), "true" in column 1 (no Ⓜ), the rest 3 to the right
const soulToAbility = c => [c[0] ?? "", "true", c[1] ?? "", "0", "", ...c.slice(2)]
const abilityToSoul = c => [c[0], c[2], ...c.slice(5)]
const abilityToLeader = c => [c[0], ...c.slice(3)]
const pad = c => { const out = [...c]; while (out.length < ABILITY_COLUMNS) out.push(""); return out.slice(0, ABILITY_COLUMNS) }

// ---- what CN's own units use (the guard rails) -----------------------------------------------------------

/**
 * Effects only a multiball's own ability may have ("Pierce/Float/fixed speed for its multiball", CN uses them only
 * in multiball abilities 90011, 90012, 90090, 98001). The client builds them with its "multiball only" flag and
 * stops with U_573686 ("マルチボール専用のアビリティが使用されています") when a unit's ability, leader skill or
 * armament has one: on the party screen and at the start of a two-boss battle. Refused in every mode.
 */
const multiballOnly = (part, code) => /MultiballSelf$/.test(CODES[part]?.[code]?.name ?? "")

let catalogCache = null
/**
 * From every CN ability and leader line: which codes and combinations the game uses, a template line for each
 * trigger and effect code (its most common column values), and the values seen in "group" columns.
 */
async function catalog() {
    if (catalogCache) return catalogCache
    const b = await baseTables()
    const used = { condition: new Set(), whenTrigger: new Set(), whileTrigger: new Set(), whenEffect: new Set(), whileEffect: new Set(), whenWho: new Set(), whileWho: new Set() }
    const pairs = { whenWho: new Set(), whileWho: new Set(), trigEffect: new Set(), effectTarget: new Set(), condTrig: new Set() }
    const counts = {} // part:code -> Map(block text -> n)
    const groups = new Set()
    // armament lines (master/ability/ability_soul) count too: same codes, layout 3 columns to the left
    const souls = b.soul ?? await gameTable("master/ability/ability_soul.orderedmap").catch(() => ({}))
    const all = [
        ...Object.values(b.ability).flatMap(t => lines(t).map(pad)),
        ...Object.values(b.leader).flatMap(t => lines(t).map(c => pad(leaderToAbility(c)))),
        ...Object.values(souls).flatMap(t => lines(t).map(c => pad(soulToAbility(c)))),
    ]
    const count = (part, code, cols) => {
        const m = (counts[`${part}:${code}`] ??= new Map()), key = JSON.stringify(cols)
        m.set(key, (m.get(key) ?? 0) + 1)
    }
    for (const c of all) {
        for (const at of CODES.blocks.condition) if (c[at] !== "" && c[at] !== "0") {
            used.condition.add(c[at]); count("condition", c[at], c.slice(at, at + 7))
            pairs.condTrig.add(`${c[5]}|${c[5] === "1" ? c[97] : c[5] === "0" ? c[27] : ""}|${c[at]}`)
        }
        for (const at of [11, 18, 25, 29, 36, 49, 99, 103, 111]) if (c[at] && c[at] !== "(None)") for (const g of c[at].split(",")) groups.add(g)
        if (c[5] === "0") {
            used.whenTrigger.add(c[27]); if (!multiballOnly("whenEffect", c[47])) used.whenEffect.add(c[47])
            if (fieldsOf("whenTrigger", c[27]).trigger_puller) used.whenWho.add(c[28])
            pairs.whenWho.add(`${c[27]}|${c[28]}`); pairs.trigEffect.add(`0|${c[27]}|${c[47]}`); pairs.effectTarget.add(`0|${c[47]}|${c[48]}`)
            count("whenTrigger", c[27], c.slice(27, 47)); count("whenEffect", c[47], c.slice(47, 85))
        } else if (c[5] === "1") {
            used.whileTrigger.add(c[97]); if (!multiballOnly("whileEffect", c[109])) used.whileEffect.add(c[109])
            if (fieldsOf("whileTrigger", c[97]).trigger_puller) used.whileWho.add(c[98])
            pairs.whileWho.add(`${c[97]}|${c[98]}`); pairs.trigEffect.add(`1|${c[97]}|${c[109]}`); pairs.effectTarget.add(`1|${c[109]}|${c[110]}`)
            count("whileTrigger", c[97], c.slice(85, 109)); count("whileEffect", c[109], c.slice(109, ABILITY_COLUMNS))
        }
    }
    const templates = {}
    for (const [k, m] of Object.entries(counts)) templates[k] = JSON.parse([...m.entries()].sort((x, y) => y[1] - x[1])[0][0])
    catalogCache = {
        used: Object.fromEntries(Object.entries(used).map(([k, v]) => [k, [...v].sort((a, b) => a - b)])),
        pairs: Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, [...v]])),
        templates, groups: [...groups].sort(), lines: all.length,
        // the game's English text pieces (ability_description_*), for lines in the game's own words
        strings: await gameTable("master/string/ui_string.orderedmap").catch(() => ({})),
    }
    return catalogCache
}

// ---- units -------------------------------------------------------------------------------------------------

const ELEMENTS = ["Fire", "Water", "Thunder", "Wind", "Light", "Dark"]
// character column 6 (client SpecialityTypeTools: also picks the unit's Power Flip) and column 26 (display only)
const CLASSES = [["0", "Swordsman"], ["1", "Fighter"], ["2", "Deadeye"], ["3", "Support"], ["4", "Special"]]
const ROLES = ["Attacker", "Tank", "Healer", "Supporter", "Jammer", "Balance"]

/** Every unit: CN's and the custom units. */
async function listUnits() {
    const b = await baseTables()
    const edited = new Set(editorFiles().map(f => f.id))
    const out = []
    for (const [id, text] of Object.entries(b.character)) {
        if (id.includes("/")) continue
        const c = lines(text)[0], t = lines(b.text[id] ?? "")[0] ?? []
        if (!b.ability[`${id}1`] && !b.leader[id]) continue
        out.push({ id, name: t[0] || c[0], title: t[3] ?? "", rarity: Number(c[2]), element: ELEMENTS[Number(c[3])] ?? "", custom: false, edited: edited.has(id) })
    }
    for (const unit of CU.readCustomUnits().units) out.push({ id: unit.id, name: unit.name, title: "custom unit", rarity: unit.character?.rarity, element: ELEMENTS[unit.character?.element] ?? "", custom: true, edited: false })
    return out.sort((a, b) => a.name.localeCompare(b.name))
}

function editorFiles() {
    const dir = path.join(CU.customUnitsDir(), "changes")
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter(f => f.startsWith(PREFIX) && f.endsWith(".json")).map(f => ({ id: f.slice(PREFIX.length, -5), file: path.join(dir, f) }))
}
const editorFile = id => path.join(CU.customUnitsDir(), "changes", `${PREFIX}${id}.json`)

/** A custom unit's rows of one table (its rows are keyed by logical name or stored path). */
function customRows(unit, file) {
    for (const [ref, rows] of Object.entries(unit.rows ?? {})) if (CU.tableFile(ref) === file) return { ref, rows }
    return { ref: null, rows: {} }
}
const flat = (rows, prefix = "") => Object.entries(rows ?? {}).flatMap(([k, v]) => typeof v === "string" ? [[prefix + k, v]] : flat(v, prefix + k + "/"))

/**
 * A unit's rows as the game will have them: the game's own (or the custom unit file's), with every change file
 * on top (the editor's own included, so the page shows what's saved). Also the game's own rows, for Reset and
 * to save only what differs.
 */
async function unitRows(id) {
    const b = await baseTables()
    const custom = CU.readCustomUnits().units.find(u => u.id === String(id))
    const own = {}
    const pick = (k, keys) => {
        const out = {}
        if (custom) {
            const rows = Object.fromEntries(flat(customRows(custom, FILE[k]).rows))
            for (const key of keys) if (rows[key] !== undefined) out[key] = rows[key]
        } else for (const key of keys) if (b[k][key] !== undefined) out[key] = b[k][key]
        return out
    }
    const charRow = custom ? Object.fromEntries(flat(customRows(custom, FILE.character).rows))[id] : b.character[id]
    if (charRow === undefined) return null
    const skillName = lines(charRow)[0][8]
    own.ability = pick("ability", [1, 2, 3, 4, 5, 6].map(n => `${id}${n}`))
    own.leader = pick("leader", [String(id)])
    own.status = pick("status", STATUS_LEVELS.map(l => `${id}/${l}`))
    own.skill = pick("skill", [`${skillName}/1`, `${skillName}/2`])
    own.character = pick("character", [String(id)])
    own.text = pick("text", [String(id)])
    const textRow = own.text[id]
    // change files (all of them, sorted, a later file wins), as the schedule build applies them
    const current = JSON.parse(JSON.stringify(own))
    const changes = CU.readUnitChanges()
    const others = []
    for (const [k, file] of Object.entries(FILE)) {
        const rows = changes.rows.get(file)
        if (!rows || !current[k]) continue
        for (const [key, value] of rows) {
            if (current[k][key] === undefined) continue
            if (typeof value === "string") current[k][key] = value.replace(/\n$/, "")
            else { const ls = lines(current[k][key]); for (const [i, v] of Object.entries(value.cols ?? {})) ls[0][+i] = String(v); current[k][key] = rowText(ls) }
        }
    }
    const dir = path.join(CU.customUnitsDir(), "changes")
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json") && !f.startsWith(PREFIX) && !f.startsWith("_"))) {
        try { if (JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))[id]) others.push(f) } catch { }
    }
    let kit = false
    try { kit = Boolean(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets", "kit_dates.json"), "utf8"))[id]) } catch { }
    return { custom, charRow, textRow, skillName, own, current, others, kit }
}

/** The page's view of a unit. */
async function getUnit(id) {
    id = String(id)
    const r = await unitRows(id)
    if (!r) return null
    const t = lines(r.current.text[id] ?? "")[0] ?? [], c = lines(r.current.character[id])[0]
    const gt = lines(r.own.text[id] ?? "")[0] ?? [], gc = lines(r.own.character[id])[0]
    const detailsOf = (tx, ch) => ({ name: tx[0] ?? "", description: tx[2] ?? "", title: tx[3] ?? "", class: ch[6] ?? "", role: ch[26] ?? "", leaderName: ch[18] ?? "" })
    const details = { ...detailsOf(t, c), hasText: r.own.text[id] !== undefined, game: detailsOf(gt, gc) }
    const abilities = [1, 2, 3, 4, 5, 6].map(n => `${id}${n}`).filter(k => r.current.ability[k] !== undefined)
        .map((key, i) => ({ key, slot: i + 1, lines: lines(r.current.ability[key]).map(pad), game: lines(r.own.ability[key]).map(pad) }))
    const leaderKey = id
    const leader = r.current.leader[leaderKey] === undefined ? null
        : { key: leaderKey, name: c[18] ?? "", lines: lines(r.current.leader[leaderKey]).map(l => pad(leaderToAbility(l))), game: lines(r.own.leader[leaderKey]).map(l => pad(leaderToAbility(l))) }
    const stats = STATUS_LEVELS.filter(l => r.current.status[`${id}/${l}`] !== undefined).map(l => {
        const [hp, atk] = lines(r.current.status[`${id}/${l}`])[0], [ghp, gatk] = lines(r.own.status[`${id}/${l}`])[0]
        return { level: l, hp: Number(hp), atk: Number(atk), game: { hp: Number(ghp), atk: Number(gatk) } }
    })
    const skills = ["1", "2"].filter(n => r.current.skill[`${r.skillName}/${n}`] !== undefined).map(n => {
        const key = `${r.skillName}/${n}`, s = lines(r.current.skill[key])[0], g = lines(r.own.skill[key])[0]
        return { key, name: s[0], plus: n === "2", gaugeMin: Number(s[4]), gaugeMax: Number(s[5]), game: { gaugeMin: Number(g[4]), gaugeMax: Number(g[5]) } }
    })
    return {
        id, name: t[0] || c[0], title: t[3] ?? "", element: ELEMENTS[Number(c[3])] ?? "", rarity: Number(c[2]),
        custom: Boolean(r.custom), saved: fs.existsSync(editorFile(id)), others: r.others, kit: r.kit,
        abilities, leader, stats, skills, details,
    }
}

// ---- checking -----------------------------------------------------------------------------------------------

const PAIR_FIELDS = ["threshold", "threshold2", "start_threshold", "strength", "strength2", "frame", "number"]
const isNum = v => v === "" || /^-?\d+(\.\d+)?(E\d+)?$/i.test(String(v)) // 9.999999E11 = "forever" (CN uses it)

/** The fields a code reads, from the client's parser ({} for an unknown code). */
const fieldsOf = (part, code) => CODES[part]?.[code]?.fields ?? {}

/**
 * Problems with one line (ability layout). errors: the line is refused (the game can't read it, or it can never
 * work). warnings: "strong" (a trigger, condition or effect CN never uses; unrestricted mode only) or "notice" (CN's
 * own parts in a combination CN never uses; advanced and unrestricted modes).
 * mode: "default" (only what CN's units use, and only their combinations), "advanced" (CN's own conditions,
 * triggers, "who" and effects in any combination) or "unrestricted" (everything the game can read). true = unrestricted.
 */
const MODES = ["default", "advanced", "unrestricted"]
const modeOf = m => m === true ? "unrestricted" : MODES.includes(m) ? m : "default"
function checkLine(c, cat, mode) {
    const errors = [], warnings = []
    mode = modeOf(mode)
    const combos = mode !== "default", unrestricted = mode === "unrestricted"
    const combo = what => combos ? warnings.push({ level: "notice", text: `Not used together by CN's units: ${what}.` }) : errors.push(`${what} isn't used together in the game (advanced mode)`)
    const kind = c[5]
    if (!["0", "1", "2"].includes(kind)) { errors.push(`unknown line kind "${kind}"`); return { errors, warnings } }
    const conds = CODES.blocks.condition.map(at => ({ at, code: c[at] })).filter(x => x.code !== "" && x.code !== "0")
    for (const x of conds) {
        if (!CODES.condition[x.code]) errors.push(`condition code ${x.code} isn't one the game knows`)
        else if (!cat.used.condition.includes(x.code)) (unrestricted ? warnings.push({ level: "strong", text: `Unused condition "${name("condition", x.code)}": may not work or crash the game.` }) : errors.push(`the condition "${name("condition", x.code)}" isn't used in the game (unrestricted mode)`))
        else {
            // the condition with this trigger: CN's units use only some pairs
            const trig = kind === "1" ? c[97] : kind === "0" ? c[27] : ""
            const part = kind === "1" ? "whileTrigger" : "whenTrigger"
            if (!cat.pairs.condTrig.includes(`${kind}|${trig}|${x.code}`)) {
                // (a trigger CN never uses is reported below, once)
                if (kind === "2" || cat.used[part].includes(trig)) combo(`the condition "${name("condition", x.code)}" with "${kind === "2" ? "at battle start" : name(part, trig)}"`)
            }
        }
    }
    const trigPart = kind === "1" ? "whileTrigger" : "whenTrigger", effPart = kind === "1" ? "whileEffect" : "whenEffect"
    const trigAt = kind === "1" ? 97 : 27, whoAt = kind === "1" ? 98 : 28, effAt = kind === "1" ? 109 : 47
    if (kind !== "2") {
        const trig = c[trigAt], eff = c[effAt]
        if (!CODES[trigPart][trig]) errors.push(`trigger code ${trig} isn't one the game knows`)
        else {
            const fields = fieldsOf(trigPart, trig)
            const usedTrig = cat.used[trigPart].includes(trig)
            const whoSeen = !fields.trigger_puller || cat.pairs[kind === "1" ? "whileWho" : "whenWho"].includes(`${trig}|${c[whoAt]}`)
            const whoCode = c[whoAt], whoPart = kind === "1" ? "whileWho" : "whenWho"
            const whoUsed = !fields.trigger_puller || !CODES[whoPart][whoCode] || cat.used[whoPart]?.includes(whoCode)
            if (!usedTrig) unrestricted ? warnings.push({ level: "strong", text: `Unused trigger: "${name(trigPart, trig)}" isn't used in the game. May not work or crash the game.` })
                : errors.push(`the trigger "${name(trigPart, trig)}" isn't used in the game (unrestricted mode)`)
            else if (!whoUsed) unrestricted ? warnings.push({ level: "strong", text: `Unused who: "${name(whoPart, whoCode)}" isn't used in the game. May not work or crash the game.` })
                : errors.push(`who "${name(whoPart, whoCode)}" isn't used in the game (unrestricted mode)`)
            else if (!whoSeen) combo(`"${name(trigPart, trig)}" with who "${name(whoPart, whoCode)}"`)
            if (fields.trigger_puller && !CODES[kind === "1" ? "whileWho" : "whenWho"][c[whoAt]]) errors.push(`"who" code ${c[whoAt]} isn't one the game knows`)
            for (const [f, d] of Object.entries(fields)) if (d.pair && !d.cols.every(i => isNum(c[i]))) errors.push(`${label(f)} must be a number`)
        }
        if (!CODES[effPart][eff]) errors.push(`effect code ${eff} isn't one the game knows`)
        else if (multiballOnly(effPart, eff)) errors.push(`the effect "${name(effPart, eff)}" only works in a multiball's own ability; on a unit it stops the game (U_573686)`)
        else {
            const fields = fieldsOf(effPart, eff)
            if (!cat.used[effPart].includes(eff) && !unrestricted) errors.push(`the effect "${name(effPart, eff)}" isn't used in the game (unrestricted mode)`)
            else if (!cat.used[effPart].includes(eff)) warnings.push({ level: "strong", text: `Unused effect "${name(effPart, eff)}": may not work or crash the game.` })
            for (const [f, d] of Object.entries(fields)) if (d.pair && !d.cols.every(i => isNum(c[i]))) errors.push(`${label(f)} must be a number`)
            if (fields.target && !CODES.target[c[fields.target.cols[0]]]) errors.push(`target code ${c[fields.target.cols[0]]} isn't one the game knows`)
            // "for the unit that triggered it" needs a trigger with a "who" (every CN line with it has one)
            if (fields.target && c[fields.target.cols[0]] === "7" && !fieldsOf(trigPart, c[trigAt]).trigger_puller)
                errors.push(`"for the unit that triggered it" needs a trigger with a "who"; "${name(trigPart, c[trigAt])}" has none`)
        }
    }
    errors.push(...contradictions(c, conds))
    return { errors, warnings }
}

/** Conditions that rule each other or the line's own trigger out: such a line could never do anything. */
function contradictions(c, conds) {
    const out = []
    const has = code => conds.some(x => x.code === code)
    const group = code => conds.filter(x => x.code === code).map(x => c[x.at + 5])
    const pct = (at) => Number(c[at]) / 1000
    if (has("12") && has("186")) out.push(`"in Fever" and "not in Fever" can't both be true`)
    if (c[5] === "1" && c[97] === "4" && has("186")) out.push(`"while in Fever" and the condition "not in Fever" can't both be true`)
    // "when Fever starts" + "in Fever": no CN unit has it; whether the game already counts as "in Fever" at that moment isn't
    // known, so it's either always true (redundant) or never (the line never fires). The pair check above flags it.
    if (has("42") && has("46")) out.push(`"this unit is the leader" and "this unit isn't the leader" can't both be true`)
    if (has("202") && has("203")) out.push(`"this unit is a main unit" and "this unit is a unison unit" can't both be true`)
    for (const code of ["43", "3"]) { const g = new Set(group(code)); if (g.size > 1) out.push(`${code === "43" ? "the leader" : "this unit"} can't be ${[...g].join(" and ")} at once`) }
    // HP: at or above X and at or below / below Y with Y < X
    const highs = conds.filter(x => x.code === "8").map(x => pct(x.at + 3))
    const lows = conds.filter(x => x.code === "9" || x.code === "205").map(x => pct(x.at + 3))
    if (c[5] === "1" && c[97] === "0") highs.push(pct(100))
    if (c[5] === "1" && (c[97] === "1" || c[97] === "227")) lows.push(pct(100))
    if (highs.length && lows.length && Math.max(...highs) > Math.min(...lows)) out.push(`HP can't be at or above ${Math.max(...highs)}% and below ${Math.min(...lows)}% at once`)
    return out
}

const name = (part, code) => {
    if (WORDS[part]?.[code]) return WORDS[part][code]
    const client = CODES[part]?.[code]?.name ?? String(code)
    // "when" effects 0-31 (ConditionAttackPoint, ...) are the timed versions of the plain ones
    
    if (part === "whenEffect" || part === "whileEffect") return effectWords(client)
    return humanize(client)
}

// Effect names follow patterns (PoisonPrevent, DebuffAttackSlayer, PowerFlipDamageUpExtend, EnemyDamageByAttackRed...):
// plain words from them
const ELEMENT = { Red: "fire", Blue: "water", Yellow: "thunder", Green: "wind", White: "light", Black: "dark", AllElement: "all elements" }
const STATE = {
    Debuff: "debuffed", Poison: "poisoned", Paralysis: "paralyzed", Frozen: "frozen", Silence: "silenced", Unique: "unit-specific debuffed",
    AttackPointDown: "attack-down", ...Object.fromEntries(Object.entries(ELEMENT).map(([k, v]) => [`Resistance${k}Down`, `${v}-resistance-down`])),
}
const ATTACK_KIND = { "": "", Attack: "", DirectDamage: " (direct hits)", Skill: " (skills)", DirectAttack: " (direct hits)" }
function effectWords(n) {
    let m
    const fixed = {
        AttackPoint: "attack up", SkillDamage: "skill damage up", DirectDamage: "direct damage up", PowerFlipDamage: "Power Flip damage up",
        PiercingMultiballSelf: "Pierce for its multiball", FlyingMultiballSelf: "Float for its multiball", Swift: "Swift",
        FixedSpeedMultiballSelf: "fixed speed for its multiball", ScapegoatWithLength: "take damage for others (for a time)",
        ScapegoatRatio: "take part of the damage for others", TakeOverDamageRatio: "take over part of the damage", InvokeSkill: "use its skill",
        ConsumeUniqueCondition: "use up a unit-specific buff", OverrideCharacterElement: "change the unit's element",
        PowerFlipOverride: "change its Power Flip", PowerFlipLv3DamageAdd: "Power Flip Lv 3 extra damage", Unique: "unit-specific buff",
        TriggerEnemyDisguiseStunWinceSlayer: "damage up vs the enemy that triggered it while it's stunned or wincing",
        Buff: "buff", BuffExtend: "buffs last longer", Invincible: "invincible", Regeneration: "Recover (heal over time)",
        FeverPoint: "Fever gauge gain up", StunWinceSlayer: "damage up vs stunned or wincing enemies", Piercing: "Pierce", Flying: "Float",
        Stunify: "stun gauge damage up", CharacterSlayer: "damage up vs a kind of enemy", Speedup: "speed up",
        CountUpFever: "counts as one more Fever", CountUpPowerFlip: "counts as one more Power Flip", SetCombo: "set the combo to",
        DeleteConditionDebuff: "remove debuffs", DeleteUniqueCondition: "remove a unit-specific buff", Guts: "Guts", Adversity: "Adversity buff",
        HealRejection: "heal block", AdditionalUnisonAttack: "add part of the second unit's attack",
        PowerFlipComboCountDown: "Power Flip charges faster", PowerFlipLv1ComboCountDown: "Power Flip Lv 1 charges faster",
        RatioDamageMaxHpIfHpHigh: "damage (% of max HP) while HP is high", ComboBoost: "combo boost",
    }
    if (fixed[n]) return fixed[n]
    if ((m = n.match(/^SeparatedTerm(.+)$/))) return effectWords(m[1]) + " (separate category)"
    if ((m = n.match(/^Condition([A-Z].+)$/))) return effectWords(m[1]) + " (timed)"
    if ((m = n.match(/^TriggerEnemy(Attack|DirectDamage|Skill)?Slayer$/))) return `damage up vs the enemy that triggered it${ATTACK_KIND[m[1] ?? ""]}`
    if ((m = n.match(/^(.+)Prevent$/))) {
        const what = { Frozen: "freeze", AttackPointDown: "attack down", SkillDamageDown: "skill damage down" }[m[1]]
            ?? (STATE[m[1]] && m[1].startsWith("Resistance") ? STATE[m[1]].replace(/-/g, " ") : humanize(m[1]))
        return `immune to ${what}`
    }
    if ((m = n.match(/^(Debuff|Poison|Paralysis|Frozen|Silence|Unique|AttackPointDown|Resistance(?:Red|Blue|Yellow|Green|White|Black)Down)(Attack|DirectDamage|Skill)?Slayer$/)))
        return `damage up vs ${STATE[m[1]]} enemies${ATTACK_KIND[m[2] ?? ""]}`
    if ((m = n.match(/^PowerFlipLv(\d)DamageSlayer$/))) return `Power Flip Lv ${m[1]} damage up`
    if ((m = n.match(/^(.+)Extend$/))) return `${effectWords(m[1].replace(/Up$/, ""))} buffs last longer`
    if ((m = n.match(/^(Enemy|TriggerEnemy|NearestEnemy)DamageBy(Attack|MaxHp)(Red|Blue|Yellow|Green|White|Black)$/)))
        return `${ELEMENT[m[3]]} damage to ${{ Enemy: "all enemies", TriggerEnemy: "the enemy that triggered it", NearestEnemy: "the nearest enemy" }[m[1]]} (from ${m[2] === "Attack" ? "attack" : "max HP"})`
    if ((m = n.match(/^ResistanceTo(.+)Enemy$/))) return `resists ${{ AttackPointDown: "attack down", Poison: "poison", Unique: "unit-specific debuffs" }[m[1]] ?? humanize(m[1])} from enemies`
    if ((m = n.match(/^EnemyCondition(.+)$/))) return `enemy ${effectWords(m[1])} (timed)`
    if ((m = n.match(/^Resistance(Red|Blue|Yellow|Green|White|Black|AllElement)$/))) return `${ELEMENT[m[1]]} resistance up`
    if ((m = n.match(/^DamageCut(Red|Blue|Yellow|Green|White|Black|AllElement)$/))) return `${ELEMENT[m[1]]} damage cut`
    if ((m = n.match(/^DirectAttack(\d)$/))) return `extra direct attack (kind ${m[1]})`
    if ((m = n.match(/^SpecificMultiball(Attack|DirectDamage|Hp)$/))) return `multiball ${{ Attack: "attack", DirectDamage: "direct damage", Hp: "HP" }[m[1]]} up`
    if ((m = n.match(/^ChangeSkillFlag(\d?)$/))) return `switch skill${m[1] ? ` (variant ${m[1]})` : ""}`
    return humanize(n)
}
const label = f => WORDS.fields?.[f] ?? f.replace(/_/g, " ")
const humanize = s => String(s).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()

/** Checks a whole edit (the page sends it on every change and before saving). */
// Columns holding a unit-specific buff's id (client field unique_condition_id: conditions, trigger, target, accumulation,
// "while" trigger, effects). Each buff (assets: master/character/unique_condition) belongs to its unit.
const UNIQUE_COLS = [12, 19, 26, 37, 45, 68, 95, 104, 118]
const uniqueIds = c => UNIQUE_COLS.map(i => c[i]).filter(v => /^\d+$/.test(String(v ?? "")))
let uniqueNames = null
async function uniqueName(id) {
    uniqueNames ??= await gameTable("master/character/unique_condition.orderedmap").catch(() => ({}))
    return lines(uniqueNames[id] ?? "")[0]?.[1] || `#${id}`
}

async function checkEdit(edit, advanced = false) {
    const cat = await catalog()
    const out = { abilities: [], leader: [], stats: [], skills: [], ok: true }
    // unit-specific buffs ("Energy Drain"...): only the unit whose own kit uses one may use it
    let own = null
    if (edit.id !== undefined) {
        const r = await unitRows(String(edit.id))
        own = new Set([...Object.values(r?.own.ability ?? {}).flatMap(t => lines(t).map(pad)), ...Object.values(r?.own.leader ?? {}).flatMap(t => lines(t).map(l => pad(leaderToAbility(l))))].flatMap(uniqueIds))
    }
    const foreign = new Map()
    for (const l of [...(edit.abilities ?? []).flatMap(a => a.lines), ...(edit.leader?.lines ?? [])]) for (const id of uniqueIds(pad(l))) if (own && !own.has(id)) foreign.set(id, await uniqueName(id))
    // each line also in the game's own words, at both ends of its range (null: not covered yet)
    const withText = l => {
        const r = checkLine(pad(l), cat, advanced)
        for (const id of uniqueIds(pad(l))) if (foreign.has(id)) r.errors.push(`uses "${foreign.get(id)}", another unit's own buff: only that unit can use it`)
        if (r.errors.length === 0) {
            try { r.text = { low: TEXT.lineText(pad(l), "low", cat.strings, CODES), high: TEXT.lineText(pad(l), "high", cat.strings, CODES) } } catch { r.text = null }
        }
        return r
    }
    for (const a of edit.abilities ?? []) out.abilities.push(a.lines.map(withText))
    if (edit.leader) out.leader = edit.leader.lines.map(withText)
    // each whole ability in the game's words (lines with the same trigger joined with "&", as the unit page shows them)
    const whole = ls => { try { return { low: TEXT.abilityText(ls.map(pad), "low", cat.strings, CODES, i => ({ line: i })), high: TEXT.abilityText(ls.map(pad), "high", cat.strings, CODES, i => ({ line: i })) } } catch { return null } }
    // a leader line's awakening tag (leader column 1, here column 3): 0 always, 1 only before awakening, 2 only after
    // a line the game's wording can't cover yet comes back as { line: n } (its place in the ability), for the page's own words
    const wholeLeader = ls => { try {
        const at = drop => ls.map((c, i) => [pad(c), i]).filter(([c]) => c[3] !== drop)
        const words = (list, level) => TEXT.abilityText(list.map(x => x[0]), level, cat.strings, CODES, i => ({ line: list[i][1] }))
        return { low: words(at("2"), "low"), high: words(at("1"), "high") } } catch { return null } }
    out.texts = { abilities: (edit.abilities ?? []).map(a => whole(a.lines)), leader: edit.leader ? wholeLeader(edit.leader.lines) : null }
    for (const s of edit.stats ?? []) out.stats.push(Number.isInteger(s.hp) && Number.isInteger(s.atk) && s.hp >= 0 && s.atk >= 0 ? [] : ["HP and ATK must be whole numbers, 0 or more"])
    if (edit.details) {
        const d = edit.details, e = []
        if (d.name !== undefined && !String(d.name).trim()) e.push("the name can't be empty")
        for (const k of ["name", "title", "description", "leaderName"]) if (/[\r\n]/.test(String(d[k] ?? ""))) e.push(`${k} can't have line breaks`)
        if (d.class !== undefined && !CLASSES.some(([v]) => v === String(d.class))) e.push(`class "${d.class}" isn't one the game knows`)
        if (d.role !== undefined && !ROLES.includes(String(d.role))) e.push(`role "${d.role}" isn't one the game knows`)
        out.details = e
    } else out.details = []
    for (const s of edit.skills ?? []) out.skills.push(Number.isInteger(s.gaugeMin) && Number.isInteger(s.gaugeMax) && s.gaugeMin > 0 && s.gaugeMax > 0 ? [] : ["the skill gauge must be whole numbers above 0"])
    // at most MAX_LINES lines per ability and leader skill (CN's own most: 6 per ability, 8 per leader skill)
    out.tooMany = [...(edit.abilities ?? []).map((a, i) => [`Ability ${i + 1}`, a.lines.length]), ["Leader skill", edit.leader?.lines.length ?? 0]]
        .filter(([, n]) => n > MAX_LINES).map(([what, n]) => `${what} has ${n} lines; the most is ${MAX_LINES}`)
    const lineErrors = [...out.abilities.flat(), ...out.leader].some(r => r.errors.length > 0)
    out.ok = !lineErrors && out.tooMany.length === 0 && [...out.stats, ...out.skills, out.details].every(e => e.length === 0)
    return out
}

// ---- saving -------------------------------------------------------------------------------------------------

/**
 * Saves an edit. Only rows that differ from the game's own are written. CN unit: changes/unit-editor-<id>.json
 * (whole rows for abilities and the leader skill, changed columns for stats and the skill gauge); custom unit:
 * its own file. Returns { file, rows } or { errors }.
 */
async function saveUnit(id, edit, advanced = false) {
    id = String(id)
    const check = await checkEdit({ ...edit, id }, advanced)
    if (!check.ok) return { errors: check }
    const r = await unitRows(id)
    if (!r) return { errors: { message: `no unit ${id}` } }
    const rows = {} // "<logical table>#<key>" -> row text | { cols }
    for (const a of edit.abilities ?? []) {
        if (r.own.ability[a.key] === undefined) continue
        const text = rowText(a.lines.map(l => trimRow(pad(l), lines(r.own.ability[a.key])[0].length)))
        if (text !== r.own.ability[a.key]) rows[`${T.ability}#${a.key}`] = text
    }
    if (edit.leader && r.own.leader[edit.leader.key] !== undefined) {
        const width = lines(r.own.leader[edit.leader.key])[0].length
        const text = rowText(edit.leader.lines.map(l => abilityToLeader(pad(l)).slice(0, width)))
        if (text !== r.own.leader[edit.leader.key]) rows[`${T.leader}#${edit.leader.key}`] = text
    }
    for (const s of edit.stats ?? []) {
        const key = `${id}/${s.level}`
        if (r.own.status[key] === undefined) continue
        const text = `${s.hp},${s.atk}`
        if (text !== r.own.status[key]) rows[`${T.status}#${key}`] = text
    }
    for (const s of edit.skills ?? []) {
        if (r.own.skill[s.key] === undefined) continue
        const g = lines(r.own.skill[s.key])[0]
        const cols = {}
        if (String(s.gaugeMin) !== g[4]) cols[4] = String(s.gaugeMin)
        if (String(s.gaugeMax) !== g[5]) cols[5] = String(s.gaugeMax)
        if (Object.keys(cols).length) rows[`${T.skill}#${s.key}`] = { cols }
    }
    if (edit.details) {
        const d = edit.details
        const colsOf = (row, map) => {
            const g = lines(row)[0], cols = {}
            for (const [i, v] of Object.entries(map)) if (v !== undefined && String(v) !== (g[i] ?? "")) cols[i] = String(v)
            return cols
        }
        if (r.own.text[id] !== undefined) {
            const cols = colsOf(r.own.text[id], { 0: d.name, 2: d.description, 3: d.title })
            if (Object.keys(cols).length) rows[`${T.text}#${id}`] = { cols }
        }
        const cols = colsOf(r.own.character[id], { 6: d.class, 18: d.leaderName, 26: d.role })
        if (Object.keys(cols).length) rows[`${T.character}#${id}`] = { cols }
    }
    if (r.custom) return saveCustom(r.custom, rows, edit)
    const file = editorFile(id)
    if (Object.keys(rows).length === 0) { if (fs.existsSync(file)) fs.unlinkSync(file); return { file: null, rows: 0 } }
    const unitName = (await getUnit(id))?.name ?? id
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ [id]: { name: `Unit editor: ${unitName}`, rows } }, null, 1) + "\n")
    return { file, rows: Object.keys(rows).length }
}
const trimRow = (c, width) => c.slice(0, width)

/** A custom unit's edit goes into its own file (rows replaced in place). */
function saveCustom(unit, rows, edit) {
    const data = JSON.parse(fs.readFileSync(unit.file, "utf8"))
    let n = 0
    for (const [ref, value] of Object.entries(rows)) {
        const [logical, key] = ref.split("#")
        const { ref: tableRef } = customRows(data, uploadPath(logical))
        if (!tableRef) continue
        const parts = key.split("/")
        let node = data.rows[tableRef]
        for (const p of parts.slice(0, -1)) node = node?.[p]
        if (!node || node[parts.at(-1)] === undefined) continue
        if (typeof value === "string") node[parts.at(-1)] = value
        else { const ls = lines(node[parts.at(-1)]); for (const [i, v] of Object.entries(value.cols)) ls[0][+i] = v; node[parts.at(-1)] = rowText(ls) }
        n++
    }
    fs.writeFileSync(unit.file, JSON.stringify(data, null, 1))
    return { file: unit.file, rows: n }
}

/** Takes the editor's changes to a CN unit away (its change file). */
function resetUnit(id) {
    const file = editorFile(String(id))
    if (!fs.existsSync(file)) return false
    fs.unlinkSync(file)
    return true
}

/** Everything the page needs to draw lists and fields: codes with plain words, fields, templates, what CN uses. */
async function editorData() {
    const cat = await catalog()
    const parts = {}
    for (const part of ["condition", "conditionWho", "whenTrigger", "whenWho", "whileTrigger", "whileWho", "whenEffect", "whileEffect", "target"]) {
        parts[part] = Object.fromEntries(Object.entries(CODES[part]).map(([code, v]) => [code, { name: name(part, code), client: v.name, fields: v.fields }]))
    }
    return { parts, blocks: CODES.blocks, words: WORDS, used: cat.used, pairs: cat.pairs, templates: cat.templates, groups: cat.groups, lines: cat.lines, classes: CLASSES, roles: ROLES, maxLines: MAX_LINES }
}

/** Another unit's ability lines, to copy one. */
async function unitLines(id) {
    const u = await getUnit(id)
    if (!u) return null
    return { id: u.id, name: u.name, abilities: u.abilities.map(a => ({ slot: a.slot, lines: a.lines })), leader: u.leader ? u.leader.lines : [] }
}

// ---- sharing kits ------------------------------------------------------------------------------------------

const KIT_FORMAT = "globalpoint-unit-kits"

/**
 * The editor's changes for some units (all when ids is empty) as one file. It is itself a unit change file
 * ({ "<id>": { name, rows } }), so it also works dropped into <custom units>/changes/.
 */
function exportKits(ids = []) {
    const want = new Set(ids.map(String))
    const out = { _format: KIT_FORMAT, _note: "Unit editor kits (GlobalPoint). Import on the dashboard's Unit editor page, or put this file in the custom units folder's changes/." }
    for (const { id, file } of editorFiles()) {
        if (want.size && !want.has(id)) continue
        try { Object.assign(out, JSON.parse(fs.readFileSync(file, "utf8"))) } catch { }
    }
    return out
}

/**
 * Imports kits (exportKits' format, or any unit change file): each unit's rows become its editor change file,
 * if the unit exists (CN units only), every row belongs to that unit, and the result passes the editor's checks
 * (advanced mode: only unreadable rows and contradictions refuse it). Returns { imported: [ids], refused: [{ id, why }] }.
 */
async function importKits(data) {
    const imported = [], refused = []
    if (!data || typeof data !== "object") return { imported, refused: [{ id: "", why: "not a kit file" }] }
    const b = await baseTables()
    for (const [id, kit] of Object.entries(data)) {
        if (id.startsWith("_")) continue
        const no = why => refused.push({ id, why })
        if (!/^\d+$/.test(id) || b.character[id] === undefined) { no("no CN unit with this id"); continue }
        if (!kit || typeof kit.rows !== "object") { no("no rows"); continue }
        const skillName = lines(b.character[id])[0][8]
        const mine = key => key === id || key.startsWith(id + "/") || /^\d+$/.test(key) && key.length === id.length + 1 && key.startsWith(id) || key === `${skillName}/1` || key === `${skillName}/2`
        const bad = Object.keys(kit.rows).filter(ref => { const at = ref.indexOf("#"); return at < 0 || !Object.values(T).includes(ref.slice(0, at)) || !mine(ref.slice(at + 1)) })
        if (bad.length) { no(`rows that aren't this unit's or that the editor doesn't handle: ${bad.slice(0, 3).join(", ")}`); continue }
        const file = editorFile(id), before = fs.existsSync(file) ? fs.readFileSync(file) : null
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify({ [id]: { name: kit.name ?? `Unit editor: ${id}`, rows: kit.rows } }, null, 1) + "\n")
        const unit = await getUnit(id), check = await checkEdit(unit, true)
        if (!check.ok) {
            if (before) fs.writeFileSync(file, before); else fs.unlinkSync(file)
            const first = [...check.abilities.flatMap((a, i) => a.map((r, j) => [`ability ${i + 1}, line ${j + 1}`, r])), ...check.leader.map((r, j) => [`leader skill, line ${j + 1}`, r])].find(([, r]) => r.errors.length)
            no(first ? `${first[0]}: ${first[1].errors[0]}` : "some lines can't be read by the game or contradict themselves")
            continue
        }
        imported.push(id)
    }
    return { imported, refused }
}

// shared with the armament editor (scripts/armament_editor.cjs)
const _internal = { gameTable, lines, rowText, pad, uniqueIds, uniqueName, soulToAbility, abilityToSoul, ABILITY_COLUMNS }

module.exports = { MODES, _internal, exportKits, importKits, CLASSES, ROLES, MAX_LINES, listUnits, getUnit, checkEdit, checkLine, saveUnit, resetUnit, editorData, unitLines, catalog, leaderToAbility, abilityToLeader, contradictions, _setBase: b => { base = b; catalogCache = null } }
