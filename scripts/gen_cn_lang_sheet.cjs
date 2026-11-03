// English UI labels for the CN client: CN's general sprite sheet (scene/general/sprite_sheet.png, with
// its piece map) has the Chinese label pieces (bitmap_text-assets/home, menu, ...). Global keeps its
// labels per language in a separate sheet (scene/general/sprite_sheet_lang, pieces named
// sprite_sheet_en/...). This draws each English piece into the Chinese piece's place, scaled to fit
// (aspect kept, centered), so CN's sheet size and piece map stay exactly the same.
//
//   node scripts/gen_cn_lang_sheet.cjs <out dir> [--preview <dir>]
//   -> <out dir>/production/upload/73/4130924e07d945ae79acac1599758c4e50c432 (the new sheet), and
//      <out dir>/lang_sheet_files.json for scripts/build_cn_patch.cjs
const fs = require("fs")
const { cnZips } = require("./cn_archives.cjs")
const path = require("path")
const zlib = require("zlib")
const unzipper = require("unzipper")
const { readAmf3 } = require("./amf3.cjs")
const { decodePng } = require("./scan_cn_globalize.cjs")

const { hashName: hx } = require("./cdn_hash.cjs")
const CN_SHEET = "production/upload/" + hx("scene/general/sprite_sheet.png")
const CN_MAP = "production/upload/94/c238c788d5557f9ba757cf60f3f280c4650ded"
const GLOBAL_APK = require("./cn_archives.cjs").requiredPath("GLOBAL_APK", null, "the global game APK (world-flipper-0-0-81.apk)")
const GL_LANG_SHEET = hx("scene/general/sprite_sheet_lang.png")
const GL_LANG_MAP = "15/6a600623598ffa689d83f37bd9c1399dc38209"

// --- images: { w, h, px: RGBA } ---
function crop(img, x, y, w, h) {
    const out = { w, h, px: Buffer.alloc(w * h * 4) }
    for (let r = 0; r < h; r++) img.px.copy(out.px, r * w * 4, ((y + r) * img.w + x) * 4, ((y + r) * img.w + x + w) * 4)
    return out
}
// stored rotated pieces are turned back upright (Starling: stored 90° clockwise)
function rotateCCW(img) {
    const out = { w: img.h, h: img.w, px: Buffer.alloc(img.px.length) }
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++)
        img.px.copy(out.px, ((img.w - 1 - x) * out.w + y) * 4, (y * img.w + x) * 4, (y * img.w + x) * 4 + 4)
    return out
}
function rotateCW(img) {
    const out = { w: img.h, h: img.w, px: Buffer.alloc(img.px.length) }
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++)
        img.px.copy(out.px, (x * out.w + (img.h - 1 - y)) * 4, (y * img.w + x) * 4, (y * img.w + x) * 4 + 4)
    return out
}
// a piece upright, at its full (untrimmed) frame size
function pieceOf(sheet, e) {
    // w x h is the stored size; a rotated piece is stored turned 90° clockwise
    const stored = crop(sheet, e.x, e.y, e.w, e.h)
    const up = e.r ? rotateCCW(stored) : stored
    const fw = e.fw ?? up.w, fh = e.fh ?? up.h, fx = e.fx ?? 0, fy = e.fy ?? 0
    const full = { w: fw, h: fh, px: Buffer.alloc(fw * fh * 4) }
    for (let y = 0; y < up.h; y++) for (let x = 0; x < up.w; x++) {
        const tx = x - fx, ty = y - fy
        if (tx >= 0 && ty >= 0 && tx < fw && ty < fh) up.px.copy(full.px, (ty * fw + tx) * 4, (y * up.w + x) * 4, (y * up.w + x) * 4 + 4)
    }
    return full
}
// scale to fit w x h (aspect kept, centered), area-averaged
function fit(img, w, h) {
    const s = Math.min(w / img.w, h / img.h, 1)
    const sw = Math.max(1, Math.round(img.w * s)), sh = Math.max(1, Math.round(img.h * s))
    const ox = Math.floor((w - sw) / 2), oy = Math.floor((h - sh) / 2)
    const out = { w, h, px: Buffer.alloc(w * h * 4) }
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const x0 = x / s, y0 = y / s, x1 = Math.min(img.w, (x + 1) / s), y1 = Math.min(img.h, (y + 1) / s)
        let r = 0, g = 0, b = 0, a = 0, n = 0
        for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
            const i = (yy * img.w + xx) * 4, al = img.px[i + 3]
            r += img.px[i] * al; g += img.px[i + 1] * al; b += img.px[i + 2] * al; a += al; n++
        }
        const o = ((y + oy) * w + x + ox) * 4
        if (a > 0) { out.px[o] = r / a; out.px[o + 1] = g / a; out.px[o + 2] = b / a }
        out.px[o + 3] = n ? a / n : 0
    }
    return out
}
// writes a full-frame piece back into the sheet at e's stored (trimmed, maybe rotated) place
function putPiece(sheet, e, full) {
    const fx = e.fx ?? 0, fy = e.fy ?? 0
    // the upright trimmed size (the stored w x h turned back for a rotated piece)
    const tw = e.r ? e.h : e.w, th = e.r ? e.w : e.h
    const trimmed = { w: tw, h: th, px: Buffer.alloc(tw * th * 4) }
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const sx = x - fx, sy = y - fy
        if (sx >= 0 && sy >= 0 && sx < full.w && sy < full.h) full.px.copy(trimmed.px, (y * tw + x) * 4, (sy * full.w + sx) * 4, (sy * full.w + sx) * 4 + 4)
    }
    const stored = e.r ? rotateCW(trimmed) : trimmed
    for (let y = 0; y < stored.h; y++) stored.px.copy(sheet.px, ((e.y + y) * sheet.w + e.x) * 4, y * stored.w * 4, (y + 1) * stored.w * 4)
}
function encodePng(img) {
    const raw = Buffer.alloc((img.w * 4 + 1) * img.h)
    for (let y = 0; y < img.h; y++) img.px.copy(raw, y * (img.w * 4 + 1) + 1, y * img.w * 4, (y + 1) * img.w * 4)
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
        const td = Buffer.concat([Buffer.from(type, "latin1"), data])
        const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0)
        return Buffer.concat([len, td, crc])
    }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4); ihdr[8] = 8; ihdr[9] = 6
    // the game's files use a lowercase "png" signature
    return Buffer.concat([Buffer.from([0x89, 0x70, 0x6e, 0x67, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))])
}

async function cnFile(hashed) {
    let found = null
    for (const z of cnZips()) {
        const e = (await unzipper.Open.file(z)).files.find(f => f.path === hashed)
        if (e) found = e // later (newer) archives win
    }
    return found ? found.buffer() : null
}

if (require.main === module) (async () => {
    const [outDir, flag, previewDir] = process.argv.slice(2)
    const cnSheetBuf = await cnFile(CN_SHEET), cnMapBuf = await cnFile(CN_MAP)
    const apk = await unzipper.Open.file(GLOBAL_APK)
    const bundle = await unzipper.Open.buffer(await apk.files.find(f => f.path === "assets/bundle.zip").buffer())
    const glFile = async suffix => bundle.files.find(f => f.path.endsWith(suffix)).buffer()
    const sheet = decodePng(cnSheetBuf), lang = decodePng(await glFile(GL_LANG_SHEET))
    const cnMap = readAmf3(zlib.inflateRawSync(cnMapBuf))
    const enMap = new Map(readAmf3(zlib.inflateRawSync(await glFile(GL_LANG_MAP)))
        .filter(e => e.n.startsWith("scene/general/sprite_sheet_en/"))
        .map(e => [e.n.replace("sprite_sheet_en/", "sprite_sheet/"), e]))
    let done = 0
    for (const e of cnMap) {
        const en = enMap.get(e.n)
        if (!en) continue
        // the English text (its trimmed content, upright) fitted into the Chinese piece's trimmed area,
        // which is all CN stores: fitting into the larger frame would cut the English off at the edges
        const enContent = en.r ? rotateCCW(crop(lang, en.x, en.y, en.w, en.h)) : crop(lang, en.x, en.y, en.w, en.h)
        const tw = e.r ? e.h : e.w, th = e.r ? e.w : e.h
        const fitted = fit(enContent, tw, th)
        // as a full frame for putPiece: the fitted content sits at the trimmed offset
        const fw = e.fw ?? tw, fh = e.fh ?? th, fx = e.fx ?? 0, fy = e.fy ?? 0
        const target = { w: fw, h: fh, px: Buffer.alloc(fw * fh * 4) }
        for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
            const dx = x - fx, dy = y - fy
            if (dx >= 0 && dy >= 0 && dx < fw && dy < fh) fitted.px.copy(target.px, (dy * fw + dx) * 4, (y * tw + x) * 4, (y * tw + x) * 4 + 4)
        }
        const enPiece = pieceOf(lang, en)
        if (previewDir && done < 6) {
            fs.mkdirSync(previewDir, { recursive: true })
            const base = path.join(previewDir, e.n.split("/").pop())
            fs.writeFileSync(base + "_cn.png", encodePng(pieceOf(sheet, e)))
            fs.writeFileSync(base + "_en.png", encodePng(target))
        }
        putPiece(sheet, e, target)
        done++
    }
    console.log(`${done} label pieces now English (of ${cnMap.length} pieces)`)
    if (flag === "--preview") return
    const file = path.join(outDir, CN_SHEET)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, encodePng(sheet))
    fs.writeFileSync(path.join(outDir, "lang_sheet_files.json"), JSON.stringify([{ path: CN_SHEET, from: file }]))
    console.log(`wrote ${file}`)
})().catch(e => { console.error(e); process.exit(1) })
