// Checks assets/cn_mb2_waves.json (CN's real Mana Board 2 open dates, from CN's Bilibili wave posts):
//   - the waves run 1, 2, 3 ... in date order, and no unit is in two waves;
//   - every unit a wave post names opens on that post's date (waves 1-4 always; from wave 5 the table's date is
//     kept, so a unit may differ only when 'differs' lists it with that wave's post date and its table date);
//   - against CN's own table (master/mana_board/mana_board2_open_condition, read from the CN game files): the file
//     covers every unit of the table, every unit that ever opened (not 2050) is in a wave post or in 'noPost',
//     waves 1-3 are the table's 2015-03-01 units, and from wave 5 on each unit has the table's date.
//
//   node --env-file=.env scripts/test_cn_mb2_waves.mjs
// The CN game files (CN_CDN_DIR) are needed for the table checks; without them those are skipped.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
let failed = 0
const check = (label, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok || detail === undefined ? "" : `  -> ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)}`}`)
    if (!ok) failed++
}

const file = JSON.parse(readFileSync(path.join(root, "assets", "cn_mb2_waves.json"), "utf8"))
const { waves, units, differs, noPost } = file
const DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

// ---- the file on its own ----
check("waves numbered 1..n", waves.every((w, i) => w.n === i + 1), waves.map(w => w.n))
check("wave dates in order", waves.every((w, i) => DATE.test(w.date) && (i === 0 || waves[i - 1].date < w.date)), waves.map(w => w.date))
check("each wave has its post id and units", waves.every(w => /^\d+$/.test(w.post) && w.units.length > 0))
check("every unit date is a date", Object.values(units).every(d => DATE.test(d)))
const waveOf = {}
const twice = []
for (const w of waves) for (const id of w.units) { if (waveOf[id]) twice.push(id); waveOf[id] = w }
check("no unit in two waves", twice.length === 0, twice)
check("every posted unit is in units", Object.keys(waveOf).every(id => units[id]), Object.keys(waveOf).filter(id => !units[id]))
const off = []
for (const [id, w] of Object.entries(waveOf)) {
    if (units[id] === w.date) continue
    const d = differs[id]
    if (w.n <= 4 || !d || d.wave !== w.n || d.post !== w.date || d.table !== units[id]) off.push({ id, wave: w.n, post: w.date, file: units[id] })
}
check("every posted unit opens on its post's date (or is listed in differs)", off.length === 0, off)
check("differs only lists posted units, with their wave's post date",
    Object.entries(differs).every(([id, d]) => waveOf[id] && waveOf[id].n === d.wave && d.post === waveOf[id].date), differs)
check("noPost units are in no post", Object.keys(noPost).every(id => !waveOf[id] && units[id]))
check("waves 1-4 (from the posts) open 2022-05-26, 06-16, 07-14 and 08-18",
    ["2022-05-26 12:00:00", "2022-06-16 12:00:00", "2022-07-14 12:00:00", "2022-08-18 12:00:00"].every((d, i) => waves[i].date === d), waves.slice(0, 4).map(w => w.date))

// ---- against CN's table ----
const { readCnTable } = require(path.join(root, "scripts", "cn_read.cjs"))
let table = null
try { table = await readCnTable("master/mana_board/mana_board2_open_condition.orderedmap") } catch (e) { console.log(`(CN table not read: ${e.message})`) }
if (!table) console.log("SKIP table checks: no CN game files (CN_CDN_DIR)")
else {
    const open = id => table[id].split(",")[0]
    const ids = Object.keys(table)
    check("covers every unit of CN's table", ids.every(id => units[id]) && Object.keys(units).every(id => table[id]),
        { missing: ids.filter(id => !units[id]), extra: Object.keys(units).filter(id => !table[id]) })
    const opened = ids.filter(id => !open(id).startsWith("2050"))
    check(`every opened unit (${opened.length}) is in a wave post or noPost`, opened.every(id => waveOf[id] || noPost[id]),
        opened.filter(id => !waveOf[id] && !noPost[id]))
    check("never-opened units (2050) keep 2050 and are in no post",
        ids.filter(id => open(id).startsWith("2050")).every(id => units[id] === open(id) && !waveOf[id]))
    const folded = ids.filter(id => open(id).startsWith("2015-03-01") && waveOf[id])
    check("waves 1-3 are exactly the table's 2015-03-01 units",
        folded.every(id => waveOf[id].n <= 3) && waves.slice(0, 3).every(w => w.units.every(id => open(id).startsWith("2015-03-01"))), folded.filter(id => waveOf[id].n > 3))
    check("wave 4's units are the table's 2022-08-25 units",
        waves[3].units.every(id => open(id) === "2022-08-25 12:00:00") && ids.filter(id => open(id) === "2022-08-25 12:00:00").every(id => waveOf[id]?.n === 4))
    const later = Object.keys(units).filter(id => !(waveOf[id] && waveOf[id].n <= 4) && units[id] !== open(id))
    check("from wave 5 (and units in no post) each unit has the table's date", later.length === 0, later)
    check("differs gives the table's date", Object.entries(differs).every(([id, d]) => d.table === open(id)))
}

console.log(failed ? `${failed} check(s) failed` : "all cn_mb2_waves checks passed")
process.exit(failed ? 1 : 0)
