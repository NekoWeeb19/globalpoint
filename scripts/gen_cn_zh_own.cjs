// GlobalPoint's own Chinese for the cells CN still leaves in Japanese after the community's fixes
// (scripts/gen_cn_zh_fixes.cjs), for the game in Chinese (scripts/cn_language.cjs). Same format as cn_zh_fixes.json:
// a cell changes only while CN's own copy still has the Japanese it was written for.
// - the boss coin shop's limited-time labels "【2月8日まで】" in CN's own form "【至2月8日】" (the rest of the cell is
//   CN's Chinese already);
// - the rest by hand below, in CN's wording (CN's missions of the same kinds, CN's and 晓之车's names: 阿斯塔, 诺艾尔·希尔巴,
//   黑龙, 不弃魔道士, 帕尔佩布拉, 獠牙骑士); a sentence 晓之车 already translated elsewhere takes their words.
// Every Japanese text below must still be in CN's files, or the script stops.
//
//   node --env-file=.env scripts/gen_cn_zh_own.cjs     -> assets/cn_zh_own.json
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCn } = require("./cn_read.cjs")
const { recordsOf } = require("./gen_cn_text.cjs")
const { uploadPath } = require("./cdn_hash.cjs")

const KANA = /[ぁ-ゖァ-ヺ]/
const OUT = path.join(__dirname, "..", "assets", "cn_zh_own.json")
const GUIDE_DIALOGS = "production/upload/f3/5dbdf5b3c941d0a975bd5eabb5652fa411ebf9" // feature_guide_dialog (no known logical name)

const SALE = "正在出售含有星导石和扭蛋券的\n超值礼包\n\n请在活动期间多加利用！"
const BLACK_DRAGON = "黑龙 ::quest_rank::"
const SKILLS = "发动技能::x_count::（通关战斗后计算）"
const NOELLE = "诺艾尔·希尔巴"
const NOELLE_TEXT = "来自遥远世界的魔道士少女。虽出身于拥有强大魔力的王族，却因不擅长控制魔力而被视为吊车尾，在与阿斯塔和伙伴们相遇后，逐渐能够认同自己了。"
// table (logical name or stored path) -> row key -> "record:column" -> Chinese
const HAND = {
    "master/gacha/gacha.orderedmap": {
        "127": { "0:1": "新角色精选扭蛋" },
        "700000": { "0:1": "ComeBack扭蛋" },
        "700001": { "0:1": "ComeBack扭蛋" },
    },
    "master/quest/event/advent_event.orderedmap": { "300001": { "0:2": "不弃魔道士" } },
    "master/quest/event/advent_event_quest.orderedmap": {
        "300001/1": {
            "0:2": "阿斯塔，前往异世界",
            "0:127": "在迷宫中护着伤员持续防守的阿尔克一行人，遇见了来自异世界的访客『阿斯塔』、『尤诺』和『诺艾尔』。众人合力逃出迷宫，正当阿尔克一行人向阿斯塔他们说明这里是异世界时，收到了紧急消息，便一同前去讨伐巨龙。",
        },
        "300001/2": {
            "0:2": "有隐情的村庄",
            "0:127": "救下遭巨龙袭击的少年后，阿尔克一行人前往少年居住的村庄，请村民做好避难准备，却遭到了拒绝。看不下去敌视帕尔佩布拉、拒绝救援的村长，阿尔克一行人为了保护全村的人，分成向公会报告的小组和守卫村庄的小组，开始行动。",
        },
        "300001/3": {
            "0:2": "巨龙危机",
            "0:127": "留在村中继续说服村民的阿斯塔一行人，从他们救下的少年口中得知了这座村庄的由来。阿斯塔斥责了放弃一切的村长，与阿尔克一行人一同继续抵御来袭的巨龙、守护村庄，并与赶来会合的诺艾尔一起迎战大型巨龙。",
        },
        "300001/4": { "0:2": BLACK_DRAGON },
        "300001/5": {
            "0:2": "不肯放弃的男人",
            "0:127": "将村庄的防守交给赶来的冒险者后，阿斯塔一行人击退了这场骚动的幕后黑手——黑衣魔术师。几天后，阿斯塔一行人和少年一同造访公会，为那座村庄被认可为帕尔佩布拉的一部分而高兴，并决定暂时继续与阿尔克一行人互相协助。",
        },
        "300001/6": { "0:2": BLACK_DRAGON },
        "300001/7": { "0:2": BLACK_DRAGON },
        "300001/8": { "0:2": BLACK_DRAGON },
    },
    "master/mission/collect_item_event_mission.orderedmap": {
        "2169": { "0:3": "累计消耗 100 体力" },
        "2170": { "0:3": "获得三叶草::x_count::" },
        "2171": { "0:3": "完成上限突破" },
        "2172": { "0:3": "通关协力战斗 ::x_count::" },
        "2173": { "0:3": "进行装备觉醒::x_count::" },
        "2174": { "0:3": "玛纳板累计强化数::x_count::" },
        "2175": { "0:3": "【不弃魔道士】讨伐黑龙 ::x_count::" },
        "2176": { "0:3": "发动狂热::x_count::（通关战斗后计算）" },
        "2177": { "0:3": SKILLS },
        "2178": { "0:3": "完成所有初级任务" },
        "2179": { "0:3": "累计消耗 150 体力" },
        "2180": { "0:3": "获得四叶草::x_count::" },
        "2181": { "0:3": SKILLS },
        "2182": { "0:3": "在战斗中使用冲刺 ::x_count::（通关战斗后计算）" },
        "2183": { "0:3": "发动强化弹射::x_count::（通关战斗后计算）" },
        "2184": { "0:3": "讨伐敌人数量::x_count::（通关战斗后计算）" },
        "2185": { "0:3": "发动技能6连锁以上通关战斗" },
        "2186": { "0:3": "完成所有中级任务" },
        "2187": { "0:3": "【不弃魔道士】讨伐黑龙 ::x_count::" },
        "2188": { "0:3": "累计消耗 200 体力" },
        "2189": { "0:3": "通关协力战斗 ::x_count::" },
        "2190": { "0:3": "获得五叶草::x_count::" },
        "2191": { "0:3": "发动技能9连锁通关战斗" },
        "2192": { "0:3": "完成所有上级任务" },
        "2193": { "0:3": "完成所有任务" },
    },
    "master/shop/boss_coin_shop.orderedmap": {
        "309501": { "0:6": "【至2月8日】獠牙骑士的银币" },
        "309502": { "0:6": "【至2月8日】獠牙骑士的银币" },
    },
    "master/shop/event_item_shop.orderedmap": {
        "380004": { "0:7": NOELLE, "0:11": NOELLE_TEXT },
        "380005": { "0:7": NOELLE, "0:11": NOELLE_TEXT },
        "380006": { "0:7": NOELLE, "0:11": NOELLE_TEXT },
        "380007": { "0:7": NOELLE, "0:11": NOELLE_TEXT },
        "380080": { "0:7": "四叶草 × 5", "0:11": "偶尔才能发现的、蕴含丰富魔力的四叶草。据传说，第四片叶子上寄宿着幸运。" },
        "380081": { "0:7": "五叶草 × 3" },
    },
    [GUIDE_DIALOGS]: {
        "40000006": { "0:2": "联动纪念礼包热卖中！", "0:4": "正在出售含有星导石和破星结晶的\n超值礼包\n\n请在活动期间多加利用！" },
        "40000008": { "0:4": SALE },
        "40000009": { "0:4": SALE },
    },
}

// global's romanized names of the voice actors CN left blank, in the Chinese characters CN uses for them
const VOICE_ACTORS_ZH = { "Kisho Taniyama": "谷山纪章", "Ai Kayano": "茅野爱衣", "Takuya Sato": "佐藤拓也", "Yuuki Kuwahara": "桑原由气" }
// the global-only items' name (column 2) and description (5); the tickets in CN's words for its own 980004/980005
const TICKET = { 2: "大家一起选角色兑换券", 5: "能在大家一起选角色用使用的兑换券" }
const GLOBAL_ITEMS_ZH = {
    "50107": { cols: { 2: "北极熊饼干", 5: "北极熊形状的饼干。样子可爱，味道也很好，非常受欢迎。" } },
    "980006": { cols: TICKET },
    "980007": { cols: TICKET },
    "980008": { cols: TICKET },
}

;(async () => {
    const community = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets", "cn_zh_fixes.json"), "utf8")).cells
    // 晓之车's translations by their Japanese, for a sentence they already translated elsewhere
    const known = new Map()
    for (const rows of Object.values(community)) for (const cells of Object.values(rows)) for (const [was, zh] of Object.values(cells)) if (!known.has(was)) known.set(was, zh)
    const cells = {}
    let labels = 0, hand = 0, reused = 0
    const tables = new Set([...Object.keys(HAND), "master/shop/boss_coin_shop.orderedmap"])
    for (const table of tables) {
        const stored = table.startsWith("production/") ? table : uploadPath(table)
        const buf = table.startsWith("production/") ? await readStored(stored) : await readCn(table, { raw: true })
        if (!buf) throw new Error(`${table}: not in CN's files`)
        const rows = new Map(R.leaves(R.decodeFile(buf)).map(({ path: k, leaf }) => [k.join("/"), recordsOf(leaf.text.replace(/\r/g, ""))]))
        const put = (key, at, was, zh) => { ((cells[stored] ??= {})[key] ??= {})[at] = [was, zh] }
        // the limited-time labels, wherever the rest of the cell is Chinese already
        if (table === "master/shop/boss_coin_shop.orderedmap") {
            for (const [key, recs] of rows) recs.forEach((rec, r) => rec.forEach((cell, c) => {
                const m = /^【(\d+)月(\d+)日まで】(.*)$/s.exec(cell.trim())
                if (m && !KANA.test(m[3]) && !community[stored]?.[key]?.[`${r}:${c}`]) { put(key, `${r}:${c}`, cell.trim(), `【至${m[1]}月${m[2]}日】${m[3]}`); labels++ }
            }))
        }
        for (const [key, byAt] of Object.entries(HAND[table] ?? {})) for (const [at, zh] of Object.entries(byAt)) {
            const [r, c] = at.split(":").map(Number)
            const was = rows.get(key)?.[r]?.[c]?.trim()
            if (!was || !KANA.test(was)) throw new Error(`${table} ${key} ${at}: CN's cell isn't Japanese any more (${was})`)
            put(key, at, was, zh); hand++
        }
    }
    // the five-leaf clover's description: 晓之车's words for the same sentence
    const clover = uploadPath("master/shop/event_item_shop.orderedmap")
    const cloverRows = new Map(R.leaves(R.decodeFile(await readCn("master/shop/event_item_shop.orderedmap", { raw: true }))).map(({ path: k, leaf }) => [k.join("/"), recordsOf(leaf.text.replace(/\r/g, ""))]))
    for (const key of ["380081"]) {
        const was = cloverRows.get(key)?.[0]?.[11]?.trim()
        if (was && known.has(was)) { ((cells[clover] ??= {})[key] ??= {})["0:11"] = [was, known.get(was)]; reused++ }
        else throw new Error(`event_item_shop ${key}: no community translation of its description`)
    }
    // voice actors CN leaves blank ("--") that the English game fills from global (assets/cn_voice_actors.json): their
    // names in Chinese characters
    const actors = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets", "cn_voice_actors.json"), "utf8")).rows
    const textTable = uploadPath("master/character/character_text.orderedmap")
    const textRows = new Map(R.leaves(R.decodeFile(await readCn("master/character/character_text.orderedmap", { raw: true }))).map(({ path: k, leaf }) => [k.join("/"), recordsOf(leaf.text.replace(/\r/g, ""))]))
    let voices = 0
    for (const [unit, name] of Object.entries(actors)) {
        const zh = VOICE_ACTORS_ZH[name]
        if (!zh) throw new Error(`voice actor ${name}: no Chinese name in VOICE_ACTORS_ZH`)
        const was = textRows.get(unit)?.[0]?.[11]?.trim()
        if (was !== "--") throw new Error(`character_text ${unit}: CN's voice actor cell isn't "--" (${was})`)
        ;((cells[textTable] ??= {})[unit] ??= {})["0:11"] = ["--", zh]
        voices++
    }
    // rows CN doesn't have at all, added by the update builder in English (global-only items,
    // assets/cn_global_items.json): their text columns in Chinese
    const items = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets", "cn_global_items.json"), "utf8"))
    const rows = { [uploadPath(items.table)]: GLOBAL_ITEMS_ZH }
    for (const id of Object.keys(items.rows)) if (!GLOBAL_ITEMS_ZH[id]) throw new Error(`global-only item ${id}: no Chinese in GLOBAL_ITEMS_ZH`)
    fs.writeFileSync(OUT, JSON.stringify({
        _note: "Built by scripts/gen_cn_zh_own.cjs: GlobalPoint's own Chinese for cells CN left in Japanese (or blank) that the community's fixes don't cover (same format as cn_zh_fixes.json), and rows: table -> row key -> { cols: { column: Chinese } } for rows the builder adds that CN doesn't have.",
        cells, rows, rules: [],
    }, null, 1) + "\n")
    console.log(`${labels} shop labels, ${hand} cells by hand, ${reused} from the community's words, ${voices} voice actors, ${Object.keys(GLOBAL_ITEMS_ZH).length} global-only items -> ${path.relative(process.cwd(), OUT)}`)
})().catch(e => { console.error(e.stack || e.message); process.exit(1) })

// a table without a known logical name, by its stored path (the newest original in CN's archives or slim folder)
async function readStored(stored) {
    const { readCnOriginals } = require("./cn_language.cjs")
    const { cnDir } = require("./cn_archives.cjs")
    return (await readCnOriginals(cnDir(), [stored])).get(stored) ?? null
}
