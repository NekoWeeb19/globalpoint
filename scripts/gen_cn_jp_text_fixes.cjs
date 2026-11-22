// Builds assets/cn_jp_text_fixes.json: cells of the CN game's tables that are still Japanese (events CN never ran,
// above all the Black Clover collab, whose text CN kept in JP's words), with global's English for the same row and
// column. scripts/gen_cn_event_schedule.cjs replaces each cell that still holds that Japanese in every game update.
//
// Which copy the game gets: the translated one (CN_TRANSLATED_DIR files.json), else CN's own (the slim CN folder's
// tables/, every CN table). Global's copy: the newest in .cdn/en. A cell is fixed only when global's cell has no
// Japanese (cells global keeps in Japanese too, like the titles' kana readings or the ::_数名未定:: variable, stay).
//
//   node scripts/gen_cn_jp_text_fixes.cjs [--slim <cn slim tables folder>] [--global <global .cdn/en folder>]
const fs = require("fs")
const path = require("path")
const unzipper = require("unzipper")
const R = require("./cdn_rows.cjs")

const ROOT = path.join(__dirname, "..")
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const GLOBAL = arg("--global") ?? path.join(ROOT, ".cdn", "en")
const SLIM = arg("--slim") ?? path.join(ROOT, ".cdn", "cn_slim", "tables")
const TRANSLATED = process.env.CN_TRANSLATED_DIR
if (!TRANSLATED) throw new Error("set CN_TRANSLATED_DIR (the translated CN tables)")
const OUT = path.join(ROOT, "assets", "cn_jp_text_fixes.json")

const KANA = /[぀-ヿ]/
const hasJapanese = s => KANA.test(s) && /[぀-ヿ一-鿿]{2,}/.test(s)

// global's newest copy of a file, by its stored path ("production/upload/xx/hash")
let globalZips = null
async function globalFile(stored) {
    if (globalZips === null) {
        globalZips = []
        for (const dir of ["archive-common-diff", "archive-common-full"]) {
            const d = path.join(GLOBAL, dir)
            if (!fs.existsSync(d)) continue
            for (const f of fs.readdirSync(d).filter(f => f.endsWith(".zip"))) {
                const zip = await unzipper.Open.file(path.join(d, f))
                for (const e of zip.files) globalZips.push({ name: e.path.replace(/\\/g, "/"), entry: e, from: f })
            }
        }
        const csv = fs.readdirSync(path.join(GLOBAL, "entities")).filter(f => f.endsWith(".csv")).sort().pop()
        globalZips.index = new Map(fs.readFileSync(path.join(GLOBAL, "entities", csv), "utf8").split(/\r?\n/).map(l => l.split(",")).map(p => [p[0], p[1]]))
    }
    const version = globalZips.index.get(stored)
    if (!version) return null
    const short = stored.replace("production/", "")
    const hits = globalZips.filter(z => z.name.endsWith(short))
    if (hits.length === 0) return null
    return (hits.find(z => z.from.includes(`-${version}-`)) ?? hits[0]).entry.buffer()
}

const rowsOf = buf => {
    const out = new Map()
    for (const { path: keys, leaf } of R.leaves(R.decodeFile(buf))) out.set(keys.join("/"), leaf.text.replace(/\n$/, ""))
    return out
}

;(async () => {
    const list = JSON.parse(fs.readFileSync(path.join(TRANSLATED, "files.json"), "utf8"))
    const translatedFrom = new Map(list.map(f => [f.path, f.from]))
    // every table the game has: CN's own (slim folder), with the translated copy where there is one
    const stored = []
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else stored.push(path.relative(path.dirname(SLIM), p).split(path.sep).join("/").replace(/^tables\//, "")) } }
    walk(SLIM)
    const fixes = {}, report = { tables: 0, cells: 0, noGlobalRow: 0, globalJapanese: 0, byTable: {} }
    for (const file of stored) {
        const from = translatedFrom.get(file)
        const local = from && fs.existsSync(from) ? from : fs.existsSync(path.join(TRANSLATED, file)) ? path.join(TRANSLATED, file) : path.join(SLIM, file)
        let rows
        try { rows = rowsOf(fs.readFileSync(local)) } catch { continue } // not a table (art)
        const japanese = [...rows].filter(([, text]) => hasJapanese(text))
        if (japanese.length === 0) continue
        let global
        try { const g = await globalFile(file); global = g ? rowsOf(g) : null } catch { global = null }
        if (!global) { report.byTable[file] = { japaneseRows: japanese.length, fixed: 0, note: "global has no copy" }; continue }
        let fixed = 0
        for (const [key, text] of japanese) {
            const g = global.get(key)
            if (g === undefined) { report.noGlobalRow++; continue }
            const cn = R.splitCsv(R.splitCsvLines(text)[0]), en = R.splitCsv(R.splitCsvLines(g)[0])
            const cells = {}
            cn.forEach((cell, col) => {
                if (!hasJapanese(cell)) return
                const english = en[col]
                if (english === undefined || english === "" || KANA.test(english) || /[一-鿿]/.test(english) || !/[A-Za-z]/.test(english)) { report.globalJapanese++; return }
                cells[col] = [cell, english]
            })
            if (Object.keys(cells).length) { (fixes[file] ??= {})[key] = cells; fixed += Object.keys(cells).length }
        }
        report.byTable[file] = { japaneseRows: japanese.length, fixed }
        if (fixed) { report.tables++; report.cells += fixed }
    }
    fs.writeFileSync(OUT, JSON.stringify({
        _note: "Cells of the CN game's tables still in Japanese (events CN never ran, above all the Black Clover collab), with global's English for the same row and column (scripts/gen_cn_jp_text_fixes.cjs). scripts/gen_cn_event_schedule.cjs replaces a cell only while it still holds that Japanese. table (stored path) -> row key -> column -> [Japanese, English].",
        tables: fixes,
    }, null, 1) + "\n")
    console.log(`${report.cells} cells in ${report.tables} tables; ${report.noGlobalRow} Japanese rows global doesn't have, ${report.globalJapanese} cells global keeps in Japanese too`)
    for (const [file, r] of Object.entries(report.byTable).sort((a, b) => b[1].japaneseRows - a[1].japaneseRows)) console.log(`  ${file}: ${r.japaneseRows} Japanese rows, ${r.fixed} cells fixed${r.note ? " (" + r.note + ")" : ""}`)
})()
