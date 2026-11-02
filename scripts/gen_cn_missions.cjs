// Builds assets/missions_cn.json: the missions the CN client lists, from its own mission tables, in
// the same shape as assets/missions.json (scripts/gen_missions.cjs) so the same mission code serves
// both clients. The server picks this file for requests from the CN client (src/nya/mission.ts).
//
// CN's tables are global's with three more columns before the dates, and CN numbers mission kinds
// differently (it added kinds): CN kind -> global kind is worked out below from the ~3,900 missions
// both have (same id and same pattern name). CN-only kinds become -1 (not tracked).
//
// Each table is read from the newest copy the CN client has: the dashboard schedule's files
// (.cdn/cn_schedule_files, so the dates match what the client shows), else the translated tables
// (CN_TRANSLATED_DIR), else the CN game files. CN dates are China time (UTC+8): stored here as UTC.
//
// "distinct" lists, per category, the mission ids global ALSO has but for another mission; the
// server keeps their progress apart from global's.
//
//   node scripts/gen_cn_missions.cjs
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readTable, parseCsvLine, str, int } = require("./cdn_master.cjs")
const { CATEGORIES, parseRewardRow } = require("./gen_missions.cjs")
const { hashed, readCn } = require("./cn_read.cjs")

const ROOT = path.join(__dirname, "..")
const OUT = path.join(ROOT, "assets", "missions_cn.json")
const SCHEDULED = path.join(ROOT, ".cdn", "cn_schedule_files")
const TRANSLATED = require("./cn_archives.cjs").cnTextDir()

// CN layouts: global's plus three columns before the dates
const LAYOUT = { pattern: 0, text: 1, kind: 2, params: 3, prerequisite: 18, start: 25, end: 26 }
const CAMPAIGN_LAYOUT = { group: 0, pattern: 2, text: 3, kind: 4, params: 5, prerequisite: 20, start: 27, end: 28 }
const DEGREE_LAYOUT = { group: 0, pattern: 1, text: 2, kind: 3, params: 4, prerequisite: 19, start: 26, end: 27 }
// the pass ("The Way of Practice") missions: column 0 is the pass, the rest is the regular layout one
// column on. Categories as the CN client numbers them (6 daily, 7 weekly, 8 for the whole pass).
const PASS_LAYOUT = { group: 0, pattern: 1, text: 2, kind: 3, params: 4, prerequisite: 19, start: 26, end: 27 }
const PASS_TABLES = { 6: "pass_card_daily_mission", 7: "pass_card_week_mission", 8: "pass_card_event_mission" }

/** CN mission kind -> global kind (-1: CN-only, not tracked). From the shared missions. */
function globalKind(cn) {
    // CN-only kinds the server counts under its own numbers (COUNTER_KINDS in src/lib/mission.ts)
    if (cn === 78) return 1078 // pull a unit summon N times
    if (cn === 88) return 1088 // view your own profile
    if (cn <= 9) return cn
    if (cn === 11) return 10
    if (cn >= 13 && cn <= 37) return cn - 2
    if (cn >= 39 && cn <= 77) return cn - 3
    if (cn >= 79 && cn <= 85) return cn - 4
    if (cn >= 86 && cn <= 87) return cn - 5
    return -1
}

const OFFSET = 8 * 3600 * 1000
function utc(value) {
    const v = str(value)
    if (v === null) return null
    const ms = Date.parse(v.replace(" ", "T") + "Z")
    return isNaN(ms) ? v : new Date(ms - OFFSET).toISOString().slice(0, 19).replace("T", " ")
}

/** A CN table (by logical path) as { "key/key": csv line }, from the newest copy. */
async function cnTable(logical) {
    const file = hashed(logical)
    const listFile = path.join(TRANSLATED, "files.json")
    const translatedFrom = new Map(fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, "utf8")).map(f => [f.path, f.from]) : [])
    let buf = null
    for (const p of [path.join(SCHEDULED, file), translatedFrom.get(file), path.join(TRANSLATED, file)]) {
        if (p && fs.existsSync(p)) { buf = fs.readFileSync(p); break }
    }
    buf ??= await readCn(logical)
    if (buf === null) throw new Error(`CN table not found: ${logical}`)
    const out = {}
    for (const { path: keys, leaf } of R.leaves(R.decodeFile(buf))) out[keys.join("/")] = leaf.text.replace(/\n$/, "")
    return out
}

;(async () => {
    const missions = {}, distinct = {}
    // "distinct" needs global's mission tables (.cdn/en); without them (a shared package) the lists
    // already in assets/missions_cn.json are kept: they don't depend on the schedule
    const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")).distinct ?? {} : {}
    const globalTable = async table => { try { return await readTable(table, false) } catch { return null } }
    const untracked = {}
    const tables = [
        ...Object.entries(CATEGORIES).map(([category, table]) => [category, `master/mission/${table}`]),
        ...Object.entries(PASS_TABLES).map(([category, table]) => [category, `master/pass_card/${table}`]),
    ]
    for (const [category, table] of tables) {
        const isPass = PASS_TABLES[category] !== undefined
        const definitions = await cnTable(`${table}.orderedmap`)
        const rewardRows = await cnTable(`${table}_reward.orderedmap`)
        const globalDefinitions = isPass ? {} : await globalTable(`${table}.orderedmap`)
        const rewards = {}
        for (const [key, line] of Object.entries(rewardRows)) {
            const [id, stage] = key.split("/")
            if (stage !== undefined) (rewards[id] ??= {})[stage] = line
        }
        const at = isPass ? PASS_LAYOUT : category === "4" ? CAMPAIGN_LAYOUT : category === "5" ? DEGREE_LAYOUT : LAYOUT
        const out = {}
        distinct[category] = []
        for (const [id, line] of Object.entries(definitions)) {
            const c = parseCsvLine(line)
            const stages = Object.entries(rewards[id] ?? {})
                .map(([stage, rewardLine]) => ({ stage: Number(stage), ...parseRewardRow(rewardLine, category === "4" ? 1 : 0) }))
                .sort((a, b) => a.stage - b.stage)
            if (stages.length === 0 || stages.some((s, i) => s.stage !== i + 1)) continue
            const cnKind = int(c[at.kind])
            // pass missions a single player can't do (CN 85 send emotes, CN 20 answer help requests):
            // the server completes them at login (COUNTER_KINDS.SOLO_AUTO_COMPLETE)
            const kind = cnKind === null ? null : isPass && (cnKind === 85 || cnKind === 20) ? 1999 : globalKind(cnKind)
            if (kind === -1) untracked[cnKind] = (untracked[cnKind] ?? 0) + 1
            out[id] = {
                ...(at.group === undefined ? {} : { group: int(c[at.group]) }),
                pattern: c[at.pattern],
                text: c[at.text],
                kind,
                params: c.slice(at.params, at.params + 15).map(str),
                prerequisite: int(c[at.prerequisite]) === null ? null : [int(c[at.prerequisite]), int(c[at.prerequisite + 1]) ?? 1],
                start: utc(c[at.start]),
                end: utc(c[at.end]),
                stages: stages.map(({ target, rewardId, timeLimitSeconds, rewards }) => ({ target, rewardId, ...(timeLimitSeconds === undefined ? {} : { timeLimitSeconds }), rewards })),
            }
            const g = globalDefinitions?.[id]
            if (g !== undefined && parseCsvLine(g)[at.pattern] !== out[id].pattern) distinct[category].push(Number(id))
        }
        if (globalDefinitions === null) distinct[category] = previous[category] ?? []
        missions[category] = out
        console.log(`category ${category}: ${Object.keys(out).length} missions (${distinct[category].length} ids differ from global)`)
    }
    fs.writeFileSync(OUT, JSON.stringify({
        _note: "The CN client's missions (scripts/gen_cn_missions.cjs), shaped like missions.json: kinds are global's numbers (-1 = CN-only kind, not tracked), dates UTC. 'distinct': ids global uses for other missions.",
        distinct,
        missions,
    }))
    console.log(`Wrote ${OUT}; untracked CN kinds: ${JSON.stringify(untracked)}`)
})().catch(error => {
    console.error(error)
    process.exit(1)
})
