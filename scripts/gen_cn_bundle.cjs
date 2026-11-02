// "Globalized CN" text for the tables built into the CN app (assets/bundle.zip in the APK: UI labels,
// quest result labels, score bonus names...), which the CDN patches can't reach. Each bundle table
// with Chinese gets global's English: from global's own bundle (same hashed name, one row holds every
// language) or global's CDN, merged like scripts/gen_cn_text.cjs; then Chinese still left is looked
// up in assets/translations/cn.json and the translation memory (glossary.json).
//
//   node scripts/gen_cn_bundle.cjs <cn.apk> <global.apk> <glossary.json> <out dir>
//     -> <out>/bundle.zip (the CN bundle with the tables replaced), <out>/bundle.zip.sha1,
//        <out>/todo.json (Chinese left: { text: [table, key] })
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const unzipper = require("unzipper")
const R = require("./cdn_rows.cjs")
const { mergeTable, recordsOf, isCnText, placeholdersFit } = require("./gen_cn_text.cjs")
const { globalFile } = require("./build_cn_patch.cjs")

const encodeRecords = (recs, trailing) => {
    const rows = recs.length > 0 && recs[recs.length - 1].length === 1 && recs[recs.length - 1][0] === "" ? recs.slice(0, -1) : recs
    return rows.map(r => r.map(R.csvField).join(",")).join("\n") + (trailing ? "\n" : "")
}

async function bundleOf(apkFile) {
    const apk = await unzipper.Open.file(apkFile)
    return (await apk.files.find(f => f.path === "assets/bundle.zip").buffer())
}

;(async () => {
    const [cnApk, glApk, glossaryFile, outDir] = process.argv.slice(2)
    if (!outDir) throw new Error("usage: gen_cn_bundle.cjs <cn.apk> <global.apk> <glossary.json> <out dir>")
    const glossary = JSON.parse(fs.readFileSync(glossaryFile, "utf8"))
    const cn = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets", "translations", "cn.json"), "utf8")).strings
    const cnBundle = await bundleOf(cnApk)
    const glEntries = new Map()
    for (const e of (await unzipper.Open.buffer(await bundleOf(glApk))).files) if (e.type === "File") glEntries.set(e.path.split("/").slice(-2).join("/"), e)

    const replaced = new Map()
    const todo = {}
    let merged = 0, looked = 0
    for (const e of (await unzipper.Open.buffer(cnBundle)).files) {
        if (e.type !== "File") continue
        const buf = await e.buffer()
        let tree
        try { tree = R.decodeFile(buf) } catch { continue }
        const leaves = R.leaves(tree)
        if (!leaves.some(l => recordsOf(l.leaf.text).some(r => r.some(isCnText)))) continue
        const hash = e.path.split("/").slice(-2).join("/")
        // global's copy: its bundle (any prefix), else its CDN
        let gl = glEntries.has(hash) ? await glEntries.get(hash).buffer() : null
        for (const p of ["production/upload/", "production/medium_upload/"]) if (gl === null) gl = await globalFile(p + hash).catch(() => null)
        let out = buf
        if (gl !== null) {
            const r = mergeTable(buf, gl)
            if (r.buf) { out = r.buf; merged += r.replaced }
        }
        // the rest from the translations
        const t = R.decodeFile(out)
        let changed = false
        for (const { path: keys, leaf } of R.leaves(t)) {
            const recs = recordsOf(leaf.text)
            let leafChanged = false
            const next = recs.map(r => r.map(v => {
                if (!isCnText(v)) return v
                const en = cn[v] ?? glossary[v]
                if (en !== undefined && placeholdersFit(v, en)) { leafChanged = true; looked++; return en }
                ;(todo[v] ??= []).push([e.path, keys.join("/")])
                return v
            }))
            if (leafChanged) { R.setLeafText(leaf, encodeRecords(next, leaf.text.endsWith("\n"))); changed = true }
        }
        if (changed) out = R.encodeFile(t)
        if (out !== buf) replaced.set(e.path, out)
        console.log(`${e.path}: ${gl === null ? "no global copy" : "merged with global"}${changed ? ", translations applied" : ""}`)
    }
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, "todo.json"), JSON.stringify(todo, null, 1))
    fs.writeFileSync(path.join(outDir, "replaced.json"), JSON.stringify([...replaced.keys()]))
    for (const [p, b] of replaced) { const f = path.join(outDir, "files", p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b) }
    fs.writeFileSync(path.join(outDir, "cn_bundle.zip"), cnBundle)
    console.log(`${replaced.size} bundle tables changed (${merged} cells from global, ${looked} from translations); ${Object.keys(todo).length} Chinese texts left (todo.json)`)
})().catch(e => { console.error(e); process.exit(1) })
