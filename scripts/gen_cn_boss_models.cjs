// Keeps boss names consistent after the "globalized CN" translation. The CN client checks, before a
// battle with one boss, that the boss group's name (standard_boss table, column "name") equals the
// enemy model's own name (humanReadableName, a string inside the model file); if not it stops with
// error F0 ("ボスグループ名...が一致しません"). The translation changes the table's name to English but
// the model files (raw-deflated AMF3) still carry the Chinese one.
//
// This rewrites that one string in CN's own model files (nothing else in them changes): every AMF3
// string literal (0x06, length, bytes) that is exactly a translated boss's Chinese name becomes its
// English name. AMF3 refers back to strings by index, not by offset, so a different length is fine.
//
//   node scripts/gen_cn_boss_models.cjs <translated dir> <out dir>
//     -> <out>/production/upload/..., <out>/files.json (for scripts/build_cn_patch.cjs)
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const unzipper = require("unzipper")
const R = require("./cdn_rows.cjs")
const { cnZips } = require("./cn_archives.cjs")
const { hashed } = require("./cn_read.cjs")

const STANDARD_BOSS = "production/upload/d1/73e8ff929070d4c0bbef95fa679afcfa1c203f"

function u29(n) {
    if (n < 0x80) return Buffer.from([n])
    if (n < 0x4000) return Buffer.from([(n >> 7) | 0x80, n & 0x7f])
    if (n < 0x200000) return Buffer.from([(n >> 14) | 0x80, ((n >> 7) & 0x7f) | 0x80, n & 0x7f])
    return Buffer.from([(n >> 22) | 0x80, ((n >> 15) & 0x7f) | 0x80, ((n >> 8) & 0x7f) | 0x80, n & 0xff])
}
const literal = s => { const b = Buffer.from(s, "utf8"); return Buffer.concat([Buffer.from([0x06]), u29((b.length << 1) | 1), b]) }

function replaceAll(buf, from, to) {
    const parts = []
    let at = 0, n = 0, i
    while ((i = buf.indexOf(from, at)) !== -1) { parts.push(buf.subarray(at, i), to); at = i + from.length; n++ }
    parts.push(buf.subarray(at))
    return { buf: n ? Buffer.concat(parts) : buf, n }
}

;(async () => {
    const [translatedDir, outDir] = process.argv.slice(2)
    if (!outDir) throw new Error("usage: gen_cn_boss_models.cjs <translated dir> <out dir>")
    const list = new Map(JSON.parse(fs.readFileSync(path.join(translatedDir, "files.json"), "utf8")).map(f => [f.path, f.from]))

    const files = new Map()
    for (const z of cnZips()) for (const e of (await unzipper.Open.file(z)).files) if (e.type === "File") files.set(e.path.split("\\").join("/"), e)

    // Chinese -> English boss names, from the table before and after translation
    const names = new Map()
    const cnRows = R.leaves(R.decodeFile(await files.get(STANDARD_BOSS).buffer()))
    const enRows = new Map(R.leaves(R.decodeFile(fs.readFileSync(list.get(STANDARD_BOSS)))).map(l => [l.path.join("/"), l.leaf.text]))
    for (const { path: p, leaf } of cnRows) {
        const zh = R.splitCsv(leaf.text)[0], en = R.splitCsv(enRows.get(p.join("/")) ?? "")[0]
        if (zh && en && zh !== en) names.set(zh, en)
    }
    console.log(`${names.size} boss names translated in standard_boss`)

    // model files: raw-deflated AMF3 holding one of the names as a string literal
    const needles = [...names].map(([zh, en]) => [literal(zh), literal(en)])
    const out = []
    for (const [p, e] of files) {
        if (!p.startsWith("production/upload/") || e.uncompressedSize > 4e6) continue
        const buf = await e.buffer()
        let amf
        try { amf = zlib.inflateRawSync(buf) } catch { continue }
        let changed = amf, total = 0
        for (const [from, to] of needles) { const r = replaceAll(changed, from, to); changed = r.buf; total += r.n }
        if (total === 0) continue
        const file = path.join(outDir, p)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, zlib.deflateRawSync(changed, { level: 9 }))
        out.push({ path: p, from: file })
    }
    fs.writeFileSync(path.join(outDir, "files.json"), JSON.stringify(out))
    console.log(`${out.length} model files renamed`)
})().catch(e => { console.error(e); process.exit(1) })
