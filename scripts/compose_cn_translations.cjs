// Translates CN-only text that is built from known parts, using global's translation memory
// (glossary.json) and assets/translations/cn.json: "X × 5", "【12月15日12点截止】X", "<boss>的金币"
// (learned from global's own "<boss>的金币" = "Gold <Boss> Denarius" pairs), ★ ranks and so on.
// Results are added to assets/translations/cn.json.
//
//   node scripts/compose_cn_translations.cjs <glossary.json> <todo.json>
const fs = require("fs")
const path = require("path")

const [glossaryFile, todoFile] = process.argv.slice(2)
const glossary = JSON.parse(fs.readFileSync(glossaryFile, "utf8"))
const cnFile = path.join(__dirname, "..", "assets", "translations", "cn.json")
const cn = JSON.parse(fs.readFileSync(cnFile, "utf8"))
const todo = Object.keys(JSON.parse(fs.readFileSync(todoFile, "utf8")))
const known = s => cn.strings[s] ?? glossary[s]

// coin owners from global's pairs: X的金币 = Gold X Denarius
const owners = {}
for (const [zh, en] of Object.entries(glossary)) {
    const z = zh.match(/^(.+)的(金币|银币|紫币)$/), e = en.match(/^(Gold|Silver|Lilac) (.+) Denarius$/)
    if (z && e) owners[z[1]] = e[2]
}
const COIN = { 金币: "Gold", 银币: "Silver", 紫币: "Lilac" }

// "5月31日 23:59", "2023年01月26日 11:59", "10/15 4:59" -> "5/31 23:59", "1/26/2023 11:59", "10/15 4:59"
function dateText(s) {
    let m
    if ((m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(.*)$/))) return `${Number(m[2])}/${Number(m[3])}/${m[1]} ${m[4]}`.trim()
    if ((m = s.match(/^(\d{1,2})月(\d{1,2})日\s*(.*)$/))) return `${Number(m[1])}/${Number(m[2])} ${m[3]}`.trim()
    return s
}

function tr(s) {
    s = s.trim()
    let m
    // deadlines first: global's memory has its own (different) dates for some of these
    if ((m = s.match(/^【(?:到)?(\d+)月(\d+)日(?:(\d+)点)?(?:为止|截止)】(.*)$/))) {
        const head = `[Until ${m[1]}/${m[2]}${m[3] ? ` ${m[3]}:00` : ""}]`
        if (m[4] === "") return head
        const b = tr(m[4]); return b && `${head} ${b}`
    }
    if ((m = s.match(/^【至(\d+)月(\d+)日结束】(.*)$/))) { const head = `[Until ${m[1]}/${m[2]}]`; if (m[3] === "") return head; const b = tr(m[3]); return b && `${head} ${b}` }
    if ((m = s.match(/^【(\d+)月(\d+)(?:日)?】(.+)$/))) { const b = tr(m[3]); return b && `[${m[1]}/${m[2]}] ${b}` }
    const k = known(s)
    if (k !== undefined) return k
    // several lines (material lists): each line on its own
    if (s.includes("\n")) {
        const lines = s.split("\n").map(l => l.trim() === "" ? "" : tr(l))
        return lines.every(l => l !== undefined) ? lines.join("\n") : undefined
    }
    // trial time limits: "奔雷试炼战斗 1分30 秒以内通关" / "溢光试炼战斗 50 秒以内通关"
    if ((m = s.match(/^(.+?)战斗\s*(?:(\d+)分)?\s*(\d+)\s*秒以内通关$/))) {
        const t = known(m[1]); const time = m[2] ? `${m[2]}:${m[3].padStart(2, "0")}` : `0:${m[3].padStart(2, "0")}`
        return t && `Clear a ${t} battle within ${time}`
    }
    if ((m = s.match(/^【(.+?)】通关活动协力战斗\s*::x_count::$/))) { const t = known(m[1]); return t && `${t}: Clear ::x_count:: multiplayer battles` }
    if ((m = s.match(/^通关(.+?)(?:讨伐)?的协力战斗\s*::x_count::$/))) { const t = known(m[1]); return t && `Clear ::x_count:: ${t} multiplayer battles` }
    if ((m = s.match(/^通关(.+?)战斗\s*::x_count::$/))) { const t = known(m[1]); return t && `Clear ::x_count:: ${t} battles` }
    if ((m = s.match(/^可供(一|两)名(.)属性角色完全强化玛纳板第(一|二)层\n每月限购1次$/))) {
        const el = { 火: "fire", 水: "water", 雷: "thunder", 风: "wind", 光: "light", 暗: "dark" }[m[2]]
        return el && `Enough to fully augment Mana Board ${m[3] === "一" ? 1 : 2} for ${m[1] === "一" ? "one" : "two"} ${el} unit${m[1] === "一" ? "" : "s"}\nLimit 1 per month`
    }
    if ((m = s.match(/^(.)属性(元素|以太)素材套装$/))) {
        const el = { 火: "Fire", 水: "Water", 雷: "Thunder", 风: "Wind", 光: "Light", 暗: "Dark" }[m[1]]
        return el && `${el} ${m[2] === "元素" ? "Element" : "Ether"} Material Bundle`
    }
    if (/^[ -~]+$/.test(s)) return s
    if ((m = s.match(/^(.+?)\s*[×x]\s*(\d+)$/))) { const b = tr(m[1]); return b && `${b} x${m[2]}` }
    if ((m = s.match(/^【(\d+)月(\d+)日(\d+)点截止】(.*)$/))) {
        const head = `[Until ${m[1]}/${m[2]} ${m[3]}:00]`
        if (m[4] === "") return head
        const b = tr(m[4]); return b && `${head} ${b}`
    }
    if ((m = s.match(/^(.+)的(金币|银币|紫币)$/))) { const o = owners[m[1]] ?? known(m[1]) ?? (/^[ -~]+$/.test(m[1]) ? m[1] : undefined); return o && `${COIN[m[2]]} ${o} Denarius` }
    if ((m = s.match(/^★(\d)(.+)$/))) { const b = tr(m[2]); return b && `${m[1]}★ ${b}` }
    if ((m = s.match(/^(.+)（(\d+)）$/))) { const b = tr(m[1]); return b && `${b} (${m[2]})` }
    if ((m = s.match(/^等级(\d+)$/))) return `Tier ${m[1]}`
    // items and shop rows
    if ((m = s.match(/^(.+)魂珠$/)) && m[1] !== "能力") { const b = tr(m[1]); return b && `${b} Ability Core` }
    if ((m = s.match(/^【(\d+)月(\d+)日】(.+)$/))) { const b = tr(m[3]); return b && `[${m[1]}/${m[2]}] ${b}` }
    if ((m = s.match(/^刻有(.+?)的(银币|金币|紫币)。收(?:藏家们|集者)似乎(?:正)?在收集它。(?:可以|能)在商店兑换道具。?$/))) {
        const o = owners[m[1]] ?? known(m[1]) ?? owners[m[1].replace(/^(.+?机兵).+$/, "$1")]
        const kind = { 银币: "silver", 金币: "gold", 紫币: "lilac" }[m[2]]
        return o && `A ${kind} denarius coin engraved with a relief of ${o}. Popular with collectors and can be traded for items in the shop.`
    }
    if ((m = s.match(/^可以回复(\d+)点体力的魔法小瓶。\n【有效期至(.+)】$/))) return `A small dose of an energizing potion. Recovers ${m[1]} Stamina.\n[Valid until ${dateText(m[2])}]`
    if ((m = s.match(/^【有效期至(.+?)】(.+)$/))) { const b = tr(m[2]); return b && `[Valid until ${dateText(m[1])}] ${b}` }
    if ((m = s.match(/^(.+?) ::quest_rank::$/))) { const b = tr(m[1]); return b && `${b} ::quest_rank::` }
    // "prefix-name" labels (BGM album, content guide): both halves known
    if ((m = s.match(/^([^-－]+)[-－](.+)$/))) {
        const PREFIX = { 商店: "Shop", 每日任务: "Daily Missions", 活动任务: "Event Missions", 扭蛋箱: "Portal Box", 特别活动任务: "Promo Missions",
            主题曲: "Main Theme", 角色印象: "Character Theme", 主线剧情: "Main Story", 辞旧迎新: "Year-End", 开服纪念关卡: "Anniversary Quests" }
        const SUFFIX = { 默认: "Default", 圣诞: "Christmas", 春节: "Lunar New Year", 新春: "New Year", 周年: "Anniversary", 漫画: "Comic", 剧情菜单: "Story Menu",
            主线: "Main Story", 主题: "Theme", 结局: "Ending", 悲哀: "Sorrow", 循环: "Loop", 星: "Star", 不安: "Unease", 和平: "Peace", 悲念: "Grief", 狐族: "Foxfolk",
            白: "White", 黑: "Black", 反击: "Counterattack", 战斗之后: "After the Battle", 回忆: "Memories", 篝火晚会: "Bonfire Party" }
        const head = PREFIX[m[1]] ?? known(m[1])
        const t = m[2]
        let tail = SUFFIX[t] ?? tr(t)
        if (tail === undefined && (m = t.match(/^(主线|剧情)(\d+(?:-\d+)?)$/))) tail = `${m[1] === "主线" ? "Main" : "Story"} ${m[2]}`
        if (head && tail) return `${head} - ${tail}`
    }
    // title conditions
    const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    if ((m = s.match(/^获得条件：(.+)$/))) { const b = tr(m[1]); return b && `How to get: ${b}` }
    if ((m = s.match(/^在(\d{4})年(\d{1,2})月的【阿尔克的修行之道】中，将(初阶|高阶)修行等级提升至(\d+)级$/)))
        return `Reach ${m[3] === "初阶" ? "Basic" : "Advanced"} Training Level ${m[4]} in [Alk's Way of Practice] in ${MONTHS[Number(m[2])]} ${m[1]}`
    const unit = (epithet, name) => {
        const n = known(name)
        if (!n) return undefined
        const e = epithet ? known(epithet) : undefined
        return e ? `[${e}] ${n}` : n
    }
    if ((m = s.match(/^将(?:【(.+?)】)?(.+?)的第二枚玛纳板全部强化完成$/))) { const u = unit(m[1], m[2]); return u && `Fully augment ${u}'s Mana Board 2` }
    if ((m = s.match(/^将(?:【(.+?)】)?(.+?)升(?:级)?到Lv100并获得信赖之证$/))) { const u = unit(m[1], m[2]); return u && `Raise ${u} to Lv100 and get their Amity Scroll` }
    if ((m = s.match(/^在单人战斗下讨伐超级难度的(.+)$/))) { const b = known(m[1]); return b && `Defeat ${b} on Godly solo` }
    return undefined
}

let added = 0
for (const s of todo) {
    if (cn.strings[s] !== undefined) continue
    const en = tr(s)
    if (en !== undefined && en !== s) { cn.strings[s] = en; added++ }
}
fs.writeFileSync(cnFile, JSON.stringify(cn, null, 1))
console.log(`${added} composed translations added (${Object.keys(owners).length} coin owners known)`)
