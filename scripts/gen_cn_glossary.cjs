// Chinese -> English translation memory for the "globalized CN" text, from the tables
// scripts/gen_cn_text.cjs merged: every cell that was Chinese in CN and is English in the merged table
// gives a pair. Used to translate CN-only text the same way global did (scripts/apply_cn_translations.cjs).
//
//   node scripts/gen_cn_glossary.cjs <merged dir>   -> <merged dir>/glossary.json  { zh: en }
const fs = require("fs")
const { cnZips } = require("./cn_archives.cjs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { recordsOf, isCnText, isEnglish } = require("./gen_cn_text.cjs")
const unzipper = require("unzipper")

;(async () => {
    const dir = process.argv[2]
    const files = JSON.parse(fs.readFileSync(path.join(dir, "files.json"), "utf8"))
    // CN originals by hashed path (newest copy)
    const want = new Set(files.map(f => f.path))
    const cn = new Map()
    for (const z of cnZips()) for (const e of (await unzipper.Open.file(z)).files) if (want.has(e.path)) cn.set(e.path, e)
    const counts = new Map()
    for (const f of files) {
        const before = new Map(R.leaves(R.decodeFile(await cn.get(f.path).buffer())).map(({ path: p, leaf }) => [p.join("/"), leaf.text]))
        for (const { path: p, leaf } of R.leaves(R.decodeFile(fs.readFileSync(f.from)))) {
            const old = before.get(p.join("/"))
            if (old === undefined || old === leaf.text) continue
            const a = recordsOf(old), b = recordsOf(leaf.text)
            a.forEach((rec, i) => rec.forEach((v, j) => {
                const en = b[i]?.[j]
                if (en !== undefined && isCnText(v) && isEnglish(en)) {
                    const k = v + "\u0000" + en
                    counts.set(k, (counts.get(k) ?? 0) + 1)
                }
            }))
        }
    }
    // the most common English for each Chinese text
    const best = new Map()
    for (const [k, n] of counts) {
        const [zh, en] = k.split("\u0000")
        if (!best.has(zh) || best.get(zh)[1] < n) best.set(zh, [en, n])
    }
    const glossary = Object.fromEntries([...best].map(([zh, [en]]) => [zh, en]))
    fs.writeFileSync(path.join(dir, "glossary.json"), JSON.stringify(glossary))
    console.log(`${Object.keys(glossary).length} Chinese texts with an English translation`)
})().catch(e => { console.error(e); process.exit(1) })
