// CN's own Chinese names of its events and summon banners, by the dashboard's event key ("advent_event:12",
// "gacha:100101"), for the server's own Chinese text when the game is set to Chinese (src/nya/autoNews.ts:
// the automatic news posts; scripts/game_language.cjs). The name columns are scripts/gen_event_catalog.cjs's.
//
//   node --env-file=.env scripts/gen_cn_event_names_zh.cjs   -> assets/event_names_zh.json
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")

// family -> [table, name column] (CN's layout; as scripts/gen_event_catalog.cjs --cn)
const FAMILIES = {
    story_event: ["master/quest/event/story_event.orderedmap", 2],
    world_story_event: ["master/quest/event/world_story_event.orderedmap", 2],
    advent_event: ["master/quest/event/advent_event.orderedmap", 2],
    carnival_event: ["master/quest/event/carnival_event.orderedmap", 1],
    hard_multi_event: ["master/quest/event/hard_multi_event.orderedmap", 2],
    raid_event: ["master/quest/event/raid_event.orderedmap", 1],
    ranking_event: ["master/quest/event/ranking_event.orderedmap", 2],
    rush_event: ["master/quest/event/rush_event.orderedmap", 1],
    pass_card_event: ["master/pass_card/pass_card_event.orderedmap", 1],
    gacha: ["master/gacha/gacha.orderedmap", 1],
}
const HAN = /[㐀-鿿]/

;(async () => {
    const names = {}
    for (const [family, [table, column]] of Object.entries(FAMILIES)) {
        const rows = await readCnTable(table, { raw: true })
        if (!rows) throw new Error(`${table}: not in the CN files`)
        let n = 0
        for (const [key, text] of Object.entries(rows)) {
            if (key.includes("/")) continue
            const name = R.splitCsv(String(text).split("\n")[0])[column]
            // "活动名" ("event name") is a placeholder CN left in carnival 1
            if (!name || !HAN.test(name) || name.trim() === "活动名") continue
            names[`${family}:${key}`] = name.trim()
            n++
        }
        console.log(`${family}: ${n} names`)
    }
    const out = path.join(__dirname, "..", "assets", "event_names_zh.json")
    fs.writeFileSync(out, JSON.stringify({ _note: "Built by scripts/gen_cn_event_names_zh.cjs: CN's own Chinese event and banner names by event key.", names }, null, 1) + "\n")
    console.log(`${Object.keys(names).length} names -> ${path.relative(process.cwd(), out)}`)
})()
