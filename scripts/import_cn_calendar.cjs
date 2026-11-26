// Takes CN's own calendar from a CN fork's tables (晓之车's starpoint-cn "intermediate" export:
// intermediate/master/**/*.orderedmap) and writes assets/cn_calendar_dates.json: for every row both
// copies have, each date cell where the fork's date differs from the CN game files' (CN_CDN_DIR).
// Only date cells are taken, and only from rows that are the same row in both: the fork gave some row
// ids to other events (its advent 100005-100009 are collabs where CN's are reruns) and moved shop rows
// between events, so a row whose ids, numbers or flags differ is listed in the report as changed and
// none of its dates are taken. Wording changes (Chinese or Japanese text) and "\" vs "/" in paths don't
// count. Rows the fork dates before 2013 are CN's way of hiding an event it never ran (JP-only events):
// they're listed under "hidden".
//
//   node scripts/import_cn_calendar.cjs <intermediate.zip | intermediate folder> [--report <file>]
//   -> assets/cn_calendar_dates.json, and a review report (default: cn_calendar_report.json beside it
//      in the system temp folder)
const fs = require("fs")
const os = require("os")
const path = require("path")
const crypto = require("crypto")
const unzipper = require("unzipper")
const R = require("./cn_read.cjs")
const CAL = require("./cn_calendar.cjs")
const { decodeFile, leaves } = require("./cdn_rows.cjs")
const { recordsOf } = require("./gen_cn_text.cjs")

const args = process.argv.slice(2)
const source = args[0]
if (!source || source.startsWith("--")) throw new Error("usage: import_cn_calendar.cjs <intermediate.zip | folder> [--report <file>]")
const reportAt = args.indexOf("--report")
const reportFile = reportAt >= 0 ? args[reportAt + 1] : path.join(os.tmpdir(), "cn_calendar_report.json")
const OUT = path.join(__dirname, "..", "assets", "cn_calendar_dates.json")

const DATE = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/
const HIDDEN_BEFORE = "2013"
const TEXT = /[\u3040-\u30ff\u4e00-\u9fff]/
// events CN never ran that the fork doesn't hide under the same id (found 2026-11-22), by event catalog key;
// every row the catalog lists for them is hidden:
// - JP's "days since launch" quests (开服N日纪念关卡) for 200-900 days, which the fork removed: CN announced its
//   own day counts (150, 260, 480 ... 920) and never these; 800, 850 and 900 days sat in CN's 2022
// - Black Clover (advent 300001), which the fork hides as its advent 100009; CN never announced it
const JP_ONLY = [
    "story_event:200003", "story_event:200005", "story_event:200007", "story_event:200008", "story_event:200009",
    "story_event:200025", "story_event:200026", "story_event:200027", "advent_event:300001",
]
const CATALOG = path.join(__dirname, "..", "assets", "event_catalog_cn.json")
// The fork's few non-date edits worth taking (reviewed 2026-11-22), applied the same way as the dates: table, row,
// column, CN files' value, the fork's value.
// - CN's own 2022 New Year banner (9090) and the 2022 Fire element rerun (42) on their 2022 unit pools (CN's rows
//   kept the first run's 2020 pools)
// - four armament banners' list picture: CN's rows name equipment_pickup_N, which the CN files don't have (so the
//   builder hid them); the fork's element pictures are in the files
const FORK_CELLS = [
    ["master/gacha/gacha.orderedmap", "9090", 14, "ny20_character_3", "ny22_character_3"],
    ["master/gacha/gacha.orderedmap", "9090", 15, "ny20_character_4", "ny22_character_4"],
    ["master/gacha/gacha.orderedmap", "9090", 16, "ny20_character_5", "ny22_character_5"],
    ["master/gacha/gacha.orderedmap", "42", 14, "red_element_pickup_02_character_3", "red_element_pickup_20_character_3"],
    ["master/gacha/gacha.orderedmap", "42", 15, "red_element_pickup_02_character_4", "red_element_pickup_20_character_4"],
    ["master/gacha/gacha.orderedmap", "42", 16, "red_element_pickup_02_character_5", "red_element_pickup_20_character_5"],
    ["master/gacha/gacha.orderedmap", "5000", 3, "dynamic/gacha_list_banner/equipment_pickup_1", "dynamic/gacha_list_banner/equipment_red_pickup_1"],
    ["master/gacha/gacha.orderedmap", "5002", 3, "dynamic/gacha_list_banner/equipment_pickup_2", "dynamic/gacha_list_banner/equipment_wind_pickup_2"],
    ["master/gacha/gacha.orderedmap", "5004", 3, "dynamic/gacha_list_banner/equipment_pickup_3", "dynamic/gacha_list_banner/equipment_yellow_pickup_1"],
    ["master/gacha/gacha.orderedmap", "5006", 3, "dynamic/gacha_list_banner/equipment_pickup_4", "dynamic/gacha_list_banner/equipment_black_pickup_2"],
]
// gacha columns our own general-ticket fix also changes (scripts/gen_cn_event_schedule.cjs)
const GACHA_TICKET_COLUMNS = new Set([20, 26, 27, 28, 32])

// a row's own text id ("advent_xm20", "valen_20", "new_character_pickup_51") in its first cell
const STRING_ID = /^[A-Za-z][A-Za-z0-9_]*$/

/** Why a row isn't the same row in both copies, or []. A row with a text id in its first cell is the same
 *  row when that id is (the fork's other edits to it, like summon movies, don't change which row it is);
 *  any other row is the same when only dates, wording and path spelling differ. */
function changedCells(logical, orig, recs) {
    const a = orig[0]?.[0] ?? "", b = recs[0]?.[0] ?? ""
    if (STRING_ID.test(a) && STRING_ID.test(b)) return a === b ? [] : [`0: ${a} -> ${b}`]
    const why = []
    orig.forEach((rec, r) => rec.forEach((o, c) => {
        const v = recs[r][c]
        if (v === o || (DATE.test(v) && DATE.test(o))) return
        if (logical === "master/gacha/gacha.orderedmap" && GACHA_TICKET_COLUMNS.has(c)) return
        if (v.split("\\").join("/") === o.split("\\").join("/")) return
        if ((v === "" || v === "(None)") && (o === "" || o === "(None)")) return
        // another picture for the same row (an asset path either way) doesn't make it another row
        if (/^[a-z_]+\/[\w/.-]+$/.test(v.split("\\").join("/")) && /^[a-z_]+\/[\w/.-]+$/.test(o.split("\\").join("/"))) return
        if (TEXT.test(v) && TEXT.test(o)) return
        why.push(`${orig.length === 1 ? c : `${r}:${c}`}: ${o} -> ${v}`)
    }))
    return why
}

/** The fork's tables: logical path ("master/....orderedmap") -> file contents. */
async function forkTables() {
    const out = new Map()
    const add = (p, buf) => {
        const m = p.split("\\").join("/").match(/(?:^|\/)(master\/.+\.orderedmap)$/)
        if (m) out.set(m[1], buf)
    }
    if (source.endsWith(".zip")) {
        for (const e of (await unzipper.Open.file(source)).files) if (e.type === "File" && e.path.endsWith(".orderedmap")) add(e.path, await e.buffer())
    } else {
        const walk = dir => {
            for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, f.name)
                if (f.isDirectory()) walk(p)
                else if (f.name.endsWith(".orderedmap")) add(path.relative(source, p), fs.readFileSync(p))
            }
        }
        walk(source)
    }
    return out
}

/** row key -> records (lists of cells); the fork's rows end in a line break the CN files' don't have. */
const rowsOf = buf => {
    const rows = new Map()
    for (const { path: keys, leaf } of leaves(decodeFile(buf))) {
        // the fork's rows end in "\r\n": without stripping it the last cell keeps the "\r"
        rows.set(keys.join("/"), recordsOf(leaf.text.replace(/[\r\n]+$/, "")).filter(r => !(r.length === 1 && r[0] === "")))
    }
    return rows
}

const GACHA = "master/gacha/gacha.orderedmap"
// a hidden copy's dates: a week in 2011, before any save starts (as the builder's banners without a picture)
const COPY_HIDDEN = ["2011-01-01 12:00:00", "2011-01-08 11:59:59"]
const COPY_SUFFIXES = ["_1", "_2", "_001", "_2022"]

/** CN's banners each come twice in its files: JP's original (JP's dates, JP's own tickets, no guarantee settings) and
 *  CN's own copy, which CN ran (its own dates and settings; named like the original plus "_1", or "_2" for some),
 *  whose row number is far from the original's (6 xmas19 -> 63 xmas19_1, 10061 -> 1531). The fork keeps one: CN's
 *  copy, moved onto the original's number (its row 6 is CN's row 63 apart from the name). Taking only its dates
 *  ran JP's original on CN's dates beside CN's copy (two of the same banner at once, the original with JP's settings).
 *  So each original takes every cell of CN's copy but its name (its dates as the fork has them, the import's own
 *  dates otherwise), and the copy is hidden. Pairs: the fork's rows that are another CN row under the original's
 *  name, then the originals the fork doesn't have, by name and the same unit pool. Writes into the gacha table's
 *  cells; returns the [original, copy] pairs. */
function cnBannerCopies(mine, cn, cells, hiddenIds) {
    const flat = recs => recs.flat()
    const ids = [...cn.keys()]
    const byName = new Map(ids.map(id => [flat(cn.get(id))[0], id]))
    const pairs = [], taken = new Set()
    for (const [id, recs] of mine) {
        const own = cn.get(id)
        const f = flat(recs)
        if (!own || flat(own)[0] !== f[0]) continue
        const same = row => row && row.length === f.length && row.every((v, i) => i === 0 || v === f[i])
        if (same(flat(own))) continue
        const src = ids.filter(j => j !== id && same(flat(cn.get(j))))
        if (src.length === 1 && !taken.has(src[0])) { pairs.push([id, src[0], true]); taken.add(id); taken.add(src[0]) }
    }
    for (const id of ids) {
        if (taken.has(id)) continue
        const o = flat(cn.get(id))
        for (const suffix of COPY_SUFFIXES) {
            const j = byName.get(o[0] + suffix)
            if (!j || taken.has(j) || flat(cn.get(j))[14] !== o[14]) continue
            pairs.push([id, j, mine.has(id) && flat(mine.get(id))[0] === o[0]]); taken.add(id); taken.add(j)
            break
        }
    }
    const used = pairs.filter(([o, c]) => !hiddenIds.has(o) && !hiddenIds.has(c))
    for (const [orig, copy, forkDated] of used) {
        const o = flat(cn.get(orig)), c = flat(cn.get(copy))
        const row = cells[orig] ??= {}
        for (let i = 1; i < o.length; i++) {
            if (o[i] === c[i]) continue
            // the fork's own dates for the original (e.g. CN's last banners kept open past the shutdown) stay
            if (DATE.test(o[i]) && DATE.test(c[i]) && forkDated) continue
            if (row[String(i)]) continue
            row[String(i)] = [o[i], c[i]]
        }
        const hide = cells[copy] = {}
        c.forEach((v, i) => { if (DATE.test(v) && v >= HIDDEN_BEFORE) hide[String(i)] = [v, i === 29 ? COPY_HIDDEN[0] : COPY_HIDDEN[1]] })
    }
    return used
}

;(async () => {
    let gachaRows = null
    const fork = await forkTables()
    const tables = {}, hidden = [], perTable = []
    const review = { notInCn: [], structure: [], changedRows: {}, otherCells: {}, onlyInFork: {}, onlyInCn: {} }
    let cells = 0, rowsDated = 0, rowsChanged = 0
    for (const [logical, buf] of [...fork].sort((a, b) => a[0].localeCompare(b[0]))) {
        const cnBuf = await R.readCn(logical, { raw: true })
        if (!cnBuf) { review.notInCn.push(logical); continue }
        const mine = rowsOf(buf), cn = rowsOf(cnBuf)
        const dates = {}
        let other = 0
        for (const [key, recs] of mine) {
            const orig = cn.get(key)
            if (!orig) { (review.onlyInFork[logical] ??= []).push(key); continue }
            if (orig.length !== recs.length || orig.some((r, i) => r.length !== recs[i].length)) { review.structure.push(`${logical} ${key}`); continue }
            const changed = changedCells(logical, orig, recs)
            if (changed.length > 0) {
                if (recs.some((rec, r) => rec.some((v, c) => v !== orig[r][c] && DATE.test(v) && DATE.test(orig[r][c])))) {
                    ;(review.changedRows[logical] ??= {})[key] = changed
                    rowsChanged++
                }
                continue
            }
            const one = recs.length === 1
            let rowHidden = false
            recs.forEach((rec, r) => rec.forEach((v, c) => {
                const o = orig[r][c]
                if (v === o) return
                if (DATE.test(v) && DATE.test(o)) {
                    ;((dates[key] ??= {}))[one ? String(c) : `${r}:${c}`] = [o, v]
                    cells++
                    if (v < HIDDEN_BEFORE) rowHidden = true
                } else other++ // wording or path spelling only (changedCells passed it)
            }))
            if (dates[key]) rowsDated++
            if (rowHidden) hidden.push(`${logical} ${key}`)
        }
        if (logical === GACHA) gachaRows = { mine, cn }
        for (const key of cn.keys()) if (!mine.has(key)) (review.onlyInCn[logical] ??= []).push(key)
        if (other > 0) review.otherCells[logical] = other
        if (Object.keys(dates).length > 0) tables[logical] = dates
        perTable.push({ table: logical, rows: mine.size, cnRows: cn.size, datedRows: Object.keys(dates).length })
    }
    // events CN never ran that the fork doesn't hide under the same id: every row the catalog lists for them
    const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"))
    const named = new Map(Object.entries(catalog.tables ?? {}))
    for (const n of fork.keys()) named.set(R.hashed(n), n)
    const unnamed = new Set()
    for (const key of JP_ONLY) {
        const rows = catalog.sharedRows?.[key] ?? catalog.events.find(e => e.key === key)?.rows
        if (!rows) throw new Error(`JP-only event ${key} isn't in ${CATALOG}`)
        for (const [file, keys] of Object.entries(rows)) {
            const logical = named.get(file)
            if (!logical) { unnamed.add(file); continue }
            for (const k of keys) {
                const id = `${logical} ${k}`
                if (!hidden.includes(id)) hidden.push(id)
            }
        }
    }
    if (unnamed.size > 0) console.log(`JP-only rows in tables with no known name (not listed): ${[...unnamed].join(", ")}`)
    // hidden rows don't take the fork's dates (10 years back): scripts/cn_calendar.cjs moves them into 2020 instead
    for (const id of hidden) {
        const at = id.indexOf(" "), logical = id.slice(0, at), key = id.slice(at + 1)
        if (tables[logical]) { delete tables[logical][key]; if (Object.keys(tables[logical]).length === 0) delete tables[logical] }
    }
    // how many whole years each hidden row moves back so its event starts in 2020: by the event's own row (all
    // its rows together), else by the row itself; never forward
    const OWN_TABLE = { gacha: "master/gacha/gacha.orderedmap", pass_card_event: "master/pass_card/pass_card_event.orderedmap" }
    const ownTable = family => OWN_TABLE[family] ?? `master/quest/event/${family}.orderedmap`
    const eventOfRow = new Map()
    for (const event of catalog.events) {
        const rows = catalog.sharedRows?.[event.key] ?? event.rows ?? {}
        for (const [file, keys] of Object.entries(rows)) for (const k of keys) if (!eventOfRow.has(`${file} ${k}`)) eventOfRow.set(`${file} ${k}`, event)
    }
    const rawTables = new Map()
    const rawRow = async (logical, key) => {
        if (!rawTables.has(logical)) { const buf = await R.readCn(logical, { raw: true }); rawTables.set(logical, buf ? rowsOf(buf) : new Map()) }
        const recs = rawTables.get(logical).get(key)
        return recs ? recs.flat() : null
    }
    const firstYear = cellsOf => {
        const ds = (cellsOf ?? []).filter(v => DATE.test(v) && v >= HIDDEN_BEFORE && v < "2030").sort()
        return ds.length > 0 ? Number(ds[0].slice(0, 4)) : null
    }
    const hiddenYears = {}
    for (const id of hidden) {
        const at = id.indexOf(" "), logical = id.slice(0, at), key = id.slice(at + 1)
        const event = eventOfRow.get(`${R.hashed(logical)} ${key}`)
        const year = (event ? firstYear(await rawRow(ownTable(event.family), event.id)) : null) ?? firstYear(await rawRow(logical, key))
        if (year !== null && year > 2020) hiddenYears[id] = year - 2020
        // the row's final dates, as from -> to cells like every other row (applying them twice changes nothing):
        // moved back those years, and anything still after CN's paid test ending there
        if (!rawTables.has(logical)) await rawRow(logical, key)
        const recs = rawTables.get(logical).get(key)
        if (!recs) continue
        const cellsTo = {}
        recs.forEach((rec, r) => rec.forEach((v, c) => {
            if (!DATE.test(v) || v < HIDDEN_BEFORE) return
            let d = v < "2030" ? CAL.minusYears(v, hiddenYears[id] ?? 0) : v
            if (d > CAL.JP_ONLY_END) d = CAL.JP_ONLY_END
            if (d !== v) cellsTo[recs.length === 1 ? String(c) : `${r}:${c}`] = [v, d]
        }))
        if (Object.keys(cellsTo).length > 0) (tables[logical] ??= {})[key] = cellsTo
    }
    for (const [logical, key, col, from, to] of FORK_CELLS) ((tables[logical] ??= {})[key] ??= {})[String(col)] = [from, to]
    const copies = gachaRows ? cnBannerCopies(gachaRows.mine, gachaRows.cn, tables[GACHA] ??= {}, new Set(hidden.filter(h => h.startsWith(GACHA + " ")).map(h => h.slice(GACHA.length + 1)))) : []
    console.log(`summon banners run as CN's own copy: ${copies.length} (copies hidden)`)
    const sha = crypto.createHash("sha256")
    if (source.endsWith(".zip")) sha.update(fs.readFileSync(source))
    fs.writeFileSync(OUT, JSON.stringify({
        _note: "CN's own calendar, taken from 晓之车's starpoint-cn tables by scripts/import_cn_calendar.cjs: table -> row key -> cell -> [CN game files' date, CN's real date]. Cell = column, or record:column. 'hidden' = rows of events CN never ran: dated before 2013 by CN, or listed in the script's JP_ONLY; 'hiddenYears' = how many years each moved back so its event starts in 2020 (their final dates are in 'tables' like every other row). Rows the fork changed in other ways are left out (see the import report), apart from the few cells the script's FORK_CELLS takes (banner pools and pictures).",
        source: { name: path.basename(source), sha256: source.endsWith(".zip") ? sha.digest("hex") : null, imported: new Date().toISOString().slice(0, 10) },
        hidden, hiddenYears, bannerCopies: Object.fromEntries(copies.map(([orig, copy]) => [copy, orig])), tables,
    }, null, 1) + "\n")
    const counts = { tables: fork.size, tablesWithDates: Object.keys(tables).length, rowsDated, cells, hidden: hidden.length, changedRowsWithDates: rowsChanged }
    fs.writeFileSync(reportFile, JSON.stringify({ counts, perTable, ...review }, null, 1))
    console.log(counts)
    console.log(`not in the CN files: ${review.notInCn.length}, rows with a different shape: ${review.structure.length}, ` +
        `tables with other edits: ${Object.keys(review.otherCells).length}, rows only in the fork: ${Object.values(review.onlyInFork).flat().length}, ` +
        `rows only in the CN files: ${Object.values(review.onlyInCn).flat().length}`)
    console.log(`wrote ${OUT} and ${reportFile}`)
})()
