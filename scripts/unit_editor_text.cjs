// Unit editor: an ability line in the game's own words (docs/UNIT_EDITOR.md). Built from the game's English text
// pieces (the UI string table, master/string/ui_string, keys ability_description_*) filled in like the CN client's
// description generator does (pinball.common.data.ability.description.*, read from the decompiled client), for the
// triggers, conditions and effects CN's units use most. A part it doesn't know yet makes it return null, and the
// page keeps the editor's own sentence.
//
//   const T = require("./unit_editor_text.cjs"); T.lineText(columns, "low" | "high", strings, codes) -> string | null
// Columns are in the ability layout (leader lines converted, scripts/unit_editor.cjs).

const NBSP = " "
const ELEMENT = { Red: "Fire", Blue: "Water", Yellow: "Thunder", Green: "Wind", White: "Light", Black: "Dark" }

// ---- haxe.Template, as the client fills its pieces (::name::, ::if expr:: ... ::elseif expr:: ... ::else:: ... ::end::)

function render(template, ctx) {
    const tokens = String(template).split(/::/)
    // tokens alternate: text, code, text, code ...
    let pos = 0
    const out = []
    function block(stopAt) {
        let s = ""
        while (pos < tokens.length) {
            const text = tokens[pos++]
            s += text
            if (pos >= tokens.length) break
            const code = tokens[pos++].trim()
            if (stopAt.some(w => code === w || code.startsWith(w + " "))) { pos -= 1; return s }
            if (code.startsWith("if ")) s += ifBlock(code.slice(3))
            else if (code !== "") s += String(value(code) ?? "")
            // an empty code ("::::") writes nothing
        }
        return s
    }
    function ifBlock(cond) {
        let result = null, taken = false
        for (;;) {
            const body = block(["elseif", "else", "end"])
            if (!taken && truthy(evaluate(cond))) { result = body; taken = true }
            const code = tokens[pos++].trim()
            if (code === "end") break
            if (code === "else") { cond = "true"; continue }
            cond = code.slice("elseif".length).trim()
        }
        return result ?? ""
    }
    const truthy = v => v !== false && v !== null && v !== undefined && v !== "" && v !== 0
    const value = name => evaluate(name)
    function evaluate(expr) {
        // a small expression reader: ! ( ) >= <= > < == != && || - numbers names
        const t = expr.match(/\(|\)|>=|<=|==|!=|&&|\|\||[!<>-]|\d+(\.\d+)?|[A-Za-z_][\w.]*/g) ?? []
        let i = 0
        const or = () => { let v = and(); while (t[i] === "||") { i++; const r = and(); v = truthy(v) || truthy(r) } return v }
        const and = () => { let v = cmp(); while (t[i] === "&&") { i++; const r = cmp(); v = truthy(v) && truthy(r) } return v }
        const cmp = () => {
            let v = un()
            while ([">=", "<=", ">", "<", "==", "!="].includes(t[i])) {
                const op = t[i++], r = un()
                v = op === ">=" ? v >= r : op === "<=" ? v <= r : op === ">" ? v > r : op === "<" ? v < r : op === "==" ? v == r : v != r
            }
            return v
        }
        const un = () => {
            const k = t[i++]
            if (k === "!") return !truthy(un())
            if (k === "-") return -un()
            if (k === "(") { const v = or(); i++; return v }
            if (k === "true") return true
            if (k === "false") return false
            if (/^\d/.test(k)) return Number(k)
            return ctx[k]
        }
        return or()
    }
    out.push(block([]))
    return out.join("")
}

/** A piece by key, filled; null when the table has no such piece. */
function piece(strings, key, ctx = {}) {
    let t = strings["ability_description_" + key]
    if (t === undefined) return null
    t = String(t).replace(/^"([\s\S]*)"$/, "$1") // some translated pieces kept their CSV quotes
    return render(t, ctx).replace(/&nbsp;/g, NBSP)
}

// ---- values ----------------------------------------------------------------------------------------------------

const snake = s => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").toLowerCase()
const num = n => String(Math.round(n * 1000) / 1000)
/** A pair column's value at the line's lowest or highest level. */
const at = (c, cols, level) => Number(c[level === "high" ? cols[1] : cols[0]] || 0)
const percentUpDown = (strings, v) => v >= 0 ? piece(strings, "percent_up", { percent: num(v) }) : piece(strings, "percent_down", { percent: num(-v) })
const countUp = (strings, n) => piece(strings, "count_up", { count: Math.round(n) })
const groupWord = g => ELEMENT[g] ? `⟨${ELEMENT[g]}⟩` : g
// "⟨Water⟩ unit" for an element (the game draws an icon), "Dragonunit" for a race (as the game writes it)
const unitWord = g => ELEMENT[g] ? `⟨${ELEMENT[g]}⟩ unit` : `${g ?? ""}unit`

/** "this unit", "party", "Leader"... for an effect target (target code + its group column). */
function targetText(strings, code, group) {
    const g = group && group !== "(None)" ? group : ""
    switch (String(code)) {
        case "0": return piece(strings, "target_myself")
        case "1": return g ? piece(strings, "target_others_constraint", { constraint: unitWord(g) }) : piece(strings, "target_others_all")
        case "2": return piece(strings, "target_leader")
        // a party target with an explicit "no group" reads "The party", an empty one "party"
        case "5": return g ? piece(strings, "target_ally_constraint", { constraint: unitWord(g) }) : group === "(None)" ? piece(strings, "target_ally_all") : piece(strings, "target_party")
        case "7": return piece(strings, "target_trigger_puller")
        case "8": return piece(strings, "target_multiball")
        case "9": return piece(strings, "target_min_hp_absolute")
        case "10": return piece(strings, "target_min_hp_relative")
        default: return null
    }
}
/** Who triggered it, for "by ::triggerPuller::". */
function pullerText(strings, code, group) {
    const g = group && group !== "(None)" ? group : ""
    switch (String(code)) {
        case "0": return piece(strings, "target_myself")
        case "1": return piece(strings, "target_leader")
        case "5": return g ? piece(strings, "target_one_of_ally_constraint", { constraint: unitWord(g) }) : piece(strings, "target_one_of_ally_all")
        case "7": return g ? piece(strings, "target_total_of_ally_constraint_instant", { constraint: unitWord(g) }) : piece(strings, "target_total_of_ally_all_instant")
        case "9": return g ? piece(strings, "target_sum_of_ally_constraint_during", { constraint: unitWord(g) }) : "party"
        default: return null
    }
}

// effect name -> piece name where it isn't snake_case of the client name
const EFFECT_PIECE = {
    AttackPoint: "attack", SkillGaugeCharging: "skill_gauge_chaging", DebuffResistance: "debuf_resistance", FeverTimeExtension: "fever_time",
    ConditionComboBoost: "combo_boost", Hp: "hp", RatioHeal: "ratio_heal", SkillGauge: "skill_gauge", AddFeverPoint: "add_fever_point",
    AddCombo: "add_combo", FeverPoint: "fever_point", PowerFlipDamage: "power_flip_damage", EaseOfHeal: "ease_of_heal",
}
const ELEMENT_OF = { Red: "Red", Blue: "Blue", Yellow: "Yellow", Green: "Green", White: "White", Black: "Black" }

/** The effect part: "+ 50 % to attack for this unit", "For the next 9 FlipsCombo Boost [Combo +4]"... */
function effectText(strings, codes, c, level) {
    const kind = c[5], part = kind === "1" ? "whileEffect" : "whenEffect", at0 = kind === "1" ? 109 : 47
    const code = c[at0], def = codes[part][code]
    if (!def) return null
    const f = def.fields, name = def.name
    const target = f.target ? targetText(strings, c[f.target.cols[0]], c[f.target.cols[1]]) : null
    const ctx = { withoutTarget: !target, target }
    if (f.strength) { const v = at(c, f.strength.cols, level) / 1000; ctx.percent_up_down = percentUpDown(strings, v); ctx.percent = piece(strings, "percent", { percent: num(Math.abs(v)) }); ctx.strength = v }
    let key, prefix = ""
    const timed = part === "whenEffect" && /^Condition[A-Z]/.test(name) && f.frame !== undefined
    let base = name
    if (timed) base = name.slice(9)
    const el = base.match(/^(Resistance|DamageCut)(Red|Blue|Yellow|Green|White|Black|AllElement)$/)
    if (el) { ctx.element = el[2] === "AllElement" ? "All " : groupWord(el[2]) + " "; base = el[1] === "Resistance" ? "ElementResistance" : "ElementDamageCut" }
    let pieceName = EFFECT_PIECE[name] ?? EFFECT_PIECE[base] ?? snake(base)
    // separate damage multipliers have their own pieces: common_content_<x>_separated_term / condition_content_separated_term_<x>
    const sep = base.match(/^SeparatedTerm(.+)$/)
    if (sep) pieceName = timed ? "separated_term_" + snake(sep[1]) : snake(sep[1]) + "_separated_term"
    // counts (Fever gauge points, combo, activation counts): base scale, shown as "+5"
    if (f.strength && /^(AddFeverPoint|AddCombo|SetCombo|CountUp.+|CoffinBaseCountUp)$/.test(name)) ctx.count = countUp(strings, at(c, f.strength.cols, level) / 100000)
    if (f.strength && name === "CoffinBaseCountDown") ctx.count = piece(strings, "count_down", { count: Math.round(at(c, f.strength.cols, level) / 100000) })
    if (name === "ConditionComboBoost") { ctx.count = countUp(strings, at(c, f.strength.cols, level) / 100000); key = "condition_content_combo_boost" }
    // "…lasts longer" and "damage vs foes with …" name a buff or debuff
    let m
    if (!timed && (m = base.match(/^(.+?)(Up)?Extend$/))) {
        ctx.condition = conditionName(strings, m[1] + "Up") ?? conditionName(strings, m[1])
        if (ctx.condition === null) return null
        key = "common_content_condition_extend"
    } else if (!timed && (m = base.match(/^TriggerEnemy(Attack|DirectDamage|Skill)?Slayer$/))) {
        key = { Attack: "common_content_trigger_enemy_attack_slayer", DirectDamage: "common_content_trigger_enemy_slayer_for_direct_attack", Skill: "common_content_trigger_enemy_slayer_for_skill" }[m[1]] ?? "common_content_trigger_enemy_slayer"
    } else if (!timed && (m = base.match(/^(Debuff|Poison|Paralysis|Frozen|Silence|AttackPointDown|Resistance(Red|Blue|Yellow|Green|White|Black)Down)(Attack|DirectDamage|Skill)?Slayer$/))) {
        ctx.condition = conditionName(strings, m[1])
        if (ctx.condition === null) return null
        key = "common_content_condition_slayer" + ({ Attack: "_for_attack", DirectDamage: "_for_direct_attack", Skill: "_for_skill" }[m[3]] ?? "")
    } else if (!timed && (m = base.match(/^(.+)Prevent$/))) {
        ctx.condition = conditionName(strings, m[1])
        if (ctx.condition === null || !target) return null
        key = "common_content_condition_prevent"
    } else if ((m = base.match(/^PowerFlipLv(\d)DamageSlayer$/))) {
        ctx.level = m[1]; key = "common_content_power_flip_damage_lv"
    } else if ((m = base.match(/^DirectAttack(\d)$/))) {
        // Multihit: "grant this unit Multihit [2 direct hit / + 20 % to total damage dealt]" (timed) or
        // "Set this unit's direct hits to 3" (lasting); with damage it also counts as "(Category 6)"
        ctx.count = m[1]
        ctx.multihitDamage = Boolean(f.strength) && at(c, f.strength.cols, level) !== 0
        key = (timed ? "condition_content_" : "common_content_") + "aditional_direct_attack" + (ctx.multihitDamage ? "_and_damage" : "")
    }
    if (timed || name === "ConditionComboBoost") {
        key ??= "condition_content_" + pieceName
        const frames = f.frame ? at(c, f.frame.cols, level) / 100000 : 0
        const flips = f.flip_limit ? Number(c[f.flip_limit.cols[0]]) : 0
        // "For the next 6 Flips" and/or "for 30 second(s):"
        if (flips > 0) prefix += piece(strings, "flip_limit_n_times", { count: flips })
        if (frames > 0 && frames < 9e6) prefix += piece(strings, "for_second", { second: num(frames / 60) })
    } else key ??= (part === "whileEffect" ? "common_content_" : (strings["ability_description_common_content_" + pieceName] !== undefined ? "common_content_" : "instant_content_")) + pieceName
    let body = piece(strings, key.replace(/^ability_description_/, ""), ctx)
    // "(Category N)": the separate damage multiplier the effect adds to
    const category = /^(Debuff|Poison|Paralysis|Frozen|Silence|Unique|AttackPointDown|Resistance\w+Down)(DirectDamage|Skill)?Slayer$/.test(base) ? "condition_slayer"
        : base === "CharacterSlayer" ? "character_slayer" : base === "StunWinceSlayer" ? "stun_wince_slayer" : /^PowerFlipLv\dDamageSlayer$/.test(base) ? "powerflip_lv"
        : sep ? { PowerFlipDamage: "powerflip_lv", DirectDamage: "direct_damage", SkillDamage: "skill_damage", AbilityDamage: "ability_damage" }[sep[1]]
        : ctx.multihitDamage ? "direct_damage" : null
    if (body !== null && category) body += piece(strings, "separated_term_" + category) ?? ""
    // a piece that names its target unconditionally, for an effect without one: drop the dangling "for"
    if (body !== null && !target && key === "common_content_condition_extend") body = piece(strings, key, { ...ctx, target: piece(strings, "target_party"), withoutTarget: false })
    else if (body !== null && !target) body = body.replace(/\s+for\s*$/, "").replace(/\s+for\s+\)/, ")")
    if (body === null || prefix === null) return null
    return prefix + body
}

/** A condition ("only if") at a condition block. */
function conditionText(strings, codes, c, at0) {
    const def = codes.condition[c[at0]]
    if (!def) return null
    const name = def.name, group = c[at0 + 5], g = group && group !== "(None)" ? group : ""
    switch (name) {
        case "MySelf": return piece(strings, "instant_trigger_kind_myself", { constraint: unitWord(g) })
        case "LeaderCharacter": return piece(strings, "instant_trigger_kind_leader_character", { constraint: unitWord(g) })
        case "Leader": return piece(strings, "instant_trigger_kind_leader", { omittable: false })
        case "IsNotLeader": return piece(strings, "instant_trigger_kind_is_not_leader", { omittable: false })
        case "Member": {
            const n = Number(c[at0 + 3]) / 100000
            if (n >= 6 && ELEMENT[g]) return piece(strings, "instant_trigger_kind_member_element_unified", { element_full: groupWord(g) })
            return piece(strings, "instant_trigger_kind_member", { once: true, count: num(n), constraint: unitWord(g) })
        }
        case "HpHigh": return piece(strings, "during_trigger_kind_hp_high", { omittable: true, includesThreshold: true, percent: piece(strings, "percent", { percent: num(Number(c[at0 + 3]) / 1000) }), isBeforeInstantTrigger: true }).trim()
        case "HpLow": return piece(strings, "during_trigger_kind_hp_low", { omittable: true, includesThreshold: true, percent: piece(strings, "percent", { percent: num(Number(c[at0 + 3]) / 1000) }), isBeforeInstantTrigger: true }).trim()
        case "Fever": return piece(strings, "during_trigger_kind_fever", { isBeforeInstantTrigger: true }).trim()
        case "NotFever": return piece(strings, "during_trigger_kind_not_fever", { isBeforeInstantTrigger: true })?.trim() ?? null
        case "HpLowExcludesThreshold": return piece(strings, "during_trigger_kind_hp_low", { omittable: true, includesThreshold: false, percent: piece(strings, "percent", { percent: num(Number(c[at0 + 3]) / 1000) }), isBeforeInstantTrigger: true }).trim()
        default: {
            // "has Pierce", "has a buff": the while-condition piece, written before the trigger
            const m = name.match(/^Condition(Piercing|Flying|Buff|Debuff|AttackPointUp)$/)
            const cond = m ? conditionName(strings, m[1]) : null
            // who has it: "while Pierce is active for party", "... for this unit", "... for Leader"
            const who = conditionWho(strings, c[at0 + 1], c[at0 + 2])
            return cond === null || who === null ? null : piece(strings, "during_trigger_kind_condition", { condition: cond, omittable: false, triggerPuller: who, isBeforeInstantTrigger: true })?.trim() ?? null
        }
    }
}

/** Who a "while ... is active" names: this unit, Leader, party (any or all of the party), or a group's units. */
function conditionWho(strings, code, group) {
    const g = group && group !== "(None)" ? group : ""
    if (code === "") return piece(strings, "target_party")
    if (code === "0") return piece(strings, "target_myself")
    if (code === "1") return piece(strings, "target_leader")
    if (["5", "7", "9"].includes(String(code))) return g ? unitWord(g) : piece(strings, "target_party")
    return null
}

/** The "when" trigger part ("Fever is activated", "every 10 time(s)a unit Power Flips", "when a battle starts, "). */
function whenText(strings, codes, c, level) {
    const def = codes.whenTrigger[c[27]]
    if (!def) return null
    const name = def.name, f = def.fields
    const n = f.threshold ? at(c, f.threshold.cols, level) / 100000 : 1
    const puller = f.trigger_puller ? pullerText(strings, c[28], c[29]) : null
    const ctx = { once: false, omittable: !puller || (c[28] === "5" && !(c[29] && c[29] !== "(None)")), triggerPuller: puller, count: num(n), includesThreshold: true }
    let text
    switch (name) {
        case "Initial": return piece(strings, "instant_trigger_kind_first_flip")
        case "MySelf": return piece(strings, "instant_trigger_kind_myself", { constraint: unitWord(c[36]) })
        case "LeaderCharacter": return piece(strings, "instant_trigger_kind_leader_character", { constraint: unitWord(c[36]) })
        case "ElapsedTime": return piece(strings, "instant_trigger_kind_elapsed_time", { ...ctx, second: num(at(c, f.threshold.cols, level) / 6000000) })
        case "HpLow": return piece(strings, "instant_trigger_kind_hp_low", { ...ctx, percent: piece(strings, "percent", { percent: num(at(c, f.threshold.cols, level) / 1000) }) })
        case "HealHigh": return piece(strings, "instant_trigger_kind_heal_high", ctx)
        case "Combo": return piece(strings, "instant_trigger_kind_combo", ctx)
        case "FeverEnd": text = piece(strings, "instant_trigger_kind_feverend", ctx); break
        case "AbilityDamage": text = piece(strings, "instant_trigger_kind_abiility_damage", ctx); break
        case "MemberDirectAttack": text = piece(strings, "instant_trigger_kind_direct_attack", ctx); break
        // "When 3 or more Dragon units are in the party" (a line that fires once: limit 1)
        case "Member": return piece(strings, "instant_trigger_kind_member", { ...ctx, once: c[34] === "1", count: num(n), constraint: unitWord(c[36] && c[36] !== "(None)" ? c[36] : "") })
        case "ElementVariety": case "RaceVariety": case "SpecialityVariety":
            return piece(strings, "instant_trigger_kind_variety", { ...ctx, once: true, varietyKind: piece(strings, { ElementVariety: "variety_element", RaceVariety: "variety_race", SpecialityVariety: "variety_speciality" }[name]) })
        case "PowerFlipLv1": case "PowerFlipLv2": case "PowerFlipLv3":
            text = piece(strings, "instant_trigger_kind_power_flip_lv", { ...ctx, level: name.slice(-1) }); break
        default: text = piece(strings, "instant_trigger_kind_" + snake(name), ctx)
    }
    if (text === null) return null
    // for combo triggers the number is the combo itself ("the combo reaches 30"), not "every N times"
    if (!(n > 1) || /^Combo/.test(name)) return text
    // "damage is taken by Leader →", "a direct hit is dealt by this unit →": the game shows no count for these
    if (name === "DamageCount" || name === "MemberDirectAttack") return text
    // "every N time(s)" goes where the piece has its "::if once::" slot: in front ("Every 20 time(s)a party member...")
    // or after ("Dragonunit a skill hits every 20 time(s)")
    const raw = String(strings["ability_description_instant_trigger_kind_" + snake(name)] ?? "").replace(/^"/, "").trim()
    const every = piece(strings, "n_times", { count: num(n) })
    // "every N time(s)" goes in front ("Every 4 time(s)this unit destroys a foe"), or after when the trigger names who
    // did it ("a skill hits every 20 time(s)", "a skill is activated by ⟨Fire⟩ unitevery 3 time(s)")
    return raw.includes("::triggerPuller::") && !ctx.omittable ? text + every : every + text
}

/** The "while" trigger part ("while in Fever Mode, ", "for each 1 Power Flip Damage Buff party has, "). */
function whileText(strings, codes, c, level) {
    const def = codes.whileTrigger[c[97]]
    if (!def) return null
    const name = def.name, f = def.fields
    const puller = f.trigger_puller ? pullerText(strings, c[98], c[99]) : null
    const partyCount = !f.trigger_puller && /^ConditionCount/.test(name)
    const ctx = { omittable: partyCount ? false : !puller, triggerPuller: partyCount ? piece(strings, "target_party") : puller, includesThreshold: true, isBeforeInstantTrigger: false, hasAccumulationTrigger: false, isPrecondition: false }
    const thr = f.threshold ? at(c, f.threshold.cols, level) : 0
    let m
    if (name === "HpHigh" || name === "HpLow") return piece(strings, "during_trigger_kind_" + snake(name), { ...ctx, percent: piece(strings, "percent", { percent: num(thr / 1000) }) })
    if (name === "HpLowExcludesThreshold") return piece(strings, "during_trigger_kind_hp_low", { ...ctx, includesThreshold: false, percent: piece(strings, "percent", { percent: num(thr / 1000) }) })
    if ((m = name.match(/^OneOfEnemyConditionCount(.+)$/))) {
        const cond = conditionName(strings, m[1])
        return cond === null ? null : piece(strings, "during_trigger_kind_one_of_enemy_condition_high_count", { ...ctx, count: num(thr / 100000), condition: cond, decidedTarget: false })
    }
    if ((m = name.match(/^ConditionCount(.+)$/))) {
        const cond = conditionName(strings, m[1])
        return cond === null ? null : piece(strings, "during_trigger_kind_condition_high_count", { ...ctx, count: num(thr / 100000), condition: cond })
    }
    if ((m = name.match(/^Condition(.+)$/))) {
        const cond = conditionName(strings, m[1]), who = conditionWho(strings, c[98], c[99])
        return cond === null || who === null ? null : piece(strings, "during_trigger_kind_condition", { ...ctx, condition: cond, omittable: false, triggerPuller: who })
    }
    if (name === "ComboHigh" || name === "ComboLow") return piece(strings, "during_trigger_kind_" + snake(name), { ...ctx, count: num(thr / 100000) })
    return piece(strings, "during_trigger_kind_" + snake(name), { ...ctx, count: num(thr / 100000), percent: piece(strings, "percent", { percent: num(thr / 1000) }) })
}
/** "Power Flip Damage Buff" for a condition (buff) name such as PowerFlipDamageUp. */
function conditionName(strings, n) {
    // states with their own name (Pierce, Levitate, Poisoned...)
    const own = { Piercing: "piercing", Flying: "flying", Poison: "poison", Paralysis: "paralysis", Frozen: "enemy_frozen", StunParalysis: "stun_paralysis" }[n]
    if (own) return piece(strings, "condition_target_" + own)
    if (n === "Buff") return piece(strings, "condition_target_good_all")
    if (n === "Debuff") return piece(strings, "condition_target_bad_all")
    let m
    if ((m = n.match(/^Resistance(Red|Blue|Yellow|Green|White|Black)(Up|Down)$/)))
        return piece(strings, `condition_target_${m[2] === "Up" ? "good" : "bad"}_resistance`, { element: groupWord(m[1]) })
    const good = !/Down$/.test(n), base = n.replace(/(Up|Down)$/, "").replace(/^AttackPoint$/, "Attack")
    const s = snake(base)
    for (const k of [s, s.replace("power_flip", "powerflip"), s === "buff" || s === "debuff" ? "all" : null].filter(Boolean)) {
        const t = piece(strings, `condition_target_${good ? "good" : "bad"}_${k}`)
        if (t !== null) return t
    }
    return null
}

/** A line split into what the game groups by (conditions + trigger) and the effect, or null when not covered. */
function lineParts(c, level, strings, codes) {
    const kind = c[5]
    const conds = []
    for (const at0 of codes.blocks.condition) if (c[at0] && c[at0] !== "0") {
        const t = conditionText(strings, codes, c, at0)
        if (t === null) return null
        conds.push(t)
    }
    let effect = effectText(strings, codes, c, level)
    if (effect === null) return null
    const part = kind === "1" ? "whileEffect" : "whenEffect", def = codes[part][c[kind === "1" ? 109 : 47]]
    const timed = /^(For the next|for \S+ second)/.test(effect)
    // one-off effects (skill gauge, Fever gauge, barrier...) vs lasting ones (attack, HP...)
    const oneOff = kind === "0" && Boolean(def) && !/^Condition/.test(def.name) && !/^(Hp|AdditionalUnison.+)$/.test(def.name)
        && strings["ability_description_common_content_" + snake(def.name)] === undefined && !/(Slayer|Extend|Prevent)$/.test(def.name)
        && !["AttackPoint", "SkillDamage", "DirectDamage", "PowerFlipDamage", "SkillGaugeCharging", "FeverPoint", "EaseOfHeal"].includes(def.name) && !/^(Resistance|DamageCut)/.test(def.name)
    let head, condHead = "", battleStart = false
    if (kind === "0") {
        const trig = whenText(strings, codes, c, level)
        if (trig === null) return null
        battleStart = c[27] === "0"
        // a "while ..." condition runs straight into the trigger: "while Pierce is active for party a unit Power Flips →"
        head = ""
        conds.forEach((t, k) => { head += t + (/^while\b/i.test(t) && k === conds.length - 1 ? " " : " → ") })
        condHead = conds.length ? conds.join(" → ") + " → " : ""
        head += trig + (/,\s*$/.test(trig) ? "" : " → ")
        const limit = Number(c[34])
        if (def?.fields?.strength && limit > 1) {
            if (oneOff) effect = piece(strings, "instant_trigger_limit_n_times", { count: limit }) + effect
            else if (!timed) effect += piece(strings, "instant_max_strength", { max_strength: percentUpDown(strings, at(c, def.fields.strength.cols, level) / 1000 * limit) })
        }
        const cool = Number(c[35])
        if (cool > 0) effect += piece(strings, "cooltime", { second: num(cool / 60) })
    } else if (kind === "1") {
        const trig = whileText(strings, codes, c, level)
        if (trig === null) return null
        head = (conds.length ? conds.join(" → ") + " → " : "") + trig
        const limit = Number(c[102])
        if (def?.fields?.strength && limit > 1) effect += piece(strings, "instant_max_strength", { max_strength: percentUpDown(strings, at(c, def.fields.strength.cols, level) / 1000 * limit) })
    } else return null
    return { kind, head, condHead, battleStart, effect, timed, oneOff, hasTarget: Boolean(def?.fields?.target), mark: c[1] === "false" ? "Ⓜ " : "" }
}

// tidy spaces; capital first letter, except after the Ⓜ mark (the game writes "Ⓜ while Pierce...", "Ⓜ a skill...")
const finish = (s, mark) => { s = s.replace(/ {2,}/g, " ").replace(/ ,/g, ",").trim(); return mark ? mark + s : s.charAt(0).toUpperCase() + s.slice(1) }

/**
 * A whole ability (its lines) in the game's words at its lowest or highest level (abilities: first / sixth Mana node;
 * leader: before / after awakening): lines with the same conditions and trigger are one sentence, their effects
 * joined with "&"; a new trigger starts a new paragraph (another entry of the result). Lines not covered come back as
 * null in their place.
 */
function abilityText(lines, level, strings, codes) {
    const parts = lines.map(c => lineParts(c, level, strings, codes))
    // lines with the same conditions and trigger are one sentence, wherever they are in the ability (first one's place)
    const groups = []
    for (const p of parts) {
        if (p === null) { groups.push(null); continue }
        // on battle start with a lasting effect, one without a target stands alone ("Power Flip damage + 70 %")
        const alone = p.battleStart && !p.oneOff && !p.hasTarget
        const g = alone ? null : groups.find(x => x && !x.alone && x[0].kind === p.kind && x[0].head === p.head && x[0].mark === p.mark)
        if (g) g.push(p)
        else { const n = [p]; n.alone = alone; groups.push(n) }
    }
    return groups.map(group => {
        if (group === null) return null
        const p = group[0]
        let body = group[0].effect
        // the game writes " & " before a number ("& + 4 % to attack") and "&" before words ("&Power Flip damage", "&for 3 second(s)")
        for (let k = 1; k < group.length; k++) body += (group[k].hasTarget && !group[k].timed ? " & " : "&") + group[k].effect
        // "when a battle starts," is only written for one-off effects ("When a battle starts, + 50 % to Skill Gauge...")
        const head = p.battleStart && !group.some(g => g.oneOff) ? p.condHead : p.head
        return finish(head + body, p.mark)
    })
}

/** One line in the game's words (see abilityText), or null when a part isn't covered yet. */
function lineText(c, level, strings, codes) {
    return abilityText([c], level, strings, codes)[0]
}

module.exports = { lineText, abilityText, render }
