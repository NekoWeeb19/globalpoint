// Hides the halftone dot band along the top edge of the early banners' strip-sized summon art. The old
// screen layout hid it under its top bar; with the strips centered (client_mod/patch_cn_strip_pages.cjs)
// it shows. The band is one small tile (32x61, white dots) repeated along the edge, so making that tile
// transparent in the sprite sheet removes the band and leaves the rest of the art as it is.
// Writes .cdn/cn_work_strip_band/files.json (the edited sheets) for scripts/build_cn_patch.cjs.
//
//   node scripts/gen_cn_strip_band.cjs
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const zlib = require("zlib")
const { execFileSync } = require("child_process")
const unzipper = require("unzipper")
const { cnZips } = require("./cn_archives.cjs")
const { readAmf3 } = require("./client_mod/amf3.cjs")

const ROOT = path.join(__dirname, "..")
const OUT = path.join(ROOT, ".cdn", "cn_work_strip_band")
const SALT = "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy"
const hashed = l => { const h = crypto.createHash("sha1").update(l + SALT).digest("hex"); return `production/upload/${h.slice(0, 2)}/${h.slice(2)}` }
const TILE = [32, 61]

;(async () => {
    const strips = JSON.parse(fs.readFileSync(path.join(__dirname, "client_mod", "strip_pages.json"), "utf8"))
    const want = new Set()
    for (const dir of Object.keys(strips)) for (const f of ["/sprite_sheet.png", "/sprite_sheet.atlas.amf3.deflate"]) want.add(hashed(dir + f))
    // newest copy of each: CN files, then StarPoint's patches (not this script's own earlier output)
    const newest = new Map()
    const zips = [...cnZips()]
    for (const p of JSON.parse(fs.readFileSync(path.join(ROOT, ".cdn", "cn_patches", "patches.json"), "utf8")))
        if (!p.stripBand) for (const a of p.archives) { const f = path.join(ROOT, ".cdn", "cn_patches", a.file); if (fs.existsSync(f)) zips.push(f) }
    for (const z of zips) for (const e of (await unzipper.Open.file(z)).files) { const p = e.path.split("\\").join("/"); if (want.has(p)) newest.set(p, e) }

    fs.rmSync(OUT, { recursive: true, force: true })
    const tmp = path.join(OUT, "tmp")
    fs.mkdirSync(tmp, { recursive: true })
    const list = []
    for (const dir of Object.keys(strips).sort()) {
        const pngKey = hashed(dir + "/sprite_sheet.png"), atlas = newest.get(hashed(dir + "/sprite_sheet.atlas.amf3.deflate")), png = newest.get(pngKey)
        if (!atlas || !png) continue
        const frames = readAmf3(zlib.inflateRawSync(await atlas.buffer()))
        const tile = frames.find(f => (f.r ? [f.h, f.w] : [f.w, f.h]).join("x") === TILE.join("x"))
        if (!tile) continue
        const buf = await png.buffer()
        // some CN sheets are stored smaller than their layout (the game scales the layout to the sheet)
        const exW = Math.max(...frames.map(f => f.x + f.w)), exH = Math.max(...frames.map(f => f.y + f.h))
        const scale = Math.min(1, buf.readUInt32BE(16) / exW, buf.readUInt32BE(20) / exH)
        const rect = [Math.floor(tile.x * scale), Math.floor(tile.y * scale), Math.ceil(tile.w * scale), Math.ceil(tile.h * scale)]
        const lower = buf.toString("latin1", 1, 4) === "png"
        buf.write("PNG", 1, "latin1") // the game's sheets have a lowercase "png" signature
        const inFile = path.join(tmp, "in.png"), outFile = path.join(OUT, pngKey)
        fs.writeFileSync(inFile, buf)
        fs.mkdirSync(path.dirname(outFile), { recursive: true })
        try {
            execFileSync("java", [path.join(__dirname, "client_mod", "ClearRect.java"), inFile, outFile, ...rect].map(String), { stdio: "pipe" })
        } catch (e) {
            console.log(`${dir}: ${String(e.stdout).trim() || e.message}, left alone`)
            continue
        }
        if (lower) { const b = fs.readFileSync(outFile); b.write("png", 1, "latin1"); fs.writeFileSync(outFile, b) }
        list.push({ path: pngKey, from: outFile })
        console.log(`${dir}: band tile ${tile.n.split("/").pop()} cleared${scale < 1 ? ` (sheet at ${scale.toFixed(2)}x)` : ""}`)
    }
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.writeFileSync(path.join(OUT, "files.json"), JSON.stringify(list))
    console.log(`${list.length} sheets -> ${path.join(OUT, "files.json")}`)
})().catch(e => { console.error(e); process.exit(1) })
