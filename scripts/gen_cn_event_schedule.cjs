// The dashboard's event schedule (Events/Summons tabs, .database/event_schedule.json) for the CN
// client: the same events and banners move to the same new dates in the CN game files, shipped as the
// next CN update (scripts/build_cn_patch.cjs, served by StarPoint).
//
// CN ran events on its own dates, so each event's window is measured from its CN rows (the earliest
// and latest real date in them; far-future "never ends" dates like 2050/2199 don't count), and every
// date in those rows moves from that window to the new one, the same way as for global
// (src/lib/eventSchedule.ts mapInstant). CN master dates are China time (UTC+8).
//
// The rows are edited on top of the newest translated copy of each file (the "globalized" English
// text), and every file the schedule can touch is sent every time, so an event taken off the
// schedule goes back to its CN dates. Run it again after building a new translation update, since
// that update ships whole files without the moves.
//
//   npx tsc && node scripts/gen_cn_event_schedule.cjs [translated dir]
const fs = require("fs")
const { cnZips } = require("./cn_archives.cjs")
const path = require("path")
const unzipper = require("unzipper")
const R = require("./cdn_rows.cjs")
// the follow-up generators run as worker threads (no second Node process: see run_script.cjs)
const { runScriptOrThrow } = require("./run_script.cjs")
const { parseSchedule, planRowMoves } = require("../out/lib/eventSchedule.js")

/**
 * Moves a CN date from the event's CN window to its new one. Dates inside the window are scaled to
 * the new window (global's mapInstant clamps them to the new end when the new window is shorter,
 * which puts distinct dates such as a raid's battle end and reward end on the same second, and the
 * client then builds banner ranges that end before they start: error C2044). Scaling keeps every
 * date in order. Dates outside the window keep their distance from it.
 */
// each family's own table and its start/end columns in CN's data (scripts/gen_event_catalog.cjs, CN layout)
const OWN_WINDOW = {
    story_event: { table: "master/quest/event/story_event.orderedmap", start: 16, end: 17 },
    world_story_event: { table: "master/quest/event/world_story_event.orderedmap", start: 22, end: 23 },
    advent_event: { table: "master/quest/event/advent_event.orderedmap", start: 24, end: 25 },
    carnival_event: { table: "master/quest/event/carnival_event.orderedmap", start: 20, end: 21 },
    hard_multi_event: { table: "master/quest/event/hard_multi_event.orderedmap", start: 23, end: 24 },
    raid_event: { table: "master/quest/event/raid_event.orderedmap", start: 22, end: 23 },
    ranking_event: { table: "master/quest/event/ranking_event.orderedmap", start: 18, end: 19 },
    rush_event: { table: "master/quest/event/rush_event.orderedmap", start: 15, end: 16 },
    gacha: { table: "master/gacha/gacha.orderedmap", start: 29, end: 30 },
    pass_card_event: { table: "master/pass_card/pass_card_event.orderedmap", start: 8, end: 9 },
}

function mapCnInstant(ms, from, to) {
    if (ms <= from.start) return to.start + (ms - from.start)
    if (ms >= from.end) return to.end + (ms - from.end)
    const span = from.end - from.start
    return to.start + Math.floor((ms - from.start) * (to.end - to.start) / span / 1000) * 1000
}
const { build } = require("./build_cn_patch.cjs")

const ROOT = path.join(__dirname, "..")
const CN_DIR = require("./cn_archives.cjs").cnDir()
const TRANSLATED = process.argv[2] ?? require("./cn_archives.cjs").cnTextDir()
const { cdnDir, dataDir } = require("./cn_archives.cjs")
const { scheduleFingerprint } = require("./schedule_fingerprint.cjs")
const ES = require("./enemy_scaling.cjs")
const { uploadPath: fileOf } = require("./cdn_hash.cjs")
// the yearly free pull copies this update has (.database/cn_schedule_built.json): the server never sends the
// CN client a used copy it doesn't have (an unknown campaign id stops it with C8601)
const builtFreePullCopyIds = []
const PATCHES = path.join(cdnDir(), "cn_patches", "patches.json")
const OFFSET = 8 * 3600 * 1000
const DATE = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g
const parse = t => { const ms = Date.parse(t.replace(" ", "T") + "Z"); return isNaN(ms) ? null : ms - OFFSET }
const format = ms => new Date(ms + OFFSET).toISOString().slice(0, 19).replace("T", " ")
const FAR = Date.UTC(2049, 0, 1)

// every file name in the CN game files (hashed, without "production/"), to check pictures exist
const cnNames = new Set()
async function cnFiles(wanted) {
    const map = new Map()
    // a slim CN folder (scripts/gen_cn_slim.cjs, no archives): its tables and file-name list
    if (cnZips(CN_DIR).length === 0 && fs.existsSync(path.join(CN_DIR, "names.txt"))) {
        for (const name of fs.readFileSync(path.join(CN_DIR, "names.txt"), "utf8").split(/\r?\n/)) if (name) cnNames.add(name)
        for (const p of wanted) {
            const file = path.join(CN_DIR, "tables", p)
            if (fs.existsSync(file)) map.set(p, { buffer: async () => fs.readFileSync(file) })
        }
        return map
    }
    for (const z of cnZips(CN_DIR)) for (const e of (await unzipper.Open.file(z)).files) {
        cnNames.add(e.path.split("\\").join("/").replace(/^production\/[a-z_]+\//, ""))
        if (wanted.has(e.path)) map.set(e.path, e)
    }
    return map
}
// a banner page's artwork: its feature content (master/gacha/gacha_feature_content, "<banner>/<n>":
// kind 0 = an animated feature, kind 1 = a picture in column 1), else its list picture (gacha column 3)
let featureContent = null
function cnBannerHasArt(id, listPicture) {
    const rows = Object.entries(featureContent ?? {}).filter(([k]) => k.split("/")[0] === id).map(([, line]) => R.splitCsv(line))
    if (rows.some(c => c[0] === "0" && c[2])) return true
    const pictures = rows.filter(c => c[0] === "1" && c[1]).map(c => c[1])
    if (pictures.length > 0) return pictures.some(cnHasPicture)
    return !listPicture || cnHasPicture(listPicture)
}
/** Whether the CN files have a picture (logical path without ".png"). */
const cnHasPicture = logical => cnNames.has(fileOf(logical + ".png").replace(/^production\/upload\//, ""))

/**
 * The game needs a regular (everyday) login bonus open at every date: its login bonus screen stops with
 * error C2030 ("no normal bonus within its period") otherwise. CN's regular bonuses (kind 0, column 0)
 * leave a gap: "normal" ends 2020-01-01 and the next one starts 2021-11-25. Any gap between regular
 * bonuses is closed by keeping the earlier one open until the next starts (CN columns 41 open, 42 close).
 */
function fillNormalLoginBonusGaps(tree) {
    const groups = new Map()
    for (const { path: keys, leaf } of R.leaves(tree)) {
        const fields = R.splitCsv(leaf.text.replace(/\n$/, ""))
        if (fields[0] !== "0" || fields.length < 43) continue
        const g = groups.get(keys[0]) ?? { key: keys[0], start: fields[41], end: fields[42], leaves: [] }
        g.leaves.push(leaf)
        groups.set(keys[0], g)
    }
    const sorted = [...groups.values()].filter(g => parse(g.start) !== null).sort((a, b) => parse(a.start) - parse(b.start))
    for (let i = 0; i + 1 < sorted.length; i++) {
        const cur = sorted[i], next = sorted[i + 1]
        const end = parse(cur.end), nextStart = parse(next.start)
        if (end === null || nextStart === null || end + 1000 >= nextStart) continue
        const newEnd = format(nextStart - 1000)
        for (const leaf of cur.leaves) {
            const fields = R.splitCsv(leaf.text.replace(/\n$/, ""))
            fields[42] = newEnd
            R.setLeafText(leaf, fields.map(R.csvField).join(",") + (leaf.text.endsWith("\n") ? "\n" : ""))
        }
        console.log(`regular login bonus "${cur.key}" kept open until ${newEnd} (the next, "${next.key}", starts then)`)
    }
}

/** Splits the pass home banner into one row per pass window (start/end of each pass, after moves). */
function passBannerWindows(trees, { banner, pass, id }) {
    const bt = trees.get(banner), pt = trees.get(pass)
    if (!bt || !pt) return
    const entry = bt.entries.find(e => e.key === id)
    if (!entry || entry.node.kind !== "leaf") return
    const fields = R.splitCsv(entry.node.text.replace(/\n$/, ""))
    const dateCols = fields.map((v, i) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v) ? i : -1).filter(i => i >= 0)
    if (dateCols.length < 2) return
    const [startCol, endCol] = dateCols
    const windows = []
    for (const { path: keys, leaf } of R.leaves(pt)) {
        const c = R.splitCsv(leaf.text.replace(/\n$/, ""))
        if (/^\d{4}-/.test(c[8] ?? "") && /^\d{4}-/.test(c[9] ?? "")) windows.push({ pass: Number(keys[0]), start: c[8], end: c[9] })
    }
    bt.entries = bt.entries.filter(e => !(e.key === id || (e.key.startsWith(id) && e.key.length === id.length + 3)))
    windows.forEach((w, i) => {
        const f = [...fields]; f[startCol] = w.start; f[endCol] = w.end
        bt.entries.push({ key: i === 0 ? id : id + String(w.pass).padStart(3, "0"), node: { kind: "leaf", text: f.map(R.csvField).join(","), original: "" } })
    })
    bt.entries.sort((a, b) => Number(a.key) - Number(b.key))
    console.log(`pass banner: ${windows.length} window(s)`)
}

/** The game clock now (.database/server_time.json, src/lib/serverClock.ts), else real time. */
function gameNowMs() {
    try {
        const clock = JSON.parse(fs.readFileSync(path.join(dataDir(), "server_time.json"), "utf8"))
        if (typeof clock.serverMs === "number") return clock.pinned || typeof clock.realMs !== "number" ? clock.serverMs : clock.serverMs + (Date.now() - clock.realMs)
    } catch { }
    return Date.now()
}

/**
 * Writes the yearly campaigns into the CN tables: a chosen login bonus gets a yearly window (its end
 * goes; CN's rows have the dates one column later than global's: 41/42 open, 43/44 yearly), a chosen
 * free pull a row for every year in the copy window listing every regular unit banner CN has, and a chosen
 * stamina/reward campaign run a copy of its rows for every year in the copy window. Global's dates (UTC) become
 * China time. Returns a summary.
 */
/**
 * The Haunt's months outside CN's 48 (src/lib/towerRotation.ts): copies of the floor sets, one per month on the
 * same loop, each with its own quest ids so the floors reset monthly. Only for the game clock's year -1 to +1 (the
 * same window as the yearly campaign copies, rebuilt when the clock leaves it): copies for every year to 2199
 * would be thousands of rows. Dates are China time, like the table's.
 */
function addTowerCopies(tree) {
    const T = require("../out/lib/towerRotation.js")
    const list = tree.entries.find(e => e.key === "1")?.node
    if (!list || list.kind !== "map") return "The Haunt: no floor list, no copies"
    const rows = new Map(list.entries.filter(e => e.node.kind === "leaf").map(e => [Number(R.splitCsv(e.node.text.replace(/\n$/, ""))[0]), e.node.text]))
    const gameYear = new Date(gameNowMs()).getUTCFullYear()
    const pad = n => String(n).padStart(2, "0")
    let months = 0
    for (let year = gameYear - 1; year <= gameYear + 1; year++) for (let month = 1; month <= 12; month++) {
        if (!T.isTowerCopyMonth(year, month)) continue
        const set = T.towerSetForMonth(year, month)
        const next = month === 12 ? [year + 1, 1] : [year, month + 1]
        const first = year === T.TOWER_FIRST_MONTH.year && month === T.TOWER_FIRST_MONTH.month
        const start = `${year}-${pad(month)}-12 ${first ? "12:00:00" : "05:00:00"}`
        const end = `${next[0]}-${pad(next[1])}-12 04:59:59`
        for (let floor = 1; floor <= 10; floor++) {
            const text = rows.get(T.towerQuestId(set, floor))
            if (!text) continue
            const lines = R.splitCsvLines(text.replace(/\n$/, "")), c = R.splitCsv(lines[0])
            c[0] = String(T.towerCopyQuestId(year, month, floor))
            c[5] = start
            c[6] = end
            // the floor before it (column 13) is the copy's own floor, not CN's
            const before = Number(c[13])
            if (before >= T.towerQuestId(set, 1) && before <= T.towerQuestId(set, 10)) c[13] = String(T.towerCopyQuestId(year, month, before - T.towerQuestId(set, 1) + 1))
            lines[0] = c.map(R.csvField).join(",")
            // the game takes the quest id from the key (1000 + key), so the key is fixed per month and floor
            list.entries.push({ key: String(T.towerCopyKey(year, month, floor)), node: { kind: "leaf", text: lines.join("\n") + (text.endsWith("\n") ? "\n" : ""), original: "" } })
        }
        months++
    }
    if (months > 0) { list.entries.sort((a, b) => Number(a.key) - Number(b.key)); list.dirty = true }
    return `The Haunt: ${months} month(s) of floor copies for ${gameYear - 1}-${gameYear + 1}`
}

function applyYearlyCampaigns(trees, files, cnWindows = {}) {
    const C = require("../out/lib/campaignSchedule.js")
    const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"))
    // Copies only for the game clock's year -1 to +1 (last year: runs over New Year; next year: ready before the year changes). The CN client scans every
    // stamina/reward campaign row for every event banner it shows, so copies up to 2099 (17,000+ rows)
    // froze the Events screen for ~20 s. The server rebuilds this update when the game clock leaves the
    // window (src/nya/eventSchedule.ts checkCnCopyWindow), using .database/cn_copy_window.json.
    const gameYear = new Date(gameNowMs()).getUTCFullYear()
    const window = { from: gameYear - 1, until: gameYear + 1 }
    const inWindow = w => w.year >= window.from && w.year <= window.until
    fs.writeFileSync(path.join(dataDir(), "cn_copy_window.json"), JSON.stringify(window))
    const scheduleFile = path.join(dataDir(), "campaign_schedule.json")
    const runTables = { reward: read("assets/reward_campaign.json").campaigns, stamina: read("assets/stamina_campaign.json").campaigns }
    const runs = { reward: C.campaignRuns(runTables.reward), stamina: C.campaignRuns(runTables.stamina) }
    const known = { reward: runs.reward.map(r => r.key), stamina: runs.stamina.map(r => r.key) }
    const { schedule: chosen } = C.parseCampaignSchedule(fs.existsSync(scheduleFile) ? JSON.parse(fs.readFileSync(scheduleFile, "utf8")) : {}, known)
    const seasonal = read("assets/seasonal_campaigns.json")
    const cnOwn = read("assets/campaigns_cn.json")
    // the CN game runs the shared campaigns on CN's own dates (cnWindows), so their copies come from those
    // (src/nya/campaignSchedule.ts gives the CN client the same copies); the chosen runs are named by global's keys
    const allPulls = [...seasonal.freePulls.map(p => C.withCnDates(p, cnWindows[`freePull:${p.id}`])), ...cnOwn.freePulls]
    const cnRuns = {}
    for (const kind of ["reward", "stamina"]) cnRuns[kind] = C.campaignRuns(runTables[kind].map(row => C.withCnDates(row, cnWindows[`${kind}:${row.id}`])))
    const cnRunOf = (kind, run) => cnRuns[kind].find(r => r.ids.includes(run.ids[0])) ?? run
    const toCn = text => { const ms = Date.parse(String(text).replace(" ", "T") + "Z"); return isNaN(ms) ? text : format(ms) }
    let login = 0, pulls = 0, runRows = 0

    const loginTree = trees.get(files.login)
    // picked ones that overlap: only the longer repeats (the server makes the same choice), on the dates the
    // CN table has (CN's own, or moved by the event schedule)
    const firstDays = new Map(loginTree ? R.leaves(loginTree).filter(l => l.path[1] === "1").map(l => [l.path[0], R.splitCsv(l.leaf.text.replace(/\n$/, ""))]) : [])
    const loginKept = C.yearlyLoginBonusesKept(chosen.yearlyLoginBonuses.flatMap(id => {
        const f = firstDays.get(id)
        return f && f.length >= 45 && parse(f[41] ?? "") !== null && parse(f[42] ?? "") !== null ? [{ key: id, start: f[41], end: f[42] }] : []
    }), parse)
    if (loginTree) for (const { path: keys, leaf } of R.leaves(loginTree)) {
        if (!loginKept.has(keys[0])) continue
        const fields = R.splitCsv(leaf.text.replace(/\n$/, ""))
        const columns = fields.length >= 45 ? C.yearlyLoginColumns(fields[41], fields[42]) : null
        if (columns === null) { console.log(`yearly login bonus ${keys.join("/")}: its dates can't be made yearly`); continue }
        fields[42] = "(None)"
        fields[43] = columns.yearlyFrom
        fields[44] = columns.yearlyUntil
        R.setLeafText(leaf, fields.map(R.csvField).join(",") + (leaf.text.endsWith("\n") ? "\n" : ""))
        login++
    }

    const pullTree = trees.get(files.freePull)
    const gachaTree = trees.get(fileOf("master/gacha/gacha.orderedmap"))
    if (pullTree && chosen.yearlyFreePulls.length > 0) {
        const cnBanners = new Set(gachaTree ? R.leaves(gachaTree).map(l => l.path[0]) : [])
        const gachas = read("assets/gacha.json")
        const banners = Object.entries(gachas).filter(([id, g]) => C.isFreePullBanner(g) && (cnBanners.size === 0 || cnBanners.has(id))).map(([id]) => Number(id)).sort((a, b) => a - b)
        const names = new Map(R.leaves(pullTree).map(l => [l.path.join("/"), R.splitCsv(l.leaf.text.replace(/\n$/, ""))[1]]))
        // no two copies at once: the longer campaign keeps a year (the server makes the same choice)
        const kept = C.keepLongerOnOverlap(chosen.yearlyFreePulls.flatMap(id => {
            const original = allPulls.find(c => c.id === id)
            return original ? [{ key: id, length: C.runLength(original, C.parseUtcText), copies: C.freePullCopies(original, allPulls) }] : []
        }), C.parseUtcText)
        for (const id of chosen.yearlyFreePulls) {
            const original = allPulls.find(c => c.id === id)
            if (!original) continue
            const cnOnly = !seasonal.freePulls.some(c => c.id === id)
            for (const found of (kept.get(id) ?? []).filter(c => c.year <= window.until).filter(inWindow)) {
                const copy = cnOnly ? { ...found, id: C.cnFreePullCopyId(found.year, found.originalId) } : found
                const row = C.freePullCopyRow({ ...original, name: names.get(String(id)) ?? original.name }, { ...copy, start: toCn(copy.start), end: toCn(copy.end) }, banners)
                pullTree.entries.push({ key: String(copy.id), node: { kind: "leaf", text: row, original: "" } })
                builtFreePullCopyIds.push(copy.id)
                pulls++
            }
        }
        if (pulls > 0) pullTree.entries.sort((a, b) => Number(a.key) - Number(b.key))
    }

    for (const kind of ["reward", "stamina"]) {
        const tree = trees.get(files[kind])
        if (!tree) continue
        const added = []
        const keys = kind === "reward" ? chosen.yearlyRewardRuns : chosen.yearlyStaminaRuns
        // no two copies at once: the longer run keeps a year (the server makes the same choice)
        const kept = C.keepLongerOnOverlap(keys.flatMap(key => {
            const run = runs[kind].find(r => r.key === key)
            if (!run) return []
            const own = cnRunOf(kind, run)
            return [{ key, length: C.runLength(own, C.parseUtcText), copies: C.runCopies(own, cnRuns[kind]) }]
        }), C.parseUtcText)
        for (const key of keys) {
            const run = runs[kind].find(r => r.key === key)
            if (!run) continue
            for (const copyWindow of (kept.get(key) ?? []).filter(c => c.year <= window.until).filter(inWindow)) for (const id of run.ids) {
                const entry = tree.entries.find(e => e.key === String(id))
                if (!entry || entry.node.kind !== "leaf") continue
                const fields = R.splitCsv(entry.node.text.replace(/\n$/, ""))
                fields[1] = toCn(copyWindow.start)
                fields[2] = toCn(copyWindow.end)
                const index = runTables[kind].findIndex(row => row.id === id)
                added.push({ key: String(C.campaignCopyId(copyWindow.year, index)), node: { kind: "leaf", text: fields.map(R.csvField).join(","), original: "" } })
            }
        }
        if (added.length > 0) {
            tree.entries.push(...added)
            tree.entries.sort((a, b) => Number(a.key) - Number(b.key))
            runRows += added.length
        }
    }
    return `${login} yearly login bonus rows, ${pulls} free pull copies, ${runRows} stamina/reward campaign copies`
}

/**
 * Replaces rows of a table (assets/kit_dates.json stages, unit changes): row key ("/"-joined path) -> the whole
 * row's text, or { cols: { <index>: value } } for some columns of its first line. Returns how many were found.
 */
function replaceRows(tree, wanted) {
    let set = 0
    for (const { path: keys, leaf } of R.leaves(tree)) {
        const row = wanted.get(keys.join("/"))
        if (row === undefined) continue
        const end = leaf.text.endsWith("\n") ? "\n" : ""
        if (typeof row === "string") R.setLeafText(leaf, row.replace(/\n$/, "") + end)
        else {
            const lines = R.splitCsvLines(leaf.text.replace(/\n$/, "")), cols = R.splitCsv(lines[0])
            for (const [i, v] of Object.entries(row.cols ?? {})) cols[+i] = String(v)
            lines[0] = cols.map(R.csvField).join(",")
            R.setLeafText(leaf, lines.join("\n") + end)
        }
        set++
    }
    return set
}

async function main() {
    // the schedules this update is built from (compared by the server at start, src/nya/eventSchedule.ts)
    const fingerprint = scheduleFingerprint(dataDir())
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "event_catalog.json"), "utf8"))
    // plus the events only CN has (scripts/gen_event_catalog.cjs --cn)
    const cnCatalogFile = path.join(ROOT, "assets", "event_catalog_cn.json")
    if (fs.existsSync(cnCatalogFile)) {
        const cnCatalog = JSON.parse(fs.readFileSync(cnCatalogFile, "utf8"))
        const known = new Set(catalog.events.map(e => e.key))
        catalog.events.push(...cnCatalog.events.filter(e => !known.has(e.key)))
        catalog.tables = { ...cnCatalog.tables, ...catalog.tables }
    }
    const scheduleFile = path.join(dataDir(), "event_schedule.json")
    const raw = fs.existsSync(scheduleFile) ? JSON.parse(fs.readFileSync(scheduleFile, "utf8")) : { entries: [] }
    const { schedule } = parseSchedule(raw, catalog)
    const { moves } = planRowMoves(catalog, schedule)
    // the banner rows the schedule moves (a banner without art is still moved when it's on the schedule)
    const GACHA_FILE = fileOf("master/gacha/gacha.orderedmap")
    const movedGacha = new Set([...moves.keys()].filter(k => k.startsWith(GACHA_FILE + "#")).map(k => k.slice(GACHA_FILE.length + 1)))

    // every file the schedule can touch, from the newest translated copy (else CN's own)
    // tables CN closed on its shutdown day (2025-08-14 23:59:59, China time) that global keeps open:
    // their rows ending then are kept open (2199-12-31), so e.g. the Star Sliver exchange isn't empty
    const EOS_TABLES = ["master/shop/star_crumb_exchange.orderedmap"].map(fileOf)
    // Permanent Events-tab dungeons whose CN dates leave a hole (the early rows are JP's schedule):
    // - element dungeons: the weekday rotation rows ended in 2018 and the every-element rows only open
    //   2020-01-15, so a save starting 2019-12-01 had none; the every-element rows open from 2001 instead
    //   (until 2022-05-31 as before, when the combined dungeon takes over)
    // - The Haunt (2022-05-12 to 2026-05-12 04:59:59, China time) opens earlier, 2020-01-12, and stays
    //   open (2199-12-31). Its floors change monthly: 48 sets of 10 quests, each with its own month. The months
    //   outside CN's get copies that carry on the same monthly loop (addTowerCopies, src/lib/towerRotation.ts).
    // the pop-up dialog table (its logical name isn't known; this is its stored path) and the dates that hide a row
    const GUIDE_DIALOGS = "production/upload/f3/5dbdf5b3c941d0a975bd5eabb5652fa411ebf9"
    const HIDDEN = ["2000-01-01 00:00:00", "2000-01-01 00:00:01"]
    // a unit banner without art: a week in 2011, before any save starts
    const NO_ART_DATES = ["2011-01-01 12:00:00", "2011-01-08 11:59:59"]
    const worldStoryStart = new Map() // world story event id -> its first date (filled when tables load)
    const cnMs = text => Date.parse(text.replace(" ", "T") + "Z")
    const cnText = ms => new Date(ms).toISOString().slice(0, 19).replace("T", " ")
    const hideBannerWithoutPicture = c => {
        const i = c.findIndex(v => /^dynamic\/home_banner\/[a-z0-9_\/]*[a-z0-9]$/.test(v))
        if (i < 0 || cnHasPicture(c[i]) || c[i + 2] === HIDDEN[0]) return false
        c[i + 1] = "0"; c[i + 2] = HIDDEN[0]; c[i + 3] = HIDDEN[1]
        return true
    }
    const TOWER_QUESTS = fileOf("master/quest/event/tower_dungeon_event_quest.orderedmap")
    const DUNGEON_FIXES = {
        [fileOf("master/quest/event/daily_week_event.orderedmap")]: (key, c) => {
            if (c[0].endsWith("_campaign") && c[16] === "2020-01-15 12:00:00") { c[16] = "2001-01-01 05:00:00"; return true }
            return false
        },
        // ...and their quests too (the every-element events 13-18, their levels 1-5; level 6, added 2020-08-13, keeps
        // its date): opened from 2020-01-15, a save before then saw the event with no quests in it
        [fileOf("master/quest/event/daily_week_event_quest.orderedmap")]: (key, c) => {
            const event = Number(key.split("/")[0])
            if (event >= 13 && event <= 18 && c[4] === "2020-01-15 12:00:00") { c[4] = "2001-01-01 05:00:00"; return true }
            return false
        },
        [fileOf("master/quest/event/tower_dungeon_event.orderedmap")]: (key, c) => {
            let changed = false
            if (c[11] === "2022-05-12 12:00:00" || c[11] === "2021-05-12 12:00:00") { c[11] = "2020-01-12 12:00:00"; changed = true }
            for (let i = 0; i < c.length; i++) if (c[i] === "2026-05-12 04:59:59") { c[i] = "2199-12-31 23:59:59"; changed = true }
            return changed
        },
        // two Launch Gala banners at once: CN's own launch banner (61, 2011-12-24 to 2021-11-04) overlaps the
        // JP-era one (1, until 2020-01-27); 61 opens when 1 closes.
        // Armament portals (equipment odds in columns 22-24) whose ticket deadline (column 31) is after their
        // pull window's end (column 30) stay listed and take ticket pulls after the end, but the client only
        // loads armament rates for portals before their end, so such a pull's result crashed (C8013 "...
        // gacha_odds/normal_equipment_3 ... not loaded"). Their ticket deadline is set to their end.
        [fileOf("master/gacha/gacha.orderedmap")]: (key, c) => {
            const date = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/
            let changed = false
            // a unit banner (character lineup, column 14) whose list picture (column 3) the CN files don't have shows
            // a blank banner and a stray preview in the game: dated 2011 so it never comes up by itself (the
            // dashboard labels it); moved on the Summons tab, it keeps the dates it was given there
            if (c[14] && c[14] !== "(None)" && c[3] && !cnHasPicture(c[3]) && !movedGacha.has(key) && date.test(c[29] ?? "") && c[29] > NO_ART_DATES[1]) {
                c[29] = NO_ART_DATES[0]; c[30] = NO_ART_DATES[1]
                if (date.test(c[31] ?? "")) c[31] = NO_ART_DATES[1]
                changed = true
            }
            if (c[22] && c[22] !== "(None)" && !(c[14] && c[14] !== "(None)") && date.test(c[30] ?? "") && date.test(c[31] ?? "") && c[31] > c[30]) {
                c[31] = c[30]
                changed = true
            }
            // Armament portals with column 44 (freemium_guarantee_available) false show no Exchange button, and the
            // client then keeps their armament rates loaded only by chance (e.g. a featured list), yet the pull
            // result screen reads them for the exchange points: C8013 "gacha_odds/... not loaded" (e.g. 5008 and
            // the JP-era 3, normal_equipment_3). Set true: their rates stay loaded and the Exchange button shows
            // (the server has /gacha/exchange_equipment).
            if (c[22] && c[22] !== "(None)" && !(c[14] && c[14] !== "(None)") && c[44] === "false") { c[44] = "true"; changed = true }
            if (key !== "61" || c[0] !== "newnormal_1") return changed
            const i = c.indexOf("2011-12-24 12:00:00")
            if (i < 0) return false
            c[i] = "2020-01-27 12:00:00"
            return true
        },
        // login announcements ("TAP SCREEN" pages) and pop-up dialogs whose picture is in neither the CN files
        // nor StarPoint's patches (scripts/gen_cn_art_fill.cjs adds global's) show blank: hidden (dates in 2000)
        [fileOf("master/feature_banner/feature_announcement.orderedmap")]: (key, c) => {
            if (!c[1] || c[1] === "(None)" || cnHasPicture(c[1]) || c[2] === HIDDEN[0]) return false
            c[2] = HIDDEN[0]; c[3] = HIDDEN[1]
            return true
        },
        // home banners too (their picture column, then show kind, start, end): a picture found nowhere hides the banner
        // (names ending in "_" are completed by the client, left alone)
        // a world story event's banner (link kind 6, event id in column 15) whose dates (column 27) aren't its
        // event's (CN copied JP's: e.g. Cyberpunk's banner 100100 carries Fake Princess's dates; reruns keep the
        // first run's) is moved to start with its event, keeping its own steps (prequel, sequel, end)
        [fileOf("master/feature_banner/feature_banner.orderedmap")]: (key, c) => {
            let changed = false
            const start = c[14] === "6" ? worldStoryStart.get(c[15]) : undefined
            const dates = (c[27] ?? "").split(",")
            if (start && /^\d{4}-/.test(dates[0]) && dates[0] !== start) {
                const shift = cnMs(start) - cnMs(dates[0])
                c[27] = dates.map(d => /^\d{4}-/.test(d) ? cnText(cnMs(d) + shift) : d).join(",")
                changed = true
            }
            return hideBannerWithoutPicture(c) || changed
        },
        [fileOf("master/feature_banner/feature_banner_secondary.orderedmap")]: (key, c) => hideBannerWithoutPicture(c),
        [GUIDE_DIALOGS]: (key, c) => {
            if (c[3] && c[3] !== "(None)" && cnHasPicture(c[3])) return false
            const i = c.findIndex(v => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v))
            if (i < 0 || c[i] === HIDDEN[0]) return false
            c[i] = HIDDEN[0]; c[i + 1] = HIDDEN[1]
            return true
        },
    }
    // the yearly campaigns (dashboard Campaigns tab) are written in these, every time
    const CAMPAIGN_TABLES = {
        login: fileOf("master/bonus/login_bonus.orderedmap"),
        freePull: fileOf("master/gacha/gacha_campaign.orderedmap"),
        reward: fileOf("master/campaign/reward_campaign.orderedmap"),
        stamina: fileOf("master/campaign/stamina_campaign.orderedmap"),
    }
    // the home "Way of Practice" banner (feature_banner_secondary 20016) runs 2024-2099 in CN, which had a
    // pass every month; here it gets one row per pass window, so it's only up while a pass is (C25000 otherwise)
    const PASS_BANNER = { banner: fileOf("master/feature_banner/feature_banner_secondary.orderedmap"), pass: fileOf("master/pass_card/pass_card_event.orderedmap"), id: "20016" }
    // Unit kits before a balance change (assets/kit_dates.json, scripts/kit_dates.cjs): until a stage's date
    // on the game clock its rows ship instead of the game's own. The tables are shipped whenever the file
    // exists, so a later update puts the game's own rows back. A stage with a far "until" (e.g. 2199) is a
    // lasting change to an existing unit (docs/CUSTOM_UNITS.md, "Changing an existing unit"). Tables are named by
    // logical name or by stored path (upload/xx/..., for tables without a known name, e.g. character_status).
    const CU = require("./custom_units.cjs")
    const KIT = require("./kit_dates.cjs")
    const kits = KIT.readKits(path.join(ROOT, "assets", "kit_dates.json"))
    const kitRows = new Map() // file -> Map(row key -> old text or column patch)
    const kitTables = new Set()
    const kitNow = gameNowMs()
    for (const [unit, stages] of kits ?? []) {
        for (const stage of stages) for (const ref of Object.keys(stage.rows)) kitTables.add(CU.tableFile(ref.slice(0, ref.indexOf("#"))))
        const stage = KIT.activeStages(new Map([[unit, stages]]), kitNow).get(unit)
        if (stage === null) continue
        for (const [ref, text] of Object.entries(stage.rows)) {
            const file = CU.tableFile(ref.slice(0, ref.indexOf("#")))
            if (!kitRows.has(file)) kitRows.set(file, new Map())
            kitRows.get(file).set(ref.slice(ref.indexOf("#") + 1), text)
        }
    }
    const kitState = KIT.kitState(kits, kitNow)
    // Changes to existing units (<custom units folder>/changes/*.json, docs/CUSTOM_UNITS.md): always, on top of the
    // game's rows and of any kit stage above
    const changes = CU.readUnitChanges()
    for (const p of changes.problems) console.log(`Unit change skipped: ${p}`)
    // Enemy strength (dashboard, scripts/enemy_scaling.cjs): every enemy's HP and attack multiplied
    const enemy = ES.readEnemyScaling(dataDir())
    const enemyTables = ES.isDefault(enemy) ? [] : ES.TABLES.map(fileOf)
    // tables the last build changed ship once more, so a change taken away goes back to the game's own rows
    const lastChanged = (() => { try { return JSON.parse(fs.readFileSync(path.join(dataDir(), "cn_schedule_built.json"), "utf8")).changedTables ?? [] } catch { return [] } })()
    // The CN client opens each unit's Mana Board 2 from a date in this table ("<unit>": "<from>,<until>") and
    // the game clock. A unit a save already has on board 2 (.database/cn_mb2_in_use.json, written by the
    // server before each build) crashes its board screen (F1009) while that date is ahead of the clock, so
    // its board 2 is kept open. The dates are also saved for the server, to rebuild when the clock goes back.
    // (its logical name isn't known; this is its stored path, found by the unit -> date rows matching each
    // unit's "finish Mana Board 2" title mission)
    const MB2_OPEN = "production/upload/bc/0bc800f482670f3ec8a7f2fee9b9deeeca3a04"
    // the CN game's start (China time); launch units with board 2 before it are moved to later waves
    const LAUNCH_MB2_FROM = "2019-12-01 00:00:00"
    const mb2InUse = new Set((() => { try { return JSON.parse(fs.readFileSync(path.join(dataDir(), "cn_mb2_in_use.json"), "utf8")).map(String) } catch { return [] } })())
    // Custom units (assets/custom_units/*.json, scripts/custom_units.cjs, docs/CUSTOM_UNITS.md): their rows are
    // added to every table they touch, and those tables always ship, so a rebuild never drops a unit a save has
    // (C8601). The unit's own files (art, voices) are a separate update; a unit whose files aren't in the CN
    // files or StarPoint's updates yet is left out (the game would ask for them: "Insufficient data").
    const custom = CU.readCustomUnits()
    for (const p of custom.problems) console.log(`Custom unit skipped: ${p}`)
    const customTables = CU.unitTables(custom.units)
    const fileList = [...new Set([...Object.keys(catalog.tables), ...EOS_TABLES, ...Object.values(CAMPAIGN_TABLES), PASS_BANNER.banner, PASS_BANNER.pass, ...kitTables, MB2_OPEN, TOWER_QUESTS, ...Object.keys(DUNGEON_FIXES), ...customTables, ...changes.rows.keys(), ...enemyTables, ...lastChanged])].sort()
    const featureFile = fileOf("master/gacha/gacha_feature_content.orderedmap")
    const cn = await cnFiles(new Set([...fileList, featureFile]))
    // art StarPoint's patches added (scripts/gen_cn_banner_art.cjs) counts too: their file names and
    // their newest copy of the feature table (only for this check; tables are still edited from the
    // translated/CN copies, never from an earlier schedule's output)
    let featureBuf = cn.has(featureFile) ? await cn.get(featureFile).buffer() : null
    if (fs.existsSync(PATCHES)) for (const p of JSON.parse(fs.readFileSync(PATCHES, "utf8"))) for (const a of p.archives) {
        const zf = path.join(path.dirname(PATCHES), a.file)
        if (!fs.existsSync(zf)) continue
        for (const e of (await unzipper.Open.file(zf)).files) {
            const name = e.path.split("\\").join("/")
            cnNames.add(name.replace(/^production\/[a-z_]+\//, ""))
            if (name === featureFile) featureBuf = await e.buffer()
        }
    }
    if (featureBuf) {
        featureContent = {}
        for (const { path: keys, leaf } of R.leaves(R.decodeFile(featureBuf))) featureContent[keys.join("/")] = leaf.text
    }
    const trees = new Map()
    // the translated dir's files.json names every translated table, also the ones kept from an
    // earlier step's dir (only the tables the last step changed are in the dir itself)
    const listFile = path.join(TRANSLATED, "files.json")
    const translatedFrom = new Map(fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, "utf8")).map(f => [f.path, f.from]) : [])
    // each world story event's first date (CN time), for its home banners (BANNER_FIXES below)
    {
        const file = fileOf("master/quest/event/world_story_event.orderedmap")
        const from = translatedFrom.get(file)
        const translated = from && fs.existsSync(from) ? from : path.join(TRANSLATED, file)
        const buf = fs.existsSync(translated) ? fs.readFileSync(translated) : await cn.get(file)?.buffer()
        if (buf) for (const { path: keys, leaf } of R.leaves(R.decodeFile(buf))) {
            const first = (leaf.text.match(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/) ?? [])[0]
            if (first && keys.length === 1) worldStoryStart.set(keys[0], first)
        }
    }
    // files.json's paths are the PC's; on a phone the copy sits in the dir itself (src/routes/companion.ts)
    const tableBuffer = async file => {
        const from = translatedFrom.get(file)
        const translated = from && fs.existsSync(from) ? from : path.join(TRANSLATED, file)
        return fs.existsSync(translated) ? fs.readFileSync(translated) : await cn.get(file)?.buffer()
    }
    // the custom units this update carries: not a CN unit's id or string id, and their files are there
    const customUnits = [], customWaiting = []
    if (custom.units.length > 0) {
        const charBuf = await tableBuffer(CU.CHARACTER_TABLE)
        const cnChars = charBuf ? R.decodeFile(charBuf).entries : []
        const cnIds = new Set(cnChars.map(e => e.key))
        const cnDevs = new Set(R.leaves({ kind: "map", entries: cnChars }).map(l => R.splitCsv(l.leaf.text)[0]))
        for (const unit of custom.units) {
            const missing = (unit.art?.files ?? []).filter(f => !cnNames.has(f.replace(/^production\/[a-z_]+\//, "")))
            if (cnIds.has(unit.id)) console.log(`Custom unit ${unit.id} skipped: the CN game has a unit with that id`)
            else if (cnDevs.has(unit.dev)) console.log(`Custom unit ${unit.id} skipped: the CN game has a unit with string id ${unit.dev}`)
            else if (missing.length > 0) {
                customWaiting.push(unit.id)
                console.log(`Custom unit ${unit.id} skipped: ${missing.length} of its files aren't in the game files yet (build its art update first${unit.art?.patch ? `, ${unit.art.patch}` : ""})`)
            }
            else {
                if (!unit.art?.files?.length) console.log(`Custom unit ${unit.id}: no files listed (art.files), shipped anyway`)
                customUnits.push(unit)
            }
        }
    }
    for (const file of fileList) {
        const buf = await tableBuffer(file)
        if (!buf) continue // a table CN doesn't have
        const tree = R.decodeFile(buf)
        // custom units' rows first, so the fixes below (e.g. Mana Board 2 kept open for a save) apply to them too
        for (const unit of customUnits) {
            const rows = Object.entries(unit.rows).filter(([ref]) => CU.tableFile(ref) === file)
            for (const [, r] of rows) CU.addRows(tree, r)
        }
        if (EOS_TABLES.includes(file)) for (const { leaf } of R.leaves(tree)) {
            if (leaf.text.includes("2025-08-14 23:59:59")) R.setLeafText(leaf, leaf.text.split("2025-08-14 23:59:59").join("2199-12-31 23:59:59"))
        }
        if (file === CAMPAIGN_TABLES.login) fillNormalLoginBonusGaps(tree)
        if (DUNGEON_FIXES[file]) {
            let fixed = 0
            for (const { path: keys, leaf } of R.leaves(tree)) {
                const end = leaf.text.endsWith("\n") ? "\n" : ""
                const lines = R.splitCsvLines(leaf.text.replace(/\n$/, "")), c = R.splitCsv(lines[0])
                if (!DUNGEON_FIXES[file](keys[0], c)) continue
                lines[0] = c.map(R.csvField).join(",")
                R.setLeafText(leaf, lines.join("\n") + end)
                fixed++
            }
            console.log(`Date fixes: ${fixed} row(s) changed in ${file}`)
        }
        if (file === TOWER_QUESTS) console.log(addTowerCopies(tree))
        if (file === MB2_OPEN) {
            const dates = {}
            let kept = 0
            // CN copies JP's early schedule, and opens board 2 of its launch units (89) from 2015, before the game
            // starts. Units on JP's board 2 wave list (assets/mb2_jp_waves.json) open on the earlier of CN's date and
            // their JP wave (wave 1 when Ether can first be had, then monthly); the launch units all are on it
            const rows = R.leaves(tree)
            const jp = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "mb2_jp_waves.json"), "utf8"))
            const waveDate = n => {
                const d = new Date(jp.firstWave.replace(" ", "T") + "Z")
                d.setUTCMonth(d.getUTCMonth() + n - 1)
                return d.toISOString().slice(0, 19).replace("T", " ")
            }
            for (const { path: keys, leaf } of rows) {
                const end = leaf.text.endsWith("\n") ? "\n" : ""
                const fields = R.splitCsv(leaf.text.replace(/\n$/, ""))
                const n = jp.units[keys[0]]
                const target = n === undefined ? null : waveDate(n)
                if (target !== null && (fields[0] < LAUNCH_MB2_FROM || fields[0] > target)) {
                    fields[0] = target
                    R.setLeafText(leaf, fields.map(R.csvField).join(",") + end)
                }
                if (mb2InUse.has(keys[0]) && fields[0] > "2015-03-01 15:00:00") {
                    fields[0] = "2015-03-01 15:00:00"
                    R.setLeafText(leaf, fields.map(R.csvField).join(",") + end)
                    kept++
                }
                dates[keys[0]] = fields[0]
            }
            fs.writeFileSync(path.join(dataDir(), "cn_mb2_dates.json"), JSON.stringify({ keptOpen: [...mb2InUse].sort(), dates }))
            if (kept > 0) console.log(`Mana Board 2: ${kept} unit(s) a save already uses kept open`)
        }
        if (kitRows.has(file)) console.log(`Unit kits before a balance change: ${replaceRows(tree, kitRows.get(file))} row(s) in ${file}`)
        if (changes.rows.has(file)) console.log(`Unit changes: ${replaceRows(tree, changes.rows.get(file))} of ${changes.rows.get(file).size} row(s) in ${file}`)
        if (enemyTables.includes(file)) console.log(`Enemy strength: HP x${enemy.hp}, attack x${enemy.atk} on ${ES.scaleTree(tree, enemy, R)} row(s) in ${file}`)
        trees.set(file, tree)
    }

    // the catalog names global's banner ids; CN gave some of global's banners new ids (usually
    // 10000 + the global id) and reused the old ids for its own reruns, so a banner is found by its
    // internal name (gacha column 0) when the same id is a different banner in CN. Global's names are
    // in assets/global_gacha_names.json, so this works without the global game files.
    const gachaFile = fileOf("master/gacha/gacha.orderedmap")
    let cnBannerId = id => id
    const namesFile = path.join(ROOT, "assets", "global_gacha_names.json")
    if (trees.has(gachaFile) && fs.existsSync(namesFile)) {
        const globalNames = JSON.parse(fs.readFileSync(namesFile, "utf8")).names
        const name = line => R.splitCsv(String(line))[0]
        const cnRows = new Map(R.leaves(trees.get(gachaFile)).map(l => [l.path.join("/"), name(l.leaf.text)]))
        const cnByName = new Map([...cnRows].map(([id, n]) => [n, id]))
        cnBannerId = id => {
            const g = globalNames[id]
            if (!g || cnRows.get(id) === g || !cnByName.has(g)) return id
            return cnByName.get(g)
        }
    }

    // moves grouped by event: the CN rows and their CN window
    const byEvent = new Map()
    for (const [key, move] of moves) {
        let [file, p] = [key.slice(0, key.indexOf("#")), key.slice(key.indexOf("#") + 1)]
        if (file === gachaFile && cnBannerId(p) !== p) {
            console.log(`${move.eventKey}: global banner ${p} is CN banner ${cnBannerId(p)}`)
            p = cnBannerId(p)
        }
        if (!byEvent.has(move.eventKey)) byEvent.set(move.eventKey, { move, rows: [] })
        byEvent.get(move.eventKey).rows.push({ file, p })
    }
    // Each event's own dates in CN's data, before any move (.database/cn_event_windows.json, ISO UTC): the
    // dashboard shows these, since they are when the CN game runs an event that isn't moved (global's
    // dates, which the catalog has, can be years apart).
    const cnWindows = {} // also what the yearly campaigns' CN copies are built from (applyYearlyCampaigns)
    {
        const windows = cnWindows
        const rowOf = new Map()
        for (const [family, own] of Object.entries(OWN_WINDOW)) {
            const tree = trees.get(fileOf(own.table))
            if (tree) rowOf.set(family, new Map(R.leaves(tree).filter(l => l.path.length === 1).map(l => [l.path[0], l.leaf.text])))
        }
        for (const event of catalog.events) {
            const own = OWN_WINDOW[event.family], rows = rowOf.get(event.family)
            if (!own || !rows) continue
            const id = event.family === "gacha" ? cnBannerId(event.id) : event.id
            const text = rows.get(id)
            if (text === undefined) continue
            const c = R.splitCsv(text)
            const first = v => parse(((v ?? "").match(DATE) ?? [])[0] ?? "")
            const last = v => { const all = (v ?? "").match(DATE) ?? []; return parse(all[all.length - 1] ?? "") }
            const start = first(c[own.start]), end = last(c[own.end])
            if (start !== null && end !== null && end >= start) windows[event.key] = { start: new Date(start).toISOString(), end: new Date(end).toISOString() }
        }
        // the Campaigns tab's rows: "login:<group>" (a group's first day, columns 41/42), "freePull:<id>"
        // (gacha_campaign 3/4), "reward:<id>" and "stamina:<id>" (1/2), before the yearly copies are added
        for (const [kind, table, s, e, firstDayOnly] of [["login", CAMPAIGN_TABLES.login, 41, 42, true], ["freePull", CAMPAIGN_TABLES.freePull, 3, 4], ["reward", CAMPAIGN_TABLES.reward, 1, 2], ["stamina", CAMPAIGN_TABLES.stamina, 1, 2]]) {
            const tree = trees.get(table)
            if (!tree) continue
            for (const { path: keys, leaf } of R.leaves(tree)) {
                if (firstDayOnly ? keys[1] !== "1" : keys.length !== 1) continue
                const c = R.splitCsv(leaf.text.replace(/\n$/, ""))
                const start = parse(c[s] ?? ""), end = parse(c[e] ?? "")
                if (start !== null && end !== null && end >= start) windows[`${kind}:${keys[0]}`] = { start: new Date(start).toISOString(), end: new Date(end).toISOString() }
            }
        }
        fs.writeFileSync(path.join(dataDir(), "cn_event_windows.json"), JSON.stringify(windows))
        console.log(`CN event dates: ${Object.keys(windows).length} event(s)`)
    }

    let moved = 0, events = 0
    for (const [eventKey, { move, rows }] of byEvent) {
        const leaves = []
        let ownRow = null
        const [family, eventId] = [eventKey.slice(0, eventKey.indexOf(":")), eventKey.slice(eventKey.indexOf(":") + 1)]
        const own = OWN_WINDOW[family]
        for (const { file, p } of rows) {
            const tree = trees.get(file)
            const found = tree && R.leaves(tree).find(x => x.path.join("/") === p)
            if (!found) continue
            // a summon banner the CN files have no picture for shows as an empty page, but pulls work: it moves like any
            // other (unscheduled, it's dated 2011 by the date fixes above, and the dashboard labels it)
            if (file === fileOf("master/gacha/gacha.orderedmap") && !cnBannerHasArt(p, R.splitCsv(found.leaf.text)[3])) {
                console.log(`${eventKey}: banner ${p} has no artwork in the CN files (moved anyway; it shows blank)`)
            }
            leaves.push(found.leaf)
            if (own && file === fileOf(own.table) && p === eventId) ownRow = found.leaf
        }
        const dates = leaves.flatMap(l => (l.text.match(DATE) ?? []).map(parse)).filter(ms => ms !== null && ms < FAR)
        if (dates.length === 0) { console.log(`${eventKey}: not in the CN files, skipped`); continue }
        // the event's window is its own row's start and end in CN's data (like global's, which uses the
        // event's own dates); the dates in all its linked rows (missions, items...) can reach far before
        // or after it, which used to stretch the window and push the event to the wrong days
        let from = null
        if (ownRow) {
            const c = R.splitCsv(ownRow.text)
            const first = v => parse(((v ?? "").match(DATE) ?? [])[0] ?? "")
            const last = v => { const all = (v ?? "").match(DATE) ?? []; return parse(all[all.length - 1] ?? "") }
            const start = first(c[own.start]), end = last(c[own.end])
            if (start !== null && end !== null && end > start && end < FAR) from = { start, end }
        }
        if (from === null) {
            from = { start: Math.min(...dates), end: Math.max(...dates) }
            console.log(`${eventKey}: own dates not readable, using all its rows' dates`)
        }
        for (const leaf of leaves) {
            // far-future "never ends" dates (2050, 2199) stay as they are: moved, they can pass 2200, which the
            // client refuses (C7100, e.g. an item's expiry)
            const text = leaf.text.replace(DATE, found => { const ms = parse(found); return ms === null || ms >= FAR ? found : format(mapCnInstant(ms, from, move.to)) })
            if (text !== leaf.text) { R.setLeafText(leaf, text); moved++ }
        }
        events++
    }

    // ---- yearly campaigns (.database/campaign_schedule.json, src/lib/campaignSchedule.ts), as the
    // global client's mod has them (scripts/gen_event_schedule_mod.cjs), in CN's layout and China time
    const campaignsMade = applyYearlyCampaigns(trees, CAMPAIGN_TABLES, cnWindows)
    passBannerWindows(trees, PASS_BANNER)

    // A banner with no feature content rows (its big picture and unit previews) stops the summon screen with
    // error C2032 ("no feature image for gacha ID") as soon as it's swiped to. 41 CN banners have none (mostly
    // CN's reruns of late 2021 - mid 2022, and a second Launch Gala, 61). A rerun of a banner that has them
    // ("x_1" of "x", "newx" of "x") gets that banner's rows; the rest are closed (all their dates go to
    // 2000-01-01, so the game never lists them, also when the schedule moved one). The feature table is
    // built on its newest copy, StarPoint's patches included (they add rows for translated art).
    if (featureBuf && trees.has(gachaFile)) {
        const featureTree = R.decodeFile(featureBuf)
        const featureById = new Map(featureTree.entries.map(e => [e.key, e]))
        const gachaRows = R.leaves(trees.get(gachaFile))
        const byDev = new Map(gachaRows.map(({ path: keys, leaf }) => [R.splitCsv(leaf.text)[0], keys[0]]))
        const copyNode = node => node.kind === "leaf" ? { kind: "leaf", text: node.text, original: "" } : { kind: "map", entries: node.entries.map(e => ({ key: e.key, node: copyNode(e.node) })), dirty: true }
        let copied = 0, closed = 0
        for (const { path: keys, leaf } of gachaRows) {
            const id = keys[0]
            if (featureById.has(id) || !/20\d\d-\d\d-\d\d \d\d:\d\d:\d\d/.test(leaf.text)) continue
            const dev = R.splitCsv(leaf.text)[0]
            const original = [dev.replace(/_1$/, ""), dev.replace(/^new/, ""), dev.replace(/^new/, "").replace(/_1$/, "")]
                .filter(d => d !== dev).map(d => byDev.get(d)).find(o => o !== undefined && featureById.has(o))
            if (original !== undefined) {
                featureTree.entries.push({ key: id, node: copyNode(featureById.get(original).node) })
                copied++
            } else {
                R.setLeafText(leaf, leaf.text.replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/g, "2000-01-01 00:00:00"))
                closed++
            }
        }
        if (copied > 0) {
            featureTree.entries.sort((a, b) => Number(a.key) - Number(b.key))
            featureTree.dirty = true
            trees.set(featureFile, featureTree)
        }
        if (copied || closed) console.log(`summon banners without feature content (C2032): ${copied} given their original's, ${closed} closed`)
    }

    // the next CN update
    const patches = fs.existsSync(PATCHES) ? JSON.parse(fs.readFileSync(PATCHES, "utf8")) : []
    const last = patches.length ? patches[patches.length - 1].version : "1.4.54"
    // numbered above both the list's newest and the highest version a game reported (the server keeps it in
    // cn_client_version.json): a number the game already has, with other contents, would be skipped by it
    const versionNumbers = s => s.split(".").map(Number)
    const newer = (a, b) => { const x = versionNumbers(a), y = versionNumbers(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false }
    let base = last
    try {
        const seen = JSON.parse(fs.readFileSync(path.join(dataDir(), "cn_client_version.json"), "utf8")).max
        if (typeof seen === "string" && /^\d+\.\d+\.\d+$/.test(seen) && newer(seen, base)) base = seen
    } catch { }
    const v = versionNumbers(base); v[2]++
    const version = v.join(".")
    const outDir = path.join(cdnDir(), "cn_schedule_files")
    fs.rmSync(outDir, { recursive: true, force: true })
    const list = []
    for (const [file, tree] of trees) {
        const out = path.join(outDir, file)
        fs.mkdirSync(path.dirname(out), { recursive: true })
        fs.writeFileSync(out, R.encodeFile(tree))
        list.push({ path: file, from: out })
    }
    await build(version, last, list)
    fs.writeFileSync(path.join(dataDir(), "cn_schedule_built.json"), JSON.stringify({ fingerprint, version, freePullCopyIds: builtFreePullCopyIds.sort((a, b) => a - b), kitState, customUnits: customUnits.map(u => u.id),
        // units left out only because their files weren't there yet: the server rebuilds once a newer update is listed
        customWaitingForFiles: customWaiting, changedTables: [...new Set([...changes.rows.keys(), ...enemyTables])].sort() }))
    console.log(`CN schedule ${version}: ${events} event(s), ${moved} rows moved, ${campaignsMade}, ${list.length} files`)
    if (custom.units.length > 0) console.log(`Custom units: ${customUnits.map(u => `${u.id} ${u.name ?? u.dev}`).join(", ") || "none"} (${customUnits.length} of ${custom.units.length}, rows in ${customTables.length} tables)`)
    // the server's copy of the CN missions follows the new dates
    await runScriptOrThrow(path.join(__dirname, "gen_cn_missions.cjs"), { env: { ...process.env, CN_TRANSLATED_DIR: TRANSLATED }, echo: true })
    // and the server's copy of the CN passes (a pass can be moved too)
    await runScriptOrThrow(path.join(__dirname, "gen_cn_pass_card.cjs"), { env: { ...process.env, CN_TRANSLATED_DIR: TRANSLATED }, echo: true })
    // and the server's copy of the CN shops (event shops follow moved events)
    await runScriptOrThrow(path.join(__dirname, "gen_cn_shops.cjs"), { env: { ...process.env, CN_TRANSLATED_DIR: TRANSLATED }, echo: true })
}

main().catch(e => { console.error(e.stack || e.message); process.exit(1) })
