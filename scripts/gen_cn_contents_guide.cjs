// Builds assets/contents_guide_cn.json: the CN client's Content Guide ("Next Recommendation" on the home
// screen; CN active mission event 2, 17 missions), so the server can track and pay them like the other
// active missions (src/nya/activeMissionData.ts, src/lib/activeMissionProgress.ts awakeBattleMatches).
//
// CN active_mission columns used (as read by this script; the client's parser numbers them 2 lower):
//   0 event (2 = Content Guide), 3 name, 4 text, 29 kind, 32 battle mode (1 solo, 2 co-op, 3 either),
//   34..37 quest range (kind, query 1..3), 43 the unit (kinds 71/72/73), 46 the leader (kind 70),
//   69 unit element (1-based: 1 fire ... 6 dark), 70 armament element, 71 skill effects (kind 90),
//   56/57 the mission (and stage) that must be claimed first.
// Kinds: 74 opened the guide (contents_guide/start), 70 clear with the unit as leader, 71 clear with the
// unit's abilities 4-6 learned, 72/73 clear with the unit at Lv80/Lv100, 23 clear battles in a quest
// range, 89 clear with a unit of an element, 90 clear with a unit whose skill has an effect, 91 clear
// with every skill gauge full at the start (not checkable here: any clear counts).
// active_mission_reward columns: 7 kind (0 beads, 1 item, 2 armament, 3 mana, 4 unit), 8 amount,
// 9 item, 10 unit, 11 armament.
//
//   node scripts/gen_cn_contents_guide.cjs     (CN_TRANSLATED_DIR: the translated text, for skill text)
const fs = require("fs")
const path = require("path")
const { readCnTable } = require("F:/WF client/tools/cn_read.cjs")
const { recordsOf } = require("./gen_cn_text.cjs")
const R = require("./cdn_rows.cjs")

const ROOT = path.join(__dirname, "..")
const OUT = path.join(ROOT, "assets", "contents_guide_cn.json")
const TRANSLATED = process.env.CN_TRANSLATED_DIR ?? "F:/WF client/globalize/text33"
const NONE = v => v === undefined || v === "" || v === "(None)"
const int = v => NONE(v) ? undefined : Number(v)

// skill effect names -> what the English skill text says (kind 90)
const EFFECT_WORDS = [
    [/ToleranceOfElement_Down/, /resist(ance)?\s+down/i],
    [/Heal|Regen/, /\bheal|\bregen|recover(s|ing)?\s+(hp|health)|restores?\s+hp/i],
]

/** The English skill text of every unit (translated action_skill + the units' skill keys). */
async function unitSkillTexts() {
    const names = require("F:/WF client/globalize/table_names.json")
    const inv = Object.fromEntries(Object.entries(names).map(([k, v]) => [v, k]))
    const files = new Map(JSON.parse(fs.readFileSync(path.join(TRANSLATED, "files.json"), "utf8")).map(f => [f.path, f.from]))
    const skillFile = files.get(inv["master/skill/action_skill"])
    const skills = {}
    if (skillFile) for (const { path: key, leaf } of R.leaves(R.decodeFile(fs.readFileSync(skillFile)))) {
        (skills[key[0]] ??= []).push(leaf.text)
    }
    const units = {}
    for (const [id, text] of Object.entries(await readCnTable("master/character/character.orderedmap"))) {
        const c = recordsOf(String(text))[0] ?? []
        const skillKey = NONE(c[8]) ? c[0] : c[8]
        units[id] = (skills[skillKey] ?? []).join(" ")
    }
    return units
}

;(async () => {
    const rows = await readCnTable("master/active_mission/active_mission.orderedmap")
    const rewardRows = await readCnTable("master/active_mission/active_mission_reward.orderedmap")
    const skillTexts = await unitSkillTexts()
    const missions = {}
    for (const [id, text] of Object.entries(rows)) {
        const c = recordsOf(String(text))[0] ?? []
        if (c[0] !== "2") continue
        const kind = int(c[29])
        const rule = { kind, mode: int(c[32]) ?? 3 }
        if (!NONE(c[34]) && kind !== 74) rule.range = [Number(c[34]), NONE(c[35]) ? null : c[35], NONE(c[36]) ? null : c[36], NONE(c[37]) ? null : c[37]]
        if (kind === 70) rule.leader = int(c[46])
        if (kind === 71) { rule.character = int(c[43]); rule.abilitySlots = ["4", "5", "6"] }
        if (kind === 72) { rule.character = int(c[43]); rule.minLevel = 80 }
        if (kind === 73) { rule.character = int(c[43]); rule.minLevel = 100 }
        if (kind === 89) rule.element = int(c[69]) - 1
        if (kind === 90) {
            const effects = c[71] ?? ""
            const words = EFFECT_WORDS.filter(([effect]) => effect.test(effects)).map(([, w]) => w)
            rule.anyOf = Object.entries(skillTexts).filter(([, t]) => words.some(w => w.test(t))).map(([unit]) => Number(unit))
        }
        const stages = {}
        for (const [key, r] of Object.entries(rewardRows)) {
            const [missionId, stage] = key.split("/")
            if (missionId !== id) continue
            const rc = recordsOf(String(r))[0] ?? []
            const rewardKind = int(rc[7]), amount = int(rc[8]) ?? 0
            const reward = rewardKind === 0 ? { type: "free_vmoney", amount }
                : rewardKind === 1 ? { type: "item", id: int(rc[9]), amount }
                : rewardKind === 2 ? { type: "equipment", id: int(rc[11]), amount }
                : rewardKind === 3 ? { type: "free_mana", amount }
                : rewardKind === 4 ? { type: "character", id: int(rc[10]), amount: 1 }
                : null
            if (reward === null) throw new Error(`mission ${id}: unknown reward kind ${rc[7]}`)
            ;(stages[stage ?? "1"] ??= []).push(reward)
        }
        // the mission before it (56 mission, 57 stage): the client shows this one, and it counts, only
        // once that stage has been claimed
        const prerequisite = NONE(c[56]) ? undefined : { mission: Number(c[56]), stage: int(c[57]) ?? 1 }
        missions[id] = { name: c[3], text: c[4], rule, requirements: { "1": 1 }, stages, ...(prerequisite ? { prerequisite } : {}) }
    }
    fs.writeFileSync(OUT, JSON.stringify({ missions }, null, 1))
    const counts = Object.values(missions).map(m => `${m.name}:${m.rule.kind}${m.rule.anyOf ? `(${m.rule.anyOf.length} units)` : ""}`)
    console.log(`Wrote ${OUT}: ${Object.keys(missions).length} missions\n${counts.join(", ")}`)
})().catch(e => { console.error(e); process.exit(1) })
