// Global's own English for the Chinese cells still left in the CN client's tables, where global has
// the same row (same table and key). Written to assets/translations/cn_global_cells.json, which
// scripts/apply_cn_translations.cjs puts in place cell by cell (cn_fixes.json "cells" win over it).
//
// CN added columns to some tables (boss coin shop, practice quests, event missions...), so cells are
// matched by their neighbours, not by column number: the non-empty cells that aren't Chinese are
// lined up (longest common run), and a Chinese cell takes global's cell between the same two lined-up
// neighbours, at the same distance from them. A cell is only taken when:
// - the row really is the same row (at least half of CN's non-empty plain cells line up with global's),
// - global's cell is English (has Latin letters, no Chinese/Japanese), a story sound ("...!"), or a
//   kana reading where CN's is kana too, and
// - global's ::placeholders:: are ones CN's cell has too (the CN client fills them the same way).
// Limited-time shop labels keep CN's date (global's dates are for global's own schedule).
//
//   node scripts/gen_cn_global_cells.cjs [CN text dir, default: CN_TRANSLATED_DIR from .env]
//   -> assets/translations/cn_global_cells.json { _note, tables: { table: { key: { "rec:col": text } } } }
const fs = require("fs")
const path = require("path")
const unzipper = require("unzipper")
const R = require("./cdn_rows.cjs")
const { cnZips } = require("./cn_archives.cjs")
const { recordsOf } = require("./gen_cn_text.cjs")

const ROOT = path.join(__dirname, "..")
const OUT = path.join(ROOT, "assets", "translations", "cn_global_cells.json")
const HAN = /[\u3400-\u9fff]/
const KANA = /[\u3040-\u30ff]/
const LATIN = /[A-Za-z]/
const placeholders = t => new Set(String(t).match(/::[A-Za-z0-9_]+::/g) ?? [])

/** Lines up two cell lists by their non-empty plain cells: pairs of [cn index, global index]. */
function anchors(cn, gl) {
    const a = cn.map((v, i) => [v, i]).filter(([v]) => v !== "" && !HAN.test(v))
    const b = gl.map((v, i) => [v, i]).filter(([v]) => v !== "" && !HAN.test(v))
    // longest common subsequence of the cell values
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
        dp[i][j] = a[i][0] === b[j][0] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    const pairs = []
    for (let i = 0, j = 0; i < a.length && j < b.length;) {
        if (a[i][0] === b[j][0]) { pairs.push([a[i][1], b[j][1]]); i++; j++ }
        else if (dp[i + 1][j] >= dp[i][j + 1]) i++
        else j++
    }
    return { pairs, plain: a.length }
}

/** Global's cell for CN's cell i, or undefined when it can't be told. */
function matchCell(i, cn, gl, pairs) {
    let left = null, right = null
    for (const p of pairs) { if (p[0] < i) left = p; else if (p[0] > i && right === null) right = p }
    const pick = j => (j !== null && j >= 0 && j < gl.length ? gl[j] : undefined)
    const fromLeft = left ? pick(left[1] + (i - left[0])) : undefined
    const fromRight = right ? pick(right[1] - (right[0] - i)) : undefined
    // a global cell that is one of CN's own plain cells (a path, an id...) isn't this cell's text
    const plainCn = new Set(cn.filter(v => v !== "" && !HAN.test(v)))
    const usable = v => v !== undefined && v !== "" && !plainCn.has(v)
    if (left && right) {
        if (fromLeft === fromRight) return usable(fromLeft) ? fromLeft : undefined
        // CN added a column on one side: trust the side whose neighbour is right next to the cell and
        // is the more telling value (a path or name over a small number)
        const sides = [[left, fromLeft, i - left[0]], [right, fromRight, right[0] - i]]
            .filter(([, v, d]) => d === 1 && usable(v))
            .sort((a, b) => cn[b[0][0]].length - cn[a[0][0]].length)
        return sides[0]?.[1]
    }
    // only one side has a neighbour: it must be right next to the cell
    if (left && i - left[0] === 1 && usable(fromLeft)) return fromLeft
    if (right && right[0] - i === 1 && usable(fromRight)) return fromRight
    return undefined
}

// limited-time labels: CN's own date ("【2月1日まで】"), in global's wording ("[Until Feb. 1]")
const MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."]
function withCnDate(cnText, glText) {
    const m = /【(\d+)月(\d+)日まで】/.exec(cnText)
    if (!m || !/\[Until[^\]]*\]/.test(glText)) return glText
    return glText.replace(/\[Until[^\]]*\]/, `[Until ${MONTHS[Number(m[1]) - 1]} ${Number(m[2])}]`)
}

async function archive(dir, map) {
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".zip")).sort())
        for (const e of (await unzipper.Open.file(path.join(dir, f))).files)
            if (e.type === "File") map.set("production/" + e.path.split("\\").join("/").replace(/^production\//, ""), e)
}

;(async () => {
    const textDir = process.argv[2] ?? process.env.CN_TRANSLATED_DIR
    if (!textDir) throw new Error("Give the CN text dir (or set CN_TRANSLATED_DIR)")
    const translated = new Map(JSON.parse(fs.readFileSync(path.join(textDir, "files.json"), "utf8")).map(f => [f.path, f.from]))
    const names = JSON.parse(fs.readFileSync("F:/WF client/globalize/table_names.json", "utf8"))

    const gl = new Map()
    for (const d of ["archive-common-full", "archive-common-diff"]) await archive(path.join(ROOT, ".cdn/en", d), gl)
    const cn = new Map()
    for (const z of cnZips("D:/WF client/.cdn/cn"))
        for (const e of (await unzipper.Open.file(z)).files)
            if (e.type === "File") cn.set("production/" + e.path.split("\\").join("/").replace(/^production\//, ""), e)

    const tables = {}, stats = {}, skippedList = {}
    let cells = 0, skipped = 0
    for (const [p, entry] of cn) {
        if (!p.startsWith("production/upload/") || !gl.has(p)) continue
        const buf = translated.has(p) ? fs.readFileSync(translated.get(p)) : await entry.buffer()
        let cnRoot, glRows
        try { cnRoot = R.decodeFile(buf) } catch { continue }
        const leaves = R.leaves(cnRoot).filter(l => HAN.test(l.leaf.text))
        if (leaves.length === 0) continue
        try { glRows = new Map(R.leaves(R.decodeFile(await gl.get(p).buffer())).map(l => [l.path.join("/"), l.leaf.text])) } catch { continue }
        for (const { path: keyPath, leaf } of leaves) {
            const key = keyPath.join("/")
            const glText = glRows.get(key)
            if (glText === undefined) continue
            const cnRecs = recordsOf(leaf.text), glRecs = recordsOf(glText)
            cnRecs.forEach((rec, r) => {
                const glRec = glRecs[r]
                if (!glRec) return
                const { pairs, plain } = anchors(rec, glRec)
                const sameRow = plain === 0 ? rec.length === glRec.length : pairs.length * 2 >= plain
                rec.forEach((v, i) => {
                    if (!HAN.test(v)) return
                    const g = sameRow ? (plain === 0 ? glRec[i] : matchCell(i, rec, glRec, pairs)) : undefined
                    const english = g !== undefined && LATIN.test(g) && !HAN.test(g) && !KANA.test(g)
                    // story sounds: global writes "..." or "...!" for CN's "呜——！！"
                    const sound = g !== undefined && /^[\s.…!?~—-]+$/.test(g) && v.length <= 12
                    // Japanese readings (degree name kana): CN's conversion broke some (な -> 无)
                    const reading = g !== undefined && KANA.test(v) && KANA.test(g) && !HAN.test(g) && !/[가-힯]/.test(g)
                    const ok = (english || sound || reading) && [...placeholders(g)].every(t => placeholders(v).has(t))
                    if (!ok) { skipped++; if (process.env.SKIPPED) (skippedList[names[p] || p] ??= []).push(`${key} ${r}:${i} ${v.slice(0, 50)} || ${String(g ?? (sameRow ? "(no cell)" : "(other row)")).slice(0, 50)}`); return }
                    ;((tables[p] ??= {})[key] ??= {})[`${r}:${i}`] = withCnDate(v, g)
                    cells++
                    const name = names[p] || p
                    stats[name] = (stats[name] ?? 0) + 1
                })
            })
        }
    }
    fs.writeFileSync(OUT, JSON.stringify({ _note: "Built by scripts/gen_cn_global_cells.cjs: global's English for CN cells still in Chinese, by table -> key -> 'record:column'.", tables }))
    if (process.env.SKIPPED) fs.writeFileSync(process.env.SKIPPED, JSON.stringify(skippedList, null, 1))
    console.log(`Wrote ${OUT}: ${cells} cells (${skipped} Chinese cells in shared rows left: no safe global match)`)
    for (const [name, n] of Object.entries(stats).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), name)
})().catch(e => { console.error(e); process.exit(1) })
