// Builds assets/missions.json (regular, daily and event missions) from the global client's own
// master tables in the CDN archives (.cdn/en/archive-common-*).
//
//   node scripts/gen_missions.cjs
//
// The CDN file names are SHA1(<logical path> + salt); the tables are "orderedmap" files (a zlib'd
// index of keys, then one zlib'd CSV row per key). Both rules come from the Chinese StarPoint fork
// (src/content/cdn/asset-path-hash.ts and src/content/sync/ordered-map.ts).

const path = require("path")
const fs = require("fs")
const { ROOT, readTable, parseCsvLine, str, int } = require("./cdn_master.cjs")

const OUT = path.join(ROOT, "assets", "missions.json")

const CATEGORIES = {
    1: "regular_mission",
    2: "daily_mission",
    3: "event_mission",
    4: "collect_item_event_mission",
    5: "degree_mission",
}

// Where each field is. Campaign missions (category 4, collect_item_event_mission: the event "Promo
// Missions" rounds and the Kaleido Drops collections) put the campaign group and its code in front,
// so their fields sit two columns later; their params line up with the others (params[9] is the item
// to collect, params[14] the missions an "all clear" needs).
const LAYOUT = { pattern: 0, text: 1, kind: 2, params: 3, prerequisite: 18, start: 20, end: 21 }
const CAMPAIGN_LAYOUT = { group: 0, pattern: 2, text: 3, kind: 4, params: 5, prerequisite: 20, start: 22, end: 23 }
// Title missions (category 5, degree_mission) put a sort group in front, so their fields sit one
// column later; their reward rows are laid out like the regular ones (reward kind 6, the title id in
// the slot's last column).
const DEGREE_LAYOUT = { group: 0, pattern: 1, text: 2, kind: 3, params: 4, prerequisite: 19, start: 21, end: 22 }

// Campaign reward rows have one more column after the reward id, so their target and slots are one later.
function parseRewardRow(line, shift = 0) {
    const c = parseCsvLine(line)
    const rewards = []
    // up to four reward slots of six columns: kind, amount, item, character, equipment, title (degree)
    for (let slot = 0; slot < 4; slot++) {
        const base = 5 + shift + slot * 6
        const kind = int(c[base])
        if (kind === null) continue
        const amount = int(c[base + 1]) ?? 0
        const reward = { kind, amount }
        const itemId = int(c[base + 2]), characterId = int(c[base + 3]), equipmentId = int(c[base + 4]), degreeId = int(c[base + 5])
        if (itemId !== null) reward.itemId = itemId
        if (characterId !== null) reward.characterId = characterId
        if (equipmentId !== null) reward.equipmentId = equipmentId
        if (degreeId !== null) reward.degreeId = degreeId
        if (amount === 0 && kind !== 6) continue
        rewards.push(reward)
    }
    // event reward rows: column 2 is the time limit in seconds of a "clear within N seconds" mission (kind 13;
    // the Chinese fork reads it the same way, event-rule-catalog.ts getEventTargetTimeMs)
    const seconds = shift === 0 ? int(c[2]) : null
    return { rewardId: int(c[0]), target: int(c[1 + shift]), ...(seconds === null ? {} : { timeLimitSeconds: seconds }), rewards }
}

if (require.main === module) (async () => {
    const missions = {}
    for (const [category, table] of Object.entries(CATEGORIES)) {
        const definitions = await readTable(`master/mission/${table}.orderedmap`, false)
        const rewards = await readTable(`master/mission/${table}_reward.orderedmap`, true)
        const out = {}
        for (const [id, line] of Object.entries(definitions)) {
            const c = parseCsvLine(line)
            const at = category === "4" ? CAMPAIGN_LAYOUT : category === "5" ? DEGREE_LAYOUT : LAYOUT
            const stages = Object.entries(rewards[id] ?? {})
                .map(([stage, rewardLine]) => ({ stage: Number(stage), ...parseRewardRow(rewardLine, category === "4" ? 1 : 0) }))
                .sort((a, b) => a.stage - b.stage)
            if (stages.some((s, i) => s.stage !== i + 1)) throw new Error(`Mission ${category}/${id} has a gap in its stages.`)
            const mission = {
                ...(at.group === undefined ? {} : { group: int(c[at.group]) }),
                pattern: c[at.pattern],
                text: c[at.text],
                kind: int(c[at.kind]),
                // 15 columns, kept as text: what each one means depends on the kind
                params: c.slice(at.params, at.params + 15).map(str),
                prerequisite: int(c[at.prerequisite]) === null ? null : [int(c[at.prerequisite]), int(c[at.prerequisite + 1]) ?? 1],
                start: str(c[at.start]),
                end: str(c[at.end]),
                stages: stages.map(({ target, rewardId, timeLimitSeconds, rewards }) => ({ target, rewardId, ...(timeLimitSeconds === undefined ? {} : { timeLimitSeconds }), rewards })),
            }
            out[id] = mission
        }
        missions[category] = out
        console.log(`category ${category}: ${Object.keys(out).length} missions`)
    }

    const data = {
        _note: "Regular (1), daily (2), event (3), campaign (4, collect_item_event_mission) and title (5, degree_mission) missions, from the global client's master tables in the CDN "
            + "(built by scripts/gen_missions.cjs). Dates are UTC. 'prerequisite' is [mission id, stage]: the mission "
            + "is listed only once that mission (same category) has cleared that stage. 'params' are the master "
            + "columns 3 to 17 as text (5 to 19 for campaign missions, which also carry their campaign 'group'; 4 to 18 for title missions, whose 'group' is a sort group). Reward kinds: 0 free beads, 1 item, 2 equipment, 3 mana, 4 character, "
            + "5 exp pool, 6 title (1, 3 and 5 are confirmed against active missions; the others are unconfirmed).",
        missions,
    }
    fs.writeFileSync(OUT, JSON.stringify(data))
    console.log(`Wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`)
})().catch(error => {
    console.error(error)
    process.exit(1)
})

module.exports = { CATEGORIES, LAYOUT, CAMPAIGN_LAYOUT, DEGREE_LAYOUT, parseRewardRow }
