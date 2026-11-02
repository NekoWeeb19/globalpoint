// Lists the ids that exist in the CN game files' tables (CN CDN, D:\WF client\.cdn\cn), for the CN
// client's replies: an id from global data the CN tables don't have stops the CN client (error C8601,
// "key does not exist"), so src/lib/cnClient.ts leaves those out.
//
//   node scripts/gen_cn_ids.cjs     -> assets/cn_ids.json
const fs = require("fs")
const path = require("path")
const { readCnTable } = require("./cn_read.cjs")

// name in cn_ids.json -> CN table (its first key level is the id)
const TABLES = {
    dailyChallengePoint: "master/quest/event/daily_challenge_point",
    dailyChallengePointCampaign: "master/campaign/daily_challenge_point_campaign",
    // shop items by shop type (src/lib/types.ts ShopType): a sales list entry CN doesn't have stops
    // the CN shop screen (C8601)
    "shop2": "master/shop/treasure_shop",
    "shop4": "master/shop/event_item_shop",
    "shop7": "master/shop/boss_coin_shop",
    "shop8": "master/shop/general_shop",
    "shop9": "master/shop/star_grain_shop",
    // step-up missions: global's "complete all" group missions (11, 12, ...) aren't in CN's table
    // and stop the CN home screen (C8601). CN awake missions are allowed separately (mana_awake_cn.json).
    activeMission: "master/active_mission/active_mission",
    // summon banners: a free pull entry (gacha_campaign_list) for a banner CN doesn't have stops the
    // CN client (C8601 in GachaRepository)
    gacha: "master/gacha/gacha",
    // Flipperpedia entries: encyclopedia/index unlocks these for the CN client (global's list misses
    // the CN-only entries, which then stay locked)
    encyclopedia: "master/encyclopedia/encyclopedia",
}

;(async () => {
    const out = {}
    for (const [name, table] of Object.entries(TABLES)) {
        const rows = await readCnTable(table + ".orderedmap")
        if (!rows) throw new Error(`${table} is not in the CN game files`)
        // Flipperpedia ids are entry*100 + page ("2000001/1" -> 200000101), as in assets/encyclopedia.json
        const id = name === "encyclopedia"
            ? k => { const [entry, page] = k.split("/").map(Number); return entry * 100 + page }
            : k => Number(k.split("/")[0])
        out[name] = [...new Set(Object.keys(rows).map(id))].filter(Number.isFinite).sort((a, b) => a - b)
        console.log(`${name}: ${out[name].length} ids`)
    }
    const file = path.join(__dirname, "..", "assets", "cn_ids.json")
    fs.writeFileSync(file, JSON.stringify(out))
    console.log(`wrote ${file}`)
})()
