// Lists the summon-screen animations that are short strips (the early banners' layout, ~624 px high
// instead of the full-screen ~1940): every kind 0 row of master/gacha/gacha_feature_content, measured
// by the largest frame height in its sprite layout, from the CN game files plus StarPoint's patches.
// Writes scripts/client_mod/strip_pages.json ({ "<animation folder>": height }) for
// scripts/client_mod/patch_cn_strip_pages.cjs, which centers those pages on the screen.
//
//   node scripts/gen_cn_strip_pages.cjs
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const zlib = require("zlib")
const unzipper = require("unzipper")
const R = require("./cdn_rows.cjs")
const { cnZips } = require("./cn_archives.cjs")
const { readAmf3 } = require("./client_mod/amf3.cjs")

const ROOT = path.join(__dirname, "..")
const SALT = "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy"
const hashed = l => { const h = crypto.createHash("sha1").update(l + SALT).digest("hex"); return `production/upload/${h.slice(0, 2)}/${h.slice(2)}` }
const FULL = 1000 // taller than this is a full-screen page

;(async () => {
    const newest = new Map()
    const zips = [...cnZips()]
    for (const p of JSON.parse(fs.readFileSync(path.join(ROOT, ".cdn", "cn_patches", "patches.json"), "utf8")))
        for (const a of p.archives) { const f = path.join(ROOT, ".cdn", "cn_patches", a.file); if (fs.existsSync(f)) zips.push(f) }
    for (const z of zips) for (const e of (await unzipper.Open.file(z)).files) newest.set(e.path.split("\\").join("/"), e)
    const feature = newest.get(hashed("master/gacha/gacha_feature_content.orderedmap"))
    const dirs = new Set()
    for (const { leaf } of R.leaves(R.decodeFile(await feature.buffer()))) {
        const c = R.splitCsv(leaf.text)
        if (c[0] === "0" && c[2]) dirs.add(c[2].replace(/\/[^/]+$/, ""))
    }
    const strips = {}
    let full = 0, missing = 0
    for (const dir of [...dirs].sort()) {
        const atlas = newest.get(hashed(dir + "/sprite_sheet.atlas.amf3.deflate"))
        if (!atlas) { missing++; continue }
        const frames = readAmf3(zlib.inflateRawSync(await atlas.buffer()))
        const h = Math.max(...frames.map(f => f.fh ?? (f.r ? f.w : f.h)))
        if (h > FULL) full++
        else strips[dir] = h
    }
    const out = path.join(__dirname, "client_mod", "strip_pages.json")
    fs.writeFileSync(out, JSON.stringify(strips, null, 1) + "\n")
    console.log(`${Object.keys(strips).length} strip animations, ${full} full-screen, ${missing} without files -> ${out}`)
})().catch(e => { console.error(e); process.exit(1) })
