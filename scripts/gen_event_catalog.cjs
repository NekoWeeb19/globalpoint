// Builds assets/event_catalog.json: every timed event in the global client's master data, with the
// rows that belong to it in other tables (quests, missions, shop items, box gachas, tokens, help
// pages, home banners). The dashboard's Events tab moves an event by moving all of its rows'
// dates together (see src/lib/eventSchedule.ts and scripts/gen_event_schedule_mod.cjs).
//
//   node scripts/gen_event_catalog.cjs
//
// How rows are tied to an event (checked against every event's own dates):
//   - quest tables of the same family keyed by the event id ("<event id>/<n>")
//   - missions whose quest range points at the event (range kind + event id, as in src/lib/mission.ts),
//     and "clear all" missions that list those missions
//   - event shop rows: column 0 is the event family (0 boss event, 1 story event, 5 carnival,
//     6 Grand Gauntlet) and column 1 the event id; the items they cost (column 18)
//   - box gachas named after the event, and their boxes
//   - any other dated row that carries the event's internal name (tokens, help pages, home
//     banners, challenge attempts) and whose dates fall inside the event
//   - "banners": summon banners that started at the same moment as the event (moved with it
//     unless the schedule says otherwise)
// Permanent events (no end date) are left out.
//
// Summon banners are in the catalog too, as their own kind ("gacha", key "gacha:<banner id>"), for
// the dashboard's Summons tab: a banner is one row of master/gacha/gacha (start column 29, end 30,
// column 31 = when its leftover points stop counting, kept the same distance after the end).
//
// It also copies each event's banner picture and its summon banners' pictures into
// .cdn/dashboard_images/<id>.png for the dashboard (the game stores them as PNGs whose header says
// "\x89png" instead of "\x89PNG"; the header is put back).
//
//   node scripts/gen_event_catalog.cjs --cn
// builds assets/event_catalog_cn.json instead: the events only the CN client has, from the CN game
// files (the English-translated copies in CN_TRANSLATED_DIR first), with CN's columns and missions
// (assets/missions_cn.json). Its dates are turned into Japan time like global's. The dashboard and the
// CN schedule (scripts/gen_cn_event_schedule.cjs) add these to the global catalog; global's own event
// mod never sees them.

const fs = require("fs")
const path = require("path")
const { ROOT, decodeFile, leaves, splitCsv, readHashedFile } = require("./cdn_rows.cjs")
const CN = process.argv.includes("--cn")

const { uploadPath: hashed } = require("./cdn_hash.cjs")
const DATE = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g

// family -> columns of its event table (global layout) and the mission quest-range kinds
const FAMILIES = {
    story_event: { label: "Story event", dev: 0, base: 1, name: 2, start: 16, end: 17, close: 18, ranges: [6], shop: "1" },
    world_story_event: { label: "Event story", dev: 0, base: 1, name: 2, start: 22, end: 23, close: 24, ranges: [9, 10] },
    advent_event: { label: "Boss event", dev: 0, base: 1, name: 2, start: 23, end: 24, close: 25, ranges: [5], shop: "0" },
    carnival_event: { label: "Hanifolk Carnival", dev: 0, base: null, name: 1, start: 20, end: 21, close: 22, ranges: [15], shop: "5" },
    hard_multi_event: { label: "The Reckoning", dev: 0, base: null, name: 2, start: 23, end: 24, close: 25, ranges: [19] },
    raid_event: { label: "Raid", dev: 0, base: null, name: 1, start: 24, end: 25, close: 26, ranges: [16] },
    ranking_event: { label: "Trial (time attack)", dev: 0, base: null, name: 2, start: 18, end: 19, close: 12, ranges: [8] },
    rush_event: { label: "Grand Gauntlet", dev: 0, base: null, name: 1, start: 18, end: 19, close: 20, ranges: [17], shop: "6" },
}

// CN's event tables put some columns elsewhere
if (CN) {
    Object.assign(FAMILIES.advent_event, { start: 24, end: 25, close: 26 })
    Object.assign(FAMILIES.raid_event, { start: 22, end: 23, close: 24 })
    Object.assign(FAMILIES.rush_event, { start: 15, end: 16, close: 17 })
    // CN's monthly pass ("The Way of Practice"): its missions are tied to it by column 0
    FAMILIES.pass_card_event = { label: "Pass (The Way of Practice)", dev: 0, base: null, name: 1, start: 8, end: 9, close: 10, ranges: [], table: "master/pass_card/pass_card_event.orderedmap" }
}
const familyTable = family => FAMILIES[family].table ?? `master/quest/event/${family}.orderedmap`
const PASS_MISSION_TABLES = ["daily", "week", "event"].map(t => `master/pass_card/pass_card_${t}_mission.orderedmap`)

const QUEST_TABLES = {
    story_event: ["story_event_single_quest"],
    world_story_event: ["world_story_event_quest", "world_story_event_boss_battle_quest"],
    advent_event: ["advent_event_quest"],
    carnival_event: ["carnival_event_quest"],
    hard_multi_event: ["hard_multi_event_quest"],
    raid_event: ["raid_event_quest"],
    ranking_event: ["ranking_event_single_quest"],
    rush_event: ["rush_event_quest"],
    pass_card_event: [],
}

// mission category (assets/missions.json) -> table
const MISSION_TABLES = {
    1: "master/mission/regular_mission.orderedmap",
    2: "master/mission/daily_mission.orderedmap",
    3: "master/mission/event_mission.orderedmap",
    4: "master/mission/collect_item_event_mission.orderedmap",
}

// other tables searched for the event's internal name (logical paths, or hashed ones whose
// logical path isn't known: help pages, home announcements and the like)
const NAME_TABLES = [
    "master/quest/event/daily_challenge_point.orderedmap",
    "master/item/item.orderedmap",
    "master/box_gacha/box_gacha.orderedmap",
    "master/encyclopedia/encyclopedia.orderedmap",
    "master/mission/degree_mission.orderedmap",
    "master/bonus/login_bonus.orderedmap",
    "master/reward/event/collect_item_event.orderedmap",
    "master/reward/periodic_reward_point.orderedmap",
    "production/upload/f3/5dbdf5b3c941d0a975bd5eabb5652fa411ebf9",
    "production/upload/74/5671e8eba88e75cdc4f97e4c6ade23b04b1757",
    "production/upload/68/f187ccb76e9cc852c48b3973df08f0ae61df8c",
    "production/upload/85/8142ce3d4a07f9e4cc388045a5b29aa8cfc27e",
    "production/upload/ca/ed63444a39cf7bf4fad5de3304fbd20ff1d5d4",
    "production/upload/8c/82c8e05db4ce4f8a06bcd25f90bbda2967808b",
    "production/upload/06/fcda5e60f527f281ce406fa6eb4777414149a8",
    ...Object.values(MISSION_TABLES),
]
// home banners that open an event (link kind 10): the event's type and id follow the link kind 6
// columns later. Linked so they move with the event (e.g. the Golden Week box summon is reached only
// through its home banner). Event type numbers as in the client's event list.
const HOME_BANNER_TABLES = { "master/feature_banner/feature_banner.orderedmap": 8, "master/feature_banner/feature_banner_secondary.orderedmap": 6 }
const EVENT_TYPE_FAMILY = { 0: "advent_event", 1: "ranking_event", 2: "story_event", 6: "world_story_event", 9: "carnival_event", 10: "raid_event", 11: "rush_event", 13: "hard_multi_event" }
const SHOP_TABLE = "master/shop/event_item_shop.orderedmap"
const ITEM_TABLE = "master/item/item.orderedmap"
const BOX_GACHA_TABLE = "master/box_gacha/box_gacha.orderedmap"
const BOX_TABLE = "master/box_gacha/box.orderedmap"
const GACHA_TABLE = "master/gacha/gacha.orderedmap"
const { NO_ART_BANNERS } = require("./no_art_banners.cjs")
const SHOP_COST_COLUMNS = [18, 20, 22, 24]

const IMAGES_OUT = path.join(ROOT, ".cdn", "dashboard_images")
const CDN_DIR = path.join(ROOT, ".cdn", "en")

// hashed path -> where its newest copy is, over every archive (built once)
async function archiveIndex() {
    if (CN) {
        // CN's files, then global's for pictures CN didn't ship (most of its banners' list pictures
        // are the same files global has)
        const cn = await cnArchiveIndex()
        const merged = new Map(await globalArchiveIndex())
        for (const [key, entry] of cn) merged.set(key, entry)
        return merged
    }
    return globalArchiveIndex()
}

async function globalArchiveIndex() {
    const unzipper = require("unzipper")
    const csv = fs.readdirSync(path.join(CDN_DIR, "entities")).filter(f => f.endsWith(".csv")).sort().pop()
    const versions = new Map(fs.readFileSync(path.join(CDN_DIR, "entities", csv), "utf8").split(/\r?\n/).map(line => { const p = line.split(","); return [p[0], p[1]] }))
    const found = new Map()
    for (const dir of fs.readdirSync(CDN_DIR).filter(d => d.startsWith("archive-")).sort((a, b) => Number(b.includes("common")) - Number(a.includes("common")))) {
        for (const file of fs.readdirSync(path.join(CDN_DIR, dir)).filter(f => f.endsWith(".zip"))) {
            const archive = await unzipper.Open.file(path.join(CDN_DIR, dir, file))
            for (const entry of archive.files) {
                const key = "production/" + entry.path.split(String.fromCharCode(92)).join("/").replace(/^production\//, "")
                const version = versions.get(key)
                if (version === undefined || found.has(key) || !file.includes(`-${version}-`)) continue
                found.set(key, entry)
            }
        }
    }
    return found
}

/** Copies a picture ("quest/event/banner/x" without ".png") for the dashboard; returns its id, or null. */
async function copyImage(index, logical) {
    if (!logical) return null
    const key = hashed(logical + ".png")
    const entry = index.get(key)
    if (entry === undefined) return null
    const id = key.split("/").slice(-2).join("")
    const out = path.join(IMAGES_OUT, `${id}.png`)
    if (!fs.existsSync(out)) {
        const data = await entry.buffer()
        if (data.length < 8 || data[0] !== 0x89 || data.toString("latin1", 1, 4).toUpperCase() !== "PNG") return null
        data.write("PNG", 1, "latin1")
        fs.mkdirSync(IMAGES_OUT, { recursive: true })
        fs.writeFileSync(out, data)
    }
    return id
}

const fileOf = table => table.startsWith("production/") ? table : hashed(table)

// English names for events whose name is still Japanese/Korean in the global data
function translatedNames() {
    const file = path.join(ROOT, "assets", "translations", "events.json")
    if (!fs.existsSync(file)) return {}
    const names = {}
    for (const table of Object.values(JSON.parse(fs.readFileSync(file, "utf8")).tables)) Object.assign(names, table.strings)
    return names
}

// CN files: hashed path -> newest archive entry (scripts/cn_archives.cjs order)
let cnIndexCache = null
async function cnArchiveIndex() {
    if (cnIndexCache) return cnIndexCache
    const unzipper = require("unzipper")
    const { cnZips } = require("./cn_archives.cjs")
    cnIndexCache = new Map()
    for (const z of cnZips()) for (const e of (await unzipper.Open.file(z)).files) {
        if (e.type !== "File") continue
        cnIndexCache.set("production/" + e.path.split(String.fromCharCode(92)).join("/").replace(/^production\//, ""), e)
    }
    return cnIndexCache
}
// CN tables: the translated copy when there is one (English text), else CN's own
let cnTranslated = null
async function readCnFile(file) {
    if (cnTranslated === null) {
        const dir = process.env.CN_TRANSLATED_DIR
        const list = dir ? path.join(dir, "files.json") : null
        cnTranslated = new Map(list && fs.existsSync(list) ? JSON.parse(fs.readFileSync(list, "utf8")).map(f => [f.path, f.from]) : [])
    }
    const translated = cnTranslated.get(file)
    if (translated && fs.existsSync(translated)) return fs.readFileSync(translated)
    const entry = (await cnArchiveIndex()).get(file)
    if (!entry) throw new Error(`not in the CN files: ${file}`)
    return entry.buffer()
}

async function readTable(table) {
    const rows = []
    let buf
    try { buf = CN ? await readCnFile(fileOf(table)) : await readHashedFile(fileOf(table)) } catch (e) { if (CN) return rows; throw e }
    for (const { path: keys, leaf } of leaves(decodeFile(buf))) {
        rows.push({ table, p: keys.join("/"), t: leaf.text, dates: leaf.text.match(DATE) ?? [] })
    }
    return rows
}

async function main() {
    const missions = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", CN ? "missions_cn.json" : "missions.json"), "utf8")).missions
    const names = translatedNames()

    const tableNames = new Set([
        ...Object.keys(FAMILIES).map(familyTable),
        ...(CN ? PASS_MISSION_TABLES : []),
        ...Object.values(QUEST_TABLES).flat().map(t => `master/quest/event/${t}.orderedmap`),
        ...NAME_TABLES, SHOP_TABLE, ITEM_TABLE, BOX_GACHA_TABLE, BOX_TABLE, GACHA_TABLE, ...Object.keys(HOME_BANNER_TABLES),
    ])
    const rowsByTable = {}
    for (const table of tableNames) {
        rowsByTable[table] = await readTable(table)
        console.log(`${table}: ${rowsByTable[table].length} rows`)
    }
    const byKey = new Map(Object.values(rowsByTable).flat().map(r => [`${r.table}#${r.p}`, r]))

    // the events
    const events = []
    for (const [family, c] of Object.entries(FAMILIES)) {
        for (const row of rowsByTable[familyTable(family)]) {
            const f = splitCsv(row.t)
            if (!/^\d{4}-/.test(f[c.end] ?? "") || !/^\d{4}-/.test(f[c.start] ?? "")) continue // permanent
            const close = /^\d{4}-/.test(f[c.close] ?? "") ? f[c.close] : f[c.end]
            let rawName = family === "pass_card_event" ? `The Way of Practice ${row.p} (${f[c.start].slice(0, 7)})` : f[c.name]
            // CN names the translation took from another event (scripts/cn_name_fixes.cjs)
            const nameFix = CN ? require("./cn_name_fixes.cjs")[familyTable(family)]?.[row.p] : undefined
            if (nameFix && rawName === nameFix[1]) rawName = nameFix[2]
            const base = c.base === null ? null : f[c.base]
            events.push({
                key: `${family}:${row.p}`, family, id: row.p, dev: f[c.dev],
                name: names[rawName] ?? rawName,
                rerunOf: base && base !== "(None)" && base !== "" ? `${family}:${base}` : null,
                start: f[c.start], end: f[c.end], close,
                row, linked: new Map(), banners: [],
            })
        }
    }

    const inside = (r, ev) => r.dates.some(d => d >= ev.start && d <= ev.close)
    // the row is wholly before or after the event, by about the time between JP's launch and CN's
    const launchLagged = (r, ev) => {
        if (r.dates.length === 0) return false
        const first = [...r.dates].sort()[0], last = [...r.dates].sort().at(-1)
        if (!(last < ev.start || first > ev.close)) return false
        const days = Math.abs(Date.parse(first.replace(" ", "T") + "Z") - Date.parse(ev.start.replace(" ", "T") + "Z")) / 864e5
        return days >= 550 && days <= 720
    }
    const link = (ev, r, why) => { if (!ev.linked.has(`${r.table}#${r.p}`)) ev.linked.set(`${r.table}#${r.p}`, why) }
    const linkedTo = (ev, table, p) => ev.linked.has(`${table}#${p}`)

    // internal names: each row goes to the longest name it contains (so "anv3" doesn't take
    // "anv3_release_event" rows)
    const nameMatches = new Map() // row key -> dev names found in it
    const devNames = [...new Set(events.map(e => e.dev))]
    for (const table of NAME_TABLES) for (const r of rowsByTable[table]) {
        if (r.dates.length === 0) continue
        const hay = `${r.p} ${r.t}`.toLowerCase()
        const found = devNames.filter(dev => new RegExp(`(^|[^a-z0-9])${dev.toLowerCase()}(?![a-z0-9])`).test(hay))
        const longest = found.filter(dev => !found.some(other => other !== dev && other.startsWith(dev + "_") && hay.includes(other.toLowerCase())))
        if (longest.length) nameMatches.set(`${r.table}#${r.p}`, longest)
    }

    for (const ev of events) {
        const fam = FAMILIES[ev.family]
        link(ev, ev.row, "event")
        for (const q of QUEST_TABLES[ev.family]) for (const r of rowsByTable[`master/quest/event/${q}.orderedmap`]) {
            if (r.p.split("/")[0] === ev.id) link(ev, r, "quest")
        }
        if (ev.family === "pass_card_event") for (const table of PASS_MISSION_TABLES) for (const r of rowsByTable[table]) {
            if (splitCsv(r.t)[0] === ev.id) link(ev, r, "pass mission")
        }
        for (const [cat, table] of Object.entries(MISSION_TABLES)) for (const [id, m] of Object.entries(missions[cat] ?? {})) {
            const p = m.params
            if (p[4] === null || !fam.ranges.includes(Number(p[4]))) continue
            if (!String(p[5] ?? "").split(",").includes(ev.id)) continue
            const r = byKey.get(`${table}#${id}`)
            if (r) link(ev, r, "mission")
        }
        if (fam.shop !== undefined) for (const r of rowsByTable[SHOP_TABLE]) {
            const f = splitCsv(r.t)
            if (f[0] !== fam.shop || f[1] !== ev.id) continue
            link(ev, r, "shop")
            for (const col of SHOP_COST_COLUMNS) {
                const item = byKey.get(`${ITEM_TABLE}#${f[col]}`)
                if (item && item.dates.length && inside(item, ev)) link(ev, item, "shop cost")
            }
        }
        for (const [key, devs] of nameMatches) {
            if (!devs.includes(ev.dev)) continue
            const r = byKey.get(key)
            if (inside(r, ev)) link(ev, r, "name")
            // CN: a row with the other launch's dates (JP's for an event CN dated with JP's, or the other way
            // round: 550-720 days off), unless another event of the same name runs then
            else if (CN && launchLagged(r, ev) && !events.some(o => o !== ev && o.dev === ev.dev && inside(r, o))) link(ev, r, "name (JP/CN dates)")
        }
        for (const [table, at] of Object.entries(HOME_BANNER_TABLES)) for (const r of rowsByTable[table] ?? []) {
            const f = splitCsv(r.t)
            if (f[at] === "10" && EVENT_TYPE_FAMILY[f[at + 6]] === ev.family && f[at + 7] === ev.id) link(ev, r, "home banner")
        }
        // boxes of the event's box gachas
        const boxGachaIds = rowsByTable[BOX_GACHA_TABLE].filter(r => linkedTo(ev, BOX_GACHA_TABLE, r.p)).map(r => r.p)
        for (const r of rowsByTable[BOX_TABLE]) if (boxGachaIds.includes(r.p.split("/")[0])) link(ev, r, "box")
        // "clear all" missions that list the event's missions, with dates inside the event
        for (let pass = 0; pass < 2; pass++) for (const [cat, table] of Object.entries(MISSION_TABLES)) for (const [id, m] of Object.entries(missions[cat] ?? {})) {
            const r = byKey.get(`${table}#${id}`)
            if (!r || linkedTo(ev, table, id) || !inside(r, ev)) continue
            const refs = m.params.filter(v => v !== null).flatMap(v => String(v).split(","))
            if (refs.some(ref => linkedTo(ev, table, ref))) link(ev, r, "mission")
        }
        // summon banners that opened with the event (not ones without a picture: scripts/no_art_banners.cjs)
        for (const r of rowsByTable[GACHA_TABLE]) if (r.dates[0] === ev.start && !ev.linked.has(`${r.table}#${r.p}`) && !NO_ART_BANNERS.has(String(r.p))) ev.banners.push(r)
    }

    // pictures: the event's own banner, and its summon banners
    console.log("Indexing the archives for pictures...")
    const index = await archiveIndex()
    let pictures = 0
    // CN: global's events and banners the CN files also have (same key and same internal name) are
    // "shared" (the dashboard shows them for both apps); the rest of global's keys are dropped here
    const sharedKeys = new Set()
    const sharedEvents = new Map(), clashKeys = []
    const globalDev = CN ? new Map(JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "event_catalog.json"), "utf8")).events.map(e => [e.key, e.dev])) : new Map()
    const noteShared = list => { for (const ev of list) if (globalDev.has(ev.key) && globalDev.get(ev.key) === ev.dev) sharedKeys.add(ev.key) }
    if (CN) {
        // only the events global doesn't have (summon banners too, below; their pools come from
        // scripts/gen_cn_gacha.cjs). CN's own events keep the summon banners that opened with them, so they're
        // listed on the dashboard and move with the event (e.g. The Leap of Haruhi Suzumiya's collab banner 1574;
        // they used to be dropped here, so a moved collab event's banner stayed on its old dates)
        noteShared(events)
        for (let i = events.length - 1; i >= 0; i--) {
            const ev = events[i]
            if (!globalDev.has(ev.key)) continue
            if (globalDev.get(ev.key) === ev.dev) {
                // the same event in both games: global's entry is used, plus the rows CN has for it (missions, shop
                // items, home banners... CN added its own, under row numbers global's entry doesn't list)
                sharedEvents.set(ev.key, ev)
                events.splice(i, 1)
            } else {
                // the same number is a different event in CN (e.g. boss event 100007): kept, under a key of its own
                clashKeys.push(ev.key)
                ev.key = `${ev.key}-cn`
            }
        }
    }
    // CN: a summon banner's feature pictures (master/gacha/gacha_feature_content "<banner>/<n>", kind 1
    // = a picture in column 1), for banners whose list picture isn't in the files
    const featurePictures = new Map()
    if (CN) for (const { p: key, t: line } of await readTable("master/gacha/gacha_feature_content.orderedmap")) {
        const c = splitCsv(line)
        if (c[0] === "1" && c[1]) { const id = key.split("/")[0]; if (!featurePictures.has(id)) featurePictures.set(id, c[1]) }
    }
    /** The first of the pictures the files have. With a key, its game-file path is kept too (artPaths, CN only):
     *  News posts show it with <img src="file://<path>"> (src/nya/autoNews.ts). */
    const artPaths = new Map()
    const firstImage = async (...candidates) => {
        for (const logical of candidates) { const id = await copyImage(index, logical); if (id) { firstImage.last = logical; return id } }
        return null
    }
    // [path, width, height]: the size from the copied file (the CN game's own picture when CN has it), so a News post
    // can show it at the post's width without squashing it
    const keepPath = (key, id, logical) => {
        if (!CN || !id || !logical) return
        let width = 0, height = 0
        try { const head = fs.readFileSync(path.join(IMAGES_OUT, `${id}.png`)).subarray(0, 24); width = head.readUInt32BE(16); height = head.readUInt32BE(20) } catch { }
        artPaths.set(key, width > 0 && height > 0 ? [logical, width, height] : [logical])
    }
    /** An event's banner picture: the banner column, else the boss battle banner, the logo, the background, or a
     *  backslash path (CN's passes). Phased events list one banner per phase ("a,b,c"); the first one is shown. */
    const eventImage = async (ev) => {
        const cells = splitCsv(ev.row.t)
        const banner = cells.find(v => v.startsWith("quest/event/banner/"))?.split(",")[0]
        const fallbacks = ["quest/event/bossbattle_banner/", "quest/event/logo/", "quest/event/background/", "dynamic\\"].map(prefix => cells.find(v => v.startsWith(prefix))?.split(",")[0]?.split("\\").join("/"))
        const id = await firstImage(banner, ...fallbacks)
        keepPath(ev.key, id, firstImage.last)
        return id
    }
    for (const ev of events) {
        ev.image = await eventImage(ev)
        if (ev.image) pictures++
        ev.bannerInfo = []
        for (const r of ev.banners) {
            const f = splitCsv(r.t)
            const image = await copyImage(index, f[3])
            if (image) pictures++
            keepPath(`gacha:${r.p}`, image, f[3])
            ev.bannerInfo.push({ id: r.p, name: names[f[1]] ?? f[1], image })
        }
    }
    // the events both games have use global's catalog entry (and picture); the CN app's own picture of each, for
    // its News posts
    if (CN) for (const ev of sharedEvents.values()) {
        await eventImage(ev)
        for (const r of ev.banners) { const f = splitCsv(r.t); keepPath(`gacha:${r.p}`, await copyImage(index, f[3]), f[3]) }
    }
    console.log(`${pictures} pictures in ${path.relative(ROOT, IMAGES_OUT)}`)

    // summon banners, schedulable on their own
    for (const r of rowsByTable[GACHA_TABLE]) {
        const f = splitCsv(r.t)
        if (!/^\d{4}-/.test(f[29] ?? "") || !/^\d{4}-/.test(f[30] ?? "")) continue
        const close = /^\d{4}-/.test(f[31] ?? "") && f[31] > f[30] ? f[31] : f[30]
        events.push({
            key: `gacha:${r.p}`, family: "gacha", id: r.p, dev: f[0], name: names[f[1]] ?? f[1], rerunOf: null,
            start: f[29], end: f[30], close, row: r, linked: new Map([[`${r.table}#${r.p}`, "banner"]]), banners: [],
            image: await firstImage(f[3], featurePictures.get(r.p), f[3]?.replace("gacha_list_banner", "gacha_banner")), bannerInfo: [], bannerType: f[13] === "1" ? "armament" : "unit",
        })
        keepPath(`gacha:${r.p}`, events[events.length - 1].image, firstImage.last)
    }

    if (CN) {
        noteShared(events)
        for (let i = events.length - 1; i >= 0; i--) if (globalDev.has(events[i].key)) events.splice(i, 1)
    }

    // write: rows grouped by file, as "key/key" paths
    const tables = {}
    const group = rows => {
        const out = {}
        for (const r of rows) {
            const file = fileOf(r.table)
            tables[file] = r.table
            ;(out[file] ??= []).push(r.p)
        }
        return out
    }
    // CN dates are China time (UTC+8): shown in Japan time like global's
    const jst = d => !CN || !/^\d{4}-/.test(d ?? "") ? d : new Date(Date.parse(d.replace(" ", "T") + "Z") + 3600_000).toISOString().slice(0, 19).replace("T", " ")
    const output = {
        _note: CN
            ? "Generated by scripts/gen_event_catalog.cjs --cn: the events only the CN client has (rows in the CN game files). Dates in Japan time (UTC+9)."
            : "Generated by scripts/gen_event_catalog.cjs from the global client's master data. Dates are as written in the data (Japan time, UTC+9).",
        families: { ...Object.fromEntries(Object.entries(FAMILIES).map(([k, v]) => [k, v.label])), gacha: "Summon banner" },
        ...(CN ? { shared: [...sharedKeys].sort() } : {}),
        // CN: the rows CN's own files tie to each shared event (scripts/gen_cn_event_schedule.cjs adds them to
        // global's entry, so they move with it), and global's keys that are a different event in CN
        ...(CN ? { sharedRows: Object.fromEntries([...sharedEvents].sort().map(([key, ev]) => [key, group([...ev.linked.keys()].map(k => byKey.get(k)))])), clashes: clashKeys.sort() } : {}),
        tables,
        events: events
            .sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.key < b.key ? -1 : 1)
            .map(ev => ({
                key: ev.key, family: ev.family, id: ev.id, dev: ev.dev, name: ev.name, rerunOf: ev.rerunOf,
                ...(CN ? { cn: true } : {}),
                start: jst(ev.start), end: jst(ev.end), close: jst(ev.close),
                rowCount: ev.linked.size,
                image: ev.image,
                ...(ev.bannerType ? { bannerType: ev.bannerType } : {}),
                bannerInfo: ev.bannerInfo,
                rows: group([...ev.linked.keys()].map(k => byKey.get(k))),
                banners: group(ev.banners),
            })),
    }
    const out = path.join(ROOT, "assets", CN ? "event_catalog_cn.json" : "event_catalog.json")
    fs.writeFileSync(out, JSON.stringify(output))
    if (CN) {
        // event key -> [its picture's path in the CN game files, width, height] (for News posts' pictures)
        const artOut = path.join(ROOT, "assets", "event_art_paths_cn.json")
        fs.writeFileSync(artOut, JSON.stringify(Object.fromEntries([...artPaths].sort())))
        console.log(`Wrote ${artOut}: ${artPaths.size} picture paths.`)
    }
    const shared = new Map()
    for (const ev of events) for (const k of ev.linked.keys()) shared.set(k, (shared.get(k) ?? 0) + 1)
    console.log(`Wrote ${out}: ${events.length} events, ${[...shared.keys()].length} rows (${[...shared.values()].filter(n => n > 1).length} shared by more than one event), ${Object.keys(tables).length} files.`)
}

main().catch(error => { console.error(error); process.exit(1) })
