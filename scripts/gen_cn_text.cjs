// "Globalized CN" text: puts global's English into the CN client's data tables. Both CDNs name a table
// file the same (hashed), so every table both have is merged: rows are matched by key, the CN table's
// columns are lined up with global's (CN added columns to many tables), and every CN cell holding
// Chinese gets the global cell's English. Global = global's CDN with the translation mod on top (the
// 22 post-EoS units and the event text). CN-only rows, and cells global left in Japanese, stay Chinese
// and are listed in the report for translating.
//
//   node scripts/gen_cn_text.cjs <scan dir> <out dir>
//     scan dir: scripts/scan_cn_globalize.cjs output (scan_*.json): which files differ and are tables
//     out dir:  merged tables at <out>/production/upload/..., plus report.json and files.json
//               (files.json is the list for scripts/build_cn_patch.cjs)
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { parseRecords } = require("./gen_translation_mod.cjs")
const { globalFile } = require("./build_cn_patch.cjs")
const { readCn } = require("./cn_read.cjs")
const unzipper = require("unzipper")

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/
// kana, without the middle dot \u30fb (Chinese text uses it too)
const KANA = /[\u3040-\u30fa\u30fc-\u30ff]/
const LATIN = /[A-Za-z]/
const isCnText = v => HAN.test(v) && !KANA.test(v)
const isEnglish = v => LATIN.test(v) && !HAN.test(v) && !KANA.test(v)

// ::name:: placeholders the client fills in (::if ...::/::else::/::end:: are template logic)
const placeholders = v => new Set((v.match(/::[A-Za-z_][A-Za-z0-9_]*::/g) || []).filter(x => !/^::(if|else|end)/.test(x)))
/**
 * Whether English text can stand in for the CN text: every placeholder in the English must be one the
 * CN client fills in for this text (else it shows "null"), and the English mustn't drop any of CN's,
 * except a quest rank the English spells out ("Inter.").
 */
function placeholdersFit(cn, en) {
    const a = placeholders(cn), b = placeholders(en)
    for (const x of b) if (!a.has(x)) return false
    for (const x of a) if (!b.has(x) && x !== "::quest_rank::") return false
    return true
}

// CN files by hashed path (newest copy), like scan_cn_globalize.cjs
async function cnIndex() {
    const dir = "D:/WF client/.cdn/cn"
    const ver = n => (n.match(/-(\d+\.\d+\.\d+)-\d+-[0-9a-f]+\.zip$/) || [])[1] || "0"
    const cmp = (a, b) => a.split(".").map(Number).reduce((r, x, i) => r || x - Number(b.split(".")[i] || 0), 0)
    const zips = []
    for (const sub of fs.readdirSync(dir)) {
        if (!sub.startsWith("archive-") || sub.includes("ios")) continue
        for (const z of fs.readdirSync(path.join(dir, sub))) if (z.endsWith(".zip")) zips.push({ file: path.join(dir, sub, z), full: sub.endsWith("-full"), v: ver(z) })
    }
    zips.sort((a, b) => (a.full === b.full ? cmp(a.v, b.v) : a.full ? -1 : 1))
    const map = new Map()
    for (const z of zips) for (const e of (await unzipper.Open.file(z.file)).files) if (e.type === "File") map.set(e.path, e)
    return map
}

// rows of a leaf: records of field values (a leaf can hold several CSV records)
function recordsOf(text) {
    const recs = parseRecords(text.endsWith("\n") ? text : text + "\n")
    return recs.map(r => r.map(f => f.value))
}
function encodeRecords(recs, trailingNewline) {
    // the parser's empty record after a final line break isn't a row
    const rows = recs.length > 0 && recs[recs.length - 1].length === 1 && recs[recs.length - 1][0] === "" ? recs.slice(0, -1) : recs
    return rows.map(r => r.map(R.csvField).join(",")).join("\n") + (trailingNewline ? "\n" : "")
}

// lines up one CN row with one global row: returns cnIndex -> globalIndex
function alignRow(c, g) {
    const n = c.length, m = g.length
    // Chinese text pairs best with English of a fitting length (English runs ~1-8x as many characters
    // as Chinese); Japanese or a wildly different length is a weak match
    const score = (a, b) => {
        if (a === b) return 2
        if (a === "" || b === "" || !HAN.test(a)) return -1
        if (isEnglish(b)) {
            const ratio = b.length / a.length
            return ratio >= 0.7 && ratio <= 9 ? 1.5 : 0.3
        }
        return KANA.test(b) || HAN.test(b) ? 0.2 : -1
    }
    const S = Array.from({ length: n + 1 }, () => new Float64Array(m + 1))
    for (let i = 1; i <= n; i++) S[i][0] = -0.5 * i
    for (let j = 1; j <= m; j++) S[0][j] = -0.5 * j
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++)
        S[i][j] = Math.max(S[i - 1][j - 1] + score(c[i - 1], g[j - 1]), S[i - 1][j] - 0.5, S[i][j - 1] - 0.5)
    const map = new Map()
    let i = n, j = m
    while (i > 0 && j > 0) {
        if (S[i][j] === S[i - 1][j - 1] + score(c[i - 1], g[j - 1])) { map.set(i - 1, j - 1); i--; j-- }
        else if (S[i][j] === S[i - 1][j] - 0.5) i--
        else j--
    }
    return map
}

function mergeTable(cnBuf, glBuf) {
    const cnRoot = R.decodeFile(cnBuf), glRoot = R.decodeFile(glBuf)
    const glLeaves = new Map(R.leaves(glRoot).map(({ path: p, leaf }) => [p.join("/"), leaf]))
    const pairs = []
    let cnOnlyRows = 0
    const cnOnlyTexts = []
    for (const { path: p, leaf } of R.leaves(cnRoot)) {
        const gl = glLeaves.get(p.join("/"))
        const cr = recordsOf(leaf.text)
        if (!gl) {
            cnOnlyRows += cr.length
            for (const r of cr) for (const v of r) if (isCnText(v)) cnOnlyTexts.push({ key: p.join("/"), text: v })
            continue
        }
        const gr = recordsOf(gl.text)
        // records paired by position, or by their first field when the counts differ
        const byId = new Map(gr.map(r => [r[0], r]))
        const rowPairs = cr.map((r, i) => [r, cr.length === gr.length ? gr[i] : byId.get(r[0])])
        pairs.push({ leaf, rows: rowPairs, trailing: leaf.text.endsWith("\n") })
    }
    // column map by majority over rows that have text
    const votes = new Map()
    let sampled = 0
    for (const { rows } of pairs) for (const [c, g] of rows) {
        if (!g || sampled > 400 || !c.some(isCnText)) continue
        sampled++
        for (const [i, j] of alignRow(c, g)) {
            const k = `${i}>${j}`
            votes.set(k, (votes.get(k) ?? 0) + 1)
        }
    }
    const colMap = new Map()
    const best = new Map()
    for (const [k, v] of votes) {
        const [i, j] = k.split(">").map(Number)
        if (!best.has(i) || best.get(i)[1] < v) best.set(i, [j, v])
    }
    for (const [i, [j, v]] of best) if (v >= Math.max(2, sampled * 0.3)) colMap.set(i, j)

    // global's UI text tables hold every language in one row (ja, ko, en, ..., th) where CN has only
    // Chinese: Chinese columns take global's English column
    const HANGUL = /[가-힯]/
    const sample = pairs.flatMap(p => p.rows).filter(([, g]) => g && g.some(v => v !== "")).slice(0, 300)
    if (sample.length > 0 && sample.filter(([, g]) => g.some(v => HANGUL.test(v))).length > sample.length * 0.5) {
        const width = Math.max(...sample.map(([, g]) => g.length))
        let enCol = -1, bestShare = 0
        for (let j = 0; j < width; j++) {
            const share = sample.filter(([, g]) => g[j] !== undefined && isEnglish(g[j])).length / sample.length
            if (share > bestShare) { bestShare = share; enCol = j }
        }
        if (enCol >= 0 && bestShare > 0.5) {
            for (let i = 0; i < Math.max(...sample.map(([c]) => c.length)); i++)
                if (sample.some(([c]) => c[i] !== undefined && isCnText(c[i]))) colMap.set(i, enCol)
        }
    }

    let replaced = 0, leftJapanese = 0, leftNoMatch = 0
    const untranslated = []
    for (const { leaf, rows, trailing } of pairs) {
        let changed = false
        const out = rows.map(([c, g]) => c.map((v, i) => {
            if (!isCnText(v)) return v
            const j = colMap.get(i)
            const gv = g && j !== undefined ? g[j] : undefined
            if (gv !== undefined && isEnglish(gv) && placeholdersFit(v, gv)) { changed = true; replaced++; return gv }
            if (gv !== undefined && KANA.test(gv)) leftJapanese++
            else leftNoMatch++
            untranslated.push({ text: v, global: gv ?? null })
            return v
        }))
        if (changed) R.setLeafText(leaf, encodeRecords(out, trailing))
    }
    return { buf: replaced > 0 ? R.encodeFile(cnRoot) : null, replaced, leftJapanese, leftNoMatch, cnOnlyRows, cnOnlyTexts, untranslated, columns: Object.fromEntries(colMap) }
}

if (require.main === module) (async () => {
    const [scanDir, outDir] = process.argv.slice(2)
    if (!scanDir || !outDir) throw new Error("usage: gen_cn_text.cjs <scan dir> <out dir>")
    const tables = []
    for (const f of fs.readdirSync(scanDir).filter(f => /^scan_\d+\.json$/.test(f)))
        for (const r of JSON.parse(fs.readFileSync(path.join(scanDir, f), "utf8"))) if (r.kind === "orderedmap") tables.push(r.k)
    console.log(`${tables.length} differing tables; indexing CN archives...`)
    const cn = await cnIndex()
    const report = {}, files = []
    let total = 0
    for (const k of tables.sort()) {
        try {
            const cnBuf = await cn.get(k).buffer(), glBuf = await globalFile(k)
            const r = mergeTable(cnBuf, glBuf)
            report[k] = { replaced: r.replaced, leftJapanese: r.leftJapanese, leftNoMatch: r.leftNoMatch, cnOnlyRows: r.cnOnlyRows, columns: r.columns, cnOnlyTexts: r.cnOnlyTexts.slice(0, 3000), untranslated: r.untranslated.slice(0, 3000) }
            if (r.buf) {
                const file = path.join(outDir, k)
                fs.mkdirSync(path.dirname(file), { recursive: true })
                fs.writeFileSync(file, r.buf)
                files.push({ path: k, from: file })
                total += r.replaced
            }
        } catch (e) { report[k] = { error: String(e.message).slice(0, 120) } }
    }
    fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report))
    fs.writeFileSync(path.join(outDir, "files.json"), JSON.stringify(files))
    const left = Object.values(report).reduce((s, r) => s + (r.leftNoMatch ?? 0) + (r.leftJapanese ?? 0), 0)
    console.log(`${files.length} tables changed, ${total} cells now English; ${left} Chinese cells left in shared rows`)
})().catch(e => { console.error(e); process.exit(1) })

module.exports = { mergeTable, recordsOf, isCnText, isEnglish, placeholdersFit }
