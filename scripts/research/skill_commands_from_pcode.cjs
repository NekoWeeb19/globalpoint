// Builds the skill editor's command data (assets/skill_editor/commands.json) from
//   1. the CN 1.8.1 client's commands and events (Wait, Repeat, collisions: they hold the blocks that run later),
//      ActionDslCommand and ActionDslEvent exported with FFDec:
//        ffdec-cli -selectclass pinball.battle.action.dsl.ActionDslCommand,pinball.battle.action.dsl.ActionDslEvent -export script <dir> worldflipper_android_release.swf
//   2. every CN skill script (master/skill/action_skill column 7): for each parameter the values the game uses, and for
//      every option of a choice (an enum) its most common full value, which the editor fills in when you pick it.
//
//   node scripts/research/skill_commands_from_pcode.cjs <ActionDslCommand.as> <ActionDslEvent.as>
const zlib = require("zlib")
const fs = require("fs")
const path = require("path")
const unzipper = require("unzipper")
const R = require("../cdn_rows.cjs")
const { readCnTable, cnIndex } = require("../cn_read.cjs")
const { readAmf3 } = require("../amf3.cjs")
const { cnDir } = require("../cn_archives.cjs")
const { uploadPath } = require("../cdn_hash.cjs")

const OUT = path.join(__dirname, "..", "..", "assets", "skill_editor", "commands.json")

// What each parameter is. Plain = read in the client's battle code (ActionEvaluator.evalCommand and what it builds) or
// tested in game; "(inferred)" = from the values the game's scripts use. kind "subject" = an id of a unit, ball, area...
const MEANINGS = {
    ShowEffect: { label: "Effect", what: "Show an effect.", p: [["label", "string"], ["effect"], ["attached to", "subject"], ["layer"], ["how long it shows"], ["direction"], ["offset X"], ["offset Y (positive = down)"], ["rotation (radians)"], ["follows position"], ["follows direction"], ["scale"]] },
    CreateHitArea: { label: "Attack area", what: "Create an attack area: the zone that hits.", p: [["label", "string"], ["attached to", "subject"], ["direction"], ["offset X"], ["offset Y (positive = down)"], ["rotation (radians)"], ["follows position"], ["follows direction"], ["shape"], ["horizontal alignment"], ["vertical alignment"], ["formation (several areas at once)"], ["how long it lasts"], ["time between hits"], ["max hits"], ["disappears when it hits"], ["breaks weak points"], ["disappears after N hits"], ["id of the new area", "binds"], ["when it appears", "block"], ["id of the area (on hit)", "binds"], ["id of the hit target (on hit)", "binds"], ["on each hit", "block"], ["(inferred) local id"], ["hit timing shared by the formation (0 each area, 1 all)"], ["guard mode"]] },
    CreateCondition: { label: "Buff / debuff", what: "Give a buff or debuff (a condition).", p: [["target", "subject"], ["conditions"], ["chance it lands (1 = 100 %)"], ["marker shown"], ["can be removed (cleansed / dispelled)"], ["given again even if it's already on"], ["label", "string"], ["linked hit check"], ["hidden (no icon)"], ["who it may go to"], ["strength multiplier"], ["applies even when blocked (force)"]] },
    CreateNormalAttack: { label: "Damage", what: "Normal damage to a target (usually inside an area's on-hit).", p: [["target", "subject"], ["element"], ["slayer: bonus against unit kinds (codes)"], ["bonus against enemies with these debuffs"], ["damage (the game's base number)"], ["damage multiplier"], ["slayer multiplier"], ["combo bonus applies"], ["revived-coffins bonus applies"], ["buff-count bonus applies"], ["debuff-count bonus applies"], ["range bonus applies"], ["break-gauge damage"], ["Fever gauge gained"], ["hit effect"], ["counts toward the combo"]] },
    StopBall: { label: "Stop the ball", what: "Stop or slow the unit's ball for a while.", p: [["ball", "subject"], ["frames"], ["afterwards"], ["direction"], ["angle"]] },
    MoveBall: { label: "Move the ball", what: "Move the unit's ball (dashes, charges).", p: [["ball", "subject"], ["direction"], ["angle (radians)"], ["frames"], ["speed"], ["afterwards"], ["(inferred) flag"]] },
    FindAllSubjects: { label: "Find a group", what: "Pick a group (the party, all enemies...) and run a block with each one.", p: [["id of the group", "binds"], ["which group", "group"], ["kinds filter 1 (codes, any of)"], ["kinds filter 2 (codes, any of)"], ["kinds filter 3 (codes, any of)"], ["kinds filter 4 (codes, any of)"], ["only these ids"], ["if nobody is found"], ["for the group", "block"]] },
    FindNearSubjects: { label: "Find the nearest", what: "Pick the nearest of a group and run a block with them.", p: [["from", "subject"], ["how many"], ["which group", "group"], ["if nobody is found"], ["id of the ones found", "binds"], ["for them", "block"]] },
    CreateReferencePoint: { label: "Reference point", what: "A point (at a subject, with an offset) areas and effects can attach to or aim at.", p: [["at", "subject"], ["direction"], ["offset X"], ["offset Y"], ["rotation"], ["follows position"], ["follows direction"], ["formation (several points at once)"], ["how long it lasts (frames)"], ["id of the point", "binds"], ["with the point", "block"]] },
    MoveHitArea: { label: "Move an area", what: "Move an attack area (a slash that travels).", p: [["area", "subject"], ["direction"], ["angle"], ["speed"], ["speed curve (easing)"]] },
    CreateRatioHeal: { label: "Heal", what: "Heal a share of HP.", p: [["target", "subject"], ["of (1 current HP, 2 max HP)"], ["ratio (0.05 = 5 %)"], ["bonus for unit kinds (codes)"], ["bonus multiplier"], ["marker shown"]] },
    ShakeCamera: { label: "Camera shake", what: "Camera shake.", p: [["size (1 small, 2 medium, 3 large)"]] },
    HideCharacter: { label: "Hide the unit", what: "Hide the unit's sprite for a while.", p: [["unit", "subject"], ["frames"]] },
    AddFeverPoint: { label: "Fever gauge", what: "Add Fever gauge.", p: [["amount"]] },
    AddSkillPoint: { label: "Skill gauge", what: "Add skill gauge.", p: [["target", "subject"], ["amount"]] },
    CreateBarrier: { label: "Barrier", what: "A barrier.", p: [["target", "subject"], ["strength"], ["hit effect"]] },
    ConditionalsHealthPointRatio: { label: "If HP ≥ X %", what: "Branch on the unit's HP: at or above X % runs the first block, else the second.", p: [["X (percent)"], ["if at or above", "block"], ["if below", "block"]] },
    ConditionalsFeverMode: { label: "If in Fever", what: "Branch on Fever (inferred: first block in Fever, second not).", p: [["in Fever", "block"], ["not in Fever", "block"]] },
    HideEffect: { label: "Hide an effect", what: "Stop an effect early, by its label.", p: [["label", "string"]] },
    DeleteCondition: { label: "Remove buffs", what: "Remove buffs or debuffs from a target.", p: [["target", "subject"], ["which"], ["at most how many"], ["(inferred) which can be removed"], ["only this label", "string"], ["sync mode"]] },
    AddCombo: { label: "Combo", what: "Add combo (inferred).", p: [] },
    StartPiercing: { label: "Pierce", what: "The ball goes through enemies for a while.", p: [["ball / unit", "subject"], ["frames"]] },
    CreateRatioAttack: { label: "Damage (% of HP)", what: "Damage as a share of the target's HP.", p: [["target", "subject"], ["of (1 current HP, 2 max HP)"], ["ratio (0.1 = 10 %)"]] },
}

// events: commands that hold a block run later (after a wait, again and again, when the ball hits...)
const EVENT_MEANINGS = {
    Wait: { label: "Wait", what: "Wait, then run the block (the rest of the script is usually inside it).", p: [["frames (60 = 1 s)"], ["label", "string"], ["then", "block"]] },
    Repeat: { label: "Repeat", what: "Run the block again and again (inferred: every N frames, M times).", p: [["(inferred) frames between"], ["(inferred) times"], ["label", "string"], ["each time", "block"]] },
    CollisionOfBallAndEnemy: { label: "When the ball hits", what: "Run the block when the unit's ball hits an enemy (inferred).", p: [["(inferred) frames it listens"], ["(inferred) number"], ["label", "string"], ["(inferred) number"], ["on a hit", "block"]] },
    CollisionOfBallAndSpecificEnemy: { label: "When the ball hits (enemy)", what: "Run a block when the ball hits an enemy (inferred).", p: [["(inferred) subject", "subject"], ["(inferred) frames it listens"], ["(inferred) number"], ["label", "string"], ["(inferred) number"], ["on a hit", "block"], ["(inferred) otherwise", "block"]] },
}

const rd = b => { try { return readAmf3(zlib.inflateRawSync(b)) } catch { return readAmf3(zlib.inflateSync(b)) } }
// readCn opens a whole archive per file; here each archive is opened once (a thousand scripts)
const opened = new Map()
async function entriesOf(file) {
    if (!opened.has(file)) { const z = await unzipper.Open.file(file); opened.set(file, new Map(z.files.map(e => [e.path.split("\\").join("/").replace(/^production\//, ""), e]))) }
    return opened.get(file)
}
async function readFast(logical) {
    const key = uploadPath(logical), v = cnIndex().get(key); if (!v) return null
    const short = key.replace("production/", "")
    for (const d of ["archive-common-diff", "archive-common-full", "archive-medium-diff", "archive-medium-full", "archive-android-diff", "archive-android-full"]) {
        const full = path.join(cnDir(), d); if (!fs.existsSync(full)) continue
        for (const f of fs.readdirSync(full).filter(f => f.endsWith(".zip") && f.includes(`-${v}-`))) { const e = (await entriesOf(path.join(full, f))).get(short); if (e) return e.buffer() }
    }
    return null
}

const isEnum = v => Array.isArray(v) && typeof v[0] === "string" && /^[A-Z]/.test(v[0]) && v[0] !== "Block"
const isRange = v => Array.isArray(v) && v.length > 0 && v.every(x => x && typeof x === "object" && !Array.isArray(x) && "min" in x)
const shapeOf = v => v === null || v === undefined ? "none" : typeof v === "boolean" ? "bool" : typeof v === "number" ? "number"
    : typeof v === "string" ? "string" : Array.isArray(v) ? (v[0] === "Block" ? "block" : isEnum(v) ? "enum" : isRange(v) ? "range" : "list") : "object"

;(async () => {
    const [cmdSrc, eventSrc] = process.argv.slice(2)
    if (!cmdSrc || !eventSrc) throw new Error("usage: skill_commands_from_pcode.cjs <ActionDslCommand.as> <ActionDslEvent.as>")
    const sigs = { Command: {}, Event: {} }
    for (const [kind, src] of [["Command", cmdSrc], ["Event", eventSrc]]) {
        const re = new RegExp(String.raw`public static function (\w+)\(([^)]*)\)\s*:\s*ActionDsl${kind}\s*\{\s*return new ActionDsl${kind}\("(\w+)",(\d+),`, "g")
        const text = fs.readFileSync(src, "utf8")
        for (let m; (m = re.exec(text));) sigs[kind][m[1]] = { index: Number(m[4]), types: m[2].trim() ? m[2].split(",").map(p => p.trim().split("=")[0].trim().split(":")[1]) : [] }
    }

    const seen = {} // command -> { skills: Set, whole: Map(json -> n), params: [{ shapes: Map, values: Map(json -> n), options: Map(head -> {n, examples: Map}) }] }
    const effects = new Map() // "<how>|<path>" -> Set of skills showing it
    const skills = await readCnTable("master/skill/action_skill.orderedmap")
    let scripts = 0
    for (const [key, row] of Object.entries(skills)) {
        const c = R.splitCsv(R.splitCsvLines(row.replace(/\n$/, ""))[0])
        if (!c[7] || !c[7].startsWith("battle/action/skill/")) continue
        const buf = await readFast(c[7] + ".action.dsl.amf3.deflate"); if (!buf) continue
        let d; try { d = rd(buf) } catch { continue }
        scripts++
        ;(function walk(v) {
            if (!Array.isArray(v)) { if (v && typeof v === "object") for (const x of Object.values(v)) walk(x); return }
            if ((v[0] === "Command" || v[0] === "Event") && Array.isArray(v[1])) {
                const [name, ...ps] = v[1]
                const s = (seen[v[0] + ":" + name] ??= { skills: new Set(), whole: new Map(), params: [] })
                s.skills.add(key.split("/")[0])
                // the whole command as CN writes it: the most common one is what "add" puts in
                const whole = JSON.stringify(v); if (whole.length < 4000) s.whole.set(whole, (s.whole.get(whole) ?? 0) + 1)
                ps.forEach((p, i) => {
                    const q = (s.params[i] ??= { shapes: new Map(), values: new Map(), options: new Map() })
                    const sh = shapeOf(p); q.shapes.set(sh, (q.shapes.get(sh) ?? 0) + 1)
                    if (sh !== "block") { const j = JSON.stringify(p); if (j.length < 400) q.values.set(j, (q.values.get(j) ?? 0) + 1) }
                    // the options of a choice, and of the choices inside a list (e.g. the conditions of a buff)
                    for (const e of sh === "enum" ? [p] : sh === "list" ? p.filter(isEnum) : []) {
                        const o = (q.options.get(e[0]) ?? { n: 0, examples: new Map() }); o.n++
                        const j = JSON.stringify(e); o.examples.set(j, (o.examples.get(j) ?? 0) + 1); q.options.set(e[0], o)
                    }
                })
            }
            if ((v[0] === "ResolveByElement" || v[0] === "SpecifyEffectDirectly") && typeof v[1] === "string") {
                const k = v[0] + "|" + v[1]; if (!effects.has(k)) effects.set(k, new Set()); effects.get(k).add(key.split("/")[0])
            }
            for (const x of v) walk(x)
        })(d)
    }
    const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    const out = { _source: "CN 1.8.1 client ActionDslCommand/ActionDslEvent + CN's skill scripts (scripts/research/skill_commands_from_pcode.cjs)", scripts, commands: {}, events: {} }
    for (const [kind, list] of Object.entries(sigs)) for (const [name, sig] of Object.entries(list)) {
        const s = seen[kind + ":" + name], m = (kind === "Event" ? EVENT_MEANINGS : MEANINGS)[name]
        out[kind === "Event" ? "events" : "commands"][name] = {
            index: sig.index, label: m?.label ?? name, what: m?.what ?? "", skills: s ? s.skills.size : 0,
            template: s && s.whole.size ? JSON.parse(top(s.whole, 1)[0][0]) : null,
            params: sig.types.map((type, i) => {
                const q = s?.params[i], hint = m?.p?.[i] ?? []
                const shape = q ? top(q.shapes, 1)[0][0] : (type === "Boolean" ? "bool" : type === "ActionDslExpression" ? "block" : type === "String" ? "string" : /int|Number/.test(type) ? "number" : "value")
                return {
                    type, label: hint[0] ?? "", kind: hint[1] ?? shape, shapes: q ? [...q.shapes.keys()] : [],
                    common: q ? top(q.values, 8).map(([j, n]) => [JSON.parse(j), n]) : [],
                    options: q ? Object.fromEntries(top(new Map([...q.options].map(([h, o]) => [h, o.n])), 200).map(([h]) => {
                        const o = q.options.get(h); return [h, { n: o.n, example: JSON.parse(top(o.examples, 1)[0][0]) }]
                    })) : {},
                }
            }),
        }
    }
    // effects CN's skills show: how (in the unit's element / that file), path, how many skills
    out.effects = [...effects].map(([k, set]) => { const [how, p] = k.split("|"); return { how, path: p, skills: set.size } }).sort((a, b) => b.skills - a.skills)
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n")
    console.log(`${scripts} scripts read; ${Object.keys(out.commands).length} commands (${Object.values(out.commands).filter(c => c.skills).length} used), ${Object.keys(out.events).length} events (${Object.values(out.events).filter(c => c.skills).length} used) -> ${OUT}`)
})().catch(e => { console.error(e); process.exit(1) })
