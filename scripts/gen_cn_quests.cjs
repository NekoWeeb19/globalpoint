// Adds the quests only the CN client has (CN-only events) to the server's quest files, so their
// battles can be played from the CN app. Global's quests are left as they are.
//
// No column list is written down by hand: for each quest file, every field (clearRewardId, rank times,
// rewards...) is matched to the CN table column that holds the same value for the quests both clients
// have (most of them must agree), then CN-only rows are read through those columns. Fields no column
// explains are reported and get the value most shared quests have.
//
// Quest files whose rewards point at ids the server doesn't know yet are reported (clear_reward.json,
// score_reward.json); scripts/gen_cn_rewards.cjs adds those.
//
// Some event numbers are different events in the two games (advent 100006: global's Re:ZERO collab rerun, CN's
// Haruhi collab; 100007: global's Uma collab, CN's Lightcrest Serpent rerun): their quests keep global's rows, but a
// quest can even be a story chapter in one game and a battle in the other. Every event with a shared quest whose
// rewards (or battle/story) differ from CN's row gets CN's rows in assets/quest_overrides_cn.json, which the CN app
// is paid from (src/lib/assets.ts getQuestFromCategorySync).
//
// Also written: assets/advent_coins_cn.json, each CN boss event's own coins (CN's advent_event columns 17-19:
// Silver, Gold, Lilac). CN's reruns pay from the original run's reward lists but their shops charge their own
// coins; the CN app gets the event's own (src/lib/cnCoinSwaps.ts).
//
//   node scripts/gen_cn_quests.cjs [--dry]
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")

const ROOT = path.join(__dirname, "..")
const DRY = process.argv.includes("--dry")

// server quest file -> CN table (event quest tables are keyed "<event>/<n>"; column 0 is the quest id)
const FILES = {
    story_event_single_quest: "story_event_single_quest",
    world_story_event_quest: "world_story_event_quest",
    world_story_event_boss_battle_quest: "world_story_event_boss_battle_quest",
    advent_event_quest: "advent_event_quest",
    carnival_event_quest: "carnival_event_quest",
    rush_event_quest: "rush_event_quest",
    ranking_event_single_quest: "ranking_event_single_quest",
    hard_multi_event_quest: "hard_multi_event_quest",
    // a full logical path when the table isn't an event quest table
    boss_battle_quest: "master/quest/boss_battle_quest",
}

const num = v => (v === undefined || v === "" || v === "(None)" ? null : Number(v))
const TRANSFORMS = {
    int: v => { const n = num(v); return n === null || isNaN(n) ? null : Math.trunc(n) },
    ms: v => { const n = num(v); return n === null || isNaN(n) ? null : Math.floor(n * 1000) },
    intOr0: v => { const n = num(v); return n === null || isNaN(n) ? 0 : Math.trunc(n) },
    msOr0: v => { const n = num(v); return n === null || isNaN(n) ? 0 : Math.floor(n * 1000) },
}

/** field -> { col, transform } learned from the quests both have, plus what couldn't be learned. */
function learn(entries, cnRows, keyOf) {
    const shared = cnRows.filter(r => entries[keyOf(r)] !== undefined)
    const fields = new Set()
    for (const r of shared) for (const [k, v] of Object.entries(entries[keyOf(r)])) if (typeof v === "number") fields.add(k)
    const plan = {}, unknown = []
    const claimed = new Set()
    for (const field of fields) {
        const have = shared.filter(r => typeof entries[keyOf(r)][field] === "number")
        const width = Math.max(...have.map(r => r.cols.length))
        const candidates = []
        for (let col = 0; col < width; col++) for (const [name, t] of Object.entries(TRANSFORMS)) {
            let ok = 0
            for (const r of have) if (t(r.cols[col]) === entries[keyOf(r)][field]) ok++
            // prefer columns that vary (a constant column explains a constant field by chance)
            const distinct = new Set(have.map(r => r.cols[col])).size
            candidates.push({ col, transform: name, score: ok / have.length + (distinct > 1 ? 0.001 : 0) })
        }
        const top = Math.max(...candidates.map(c => c.score))
        // among equally good columns, one no earlier field uses (unit EXP and pool EXP often hold the
        // same numbers, but are different columns)
        const best = candidates.find(c => c.score === top && !claimed.has(c.col)) ?? candidates.find(c => c.score === top)
        // few shared quests: the best column is still better than a guess
        if (best && (best.score >= 0.9 || (have.length < 10 && best.score >= 0.5))) { plan[field] = best; claimed.add(best.col) }
        else {
            const counts = new Map()
            for (const r of have) { const v = entries[keyOf(r)][field]; counts.set(v, (counts.get(v) ?? 0) + 1) }
            const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
            plan[field] = { constant: common, score: best?.score ?? 0 }
            unknown.push(`${field} (best column ${best?.col} at ${Math.round((best?.score ?? 0) * 100)}%, using ${common})`)
        }
    }
    return { plan, unknown, shared: shared.length }
}

;(async () => {
    const clearRewards = require(path.join(ROOT, "assets", "clear_reward.json"))
    const scoreRewards = require(path.join(ROOT, "assets", "score_reward.json"))
    const missing = { clear: new Set(), score: new Set() }
    const report = {}
    const overrides = {}
    for (const [file, table] of Object.entries(FILES)) {
        const assetFile = path.join(ROOT, "assets", `${file}.json`)
        if (!fs.existsSync(assetFile)) continue
        const entries = JSON.parse(fs.readFileSync(assetFile, "utf8"))
        const cn = await readCnTable(table.startsWith("master/") ? `${table}.orderedmap` : `master/quest/event/${table}.orderedmap`)
        if (!cn) { report[file] = "no CN table"; continue }
        // entries this script added before are made again
        for (const [id, e] of Object.entries(entries)) if (e.cn) delete entries[id]
        const rows = Object.entries(cn).map(([p, line]) => ({ p, cols: R.splitCsv(line.replace(/\n$/, "")) }))
        const keyOf = r => r.cols[0]
        // battle quests (with rewards) and story quests (name + clear reward only) are learned apart
        const battle = Object.fromEntries(Object.entries(entries).filter(([, e]) => "rankPointReward" in e))
        const story = Object.fromEntries(Object.entries(entries).filter(([, e]) => !("rankPointReward" in e)))
        const battlePlan = learn(battle, rows, keyOf)
        const storyPlan = learn(story, rows, keyOf)
        // a CN-only row is a battle when it has the column the battle plan reads rank points from
        const rpCol = battlePlan.plan.rankPointReward?.col
        const added = []
        // CN's own row for a quest, read through the learned columns
        const cnEntry = (r, isBattle) => {
            const { plan } = isBattle ? battlePlan : storyPlan
            const entry = { name: "" }
            for (const [field, how] of Object.entries(plan)) entry[field] = "constant" in how ? how.constant : (TRANSFORMS[how.transform](r.cols[how.col]) ?? 0)
            return entry
        }
        const cnIsBattle = r => storyPlan.shared === 0 || (rpCol !== undefined && TRANSFORMS.int(r.cols[rpCol]) !== null)
        // events whose shared quests aren't CN's (a different event under the same number)
        const clashEvents = new Set()
        for (const r of rows) {
            const id = keyOf(r)
            if (!/^\d+$/.test(id) || entries[id] === undefined || entries[id].cn) continue
            const ours = entries[id], battle = cnIsBattle(r), cn = cnEntry(r, battle)
            const differs = battle !== ("rankPointReward" in ours)
                || ["scoreRewardGroup", "clearRewardId", "sPlusRewardId"].some(f => (cn[f] ?? 0) !== (ours[f] ?? 0))
            if (differs) clashEvents.add(Math.floor(Number(id) / 1000))
        }
        for (const r of rows) {
            const id = keyOf(r)
            if (!/^\d+$/.test(id) || entries[id] === undefined || entries[id].cn || !clashEvents.has(Math.floor(Number(id) / 1000))) continue
            const entry = cnEntry(r, cnIsBattle(r))
            ;(overrides[file] ??= {})[id] = entry
            if (entry.clearRewardId !== undefined && clearRewards[entry.clearRewardId] === undefined) missing.clear.add(entry.clearRewardId)
            if (entry.scoreRewardGroup !== undefined && scoreRewards[entry.scoreRewardGroup] === undefined) missing.score.add(entry.scoreRewardGroup)
        }
        if (clashEvents.size > 0) console.log(`${file}: CN's own rows for event(s) ${[...clashEvents].join(", ")} (a different event in global)`)
        for (const r of rows) {
            const id = keyOf(r)
            if (!/^\d+$/.test(id) || entries[id] !== undefined) continue
            // a file with no story quests (trials, raids...) only has battles
            const isBattle = storyPlan.shared === 0 || (rpCol !== undefined && TRANSFORMS.int(r.cols[rpCol]) !== null)
            const { plan } = isBattle ? battlePlan : storyPlan
            const entry = { name: "" }
            for (const [field, how] of Object.entries(plan)) {
                if ("constant" in how) entry[field] = how.constant
                else entry[field] = TRANSFORMS[how.transform](r.cols[how.col]) ?? 0
            }
            if (file === "rush_event_quest") entry.rushEventId = Number(r.p.split("/")[0])
            entry.cn = true
            entries[id] = entry
            added.push(id)
            if (entry.clearRewardId !== undefined && clearRewards[entry.clearRewardId] === undefined) missing.clear.add(entry.clearRewardId)
            if (entry.sPlusRewardId !== undefined && clearRewards[entry.sPlusRewardId] === undefined) missing.clear.add(entry.sPlusRewardId)
            if (entry.scoreRewardGroup !== undefined && scoreRewards[entry.scoreRewardGroup] === undefined) missing.score.add(entry.scoreRewardGroup)
        }
        report[file] = {
            added: added.length,
            battleFields: Object.fromEntries(Object.entries(battlePlan.plan).map(([f, h]) => [f, "constant" in h ? `=${h.constant}` : `${h.transform}(${h.col}) ${Math.round(h.score * 100)}%`])),
            unknown: [...battlePlan.unknown, ...storyPlan.unknown.map(u => "story " + u)],
            sharedBattle: battlePlan.shared, sharedStory: storyPlan.shared,
        }
        if (!DRY && added.length) fs.writeFileSync(assetFile, JSON.stringify(entries))
    }
    if (!DRY) fs.writeFileSync(path.join(ROOT, "assets", "quest_overrides_cn.json"), JSON.stringify(overrides))
    // each CN boss event's own coins: { event id: [Silver, Gold, Lilac] } (null where it has none)
    const adventCoins = {}
    for (const [id, line] of Object.entries(await readCnTable("master/quest/event/advent_event.orderedmap"))) {
        const c = R.splitCsv(line.replace(/\n$/, ""))
        const coins = [17, 18, 19].map(i => TRANSFORMS.int(c[i]))
        if (coins.some(x => x !== null)) adventCoins[id] = coins
    }
    if (!DRY) fs.writeFileSync(path.join(ROOT, "assets", "advent_coins_cn.json"), JSON.stringify(adventCoins))
    console.log(`advent coins: ${Object.keys(adventCoins).length} CN boss events`)
    console.log(JSON.stringify(report, null, 1))
    console.log(`missing clear rewards: ${[...missing.clear].join(",") || "none"}; missing score groups: ${[...missing.score].join(",") || "none"}`)
})().catch(e => { console.error(e); process.exit(1) })
