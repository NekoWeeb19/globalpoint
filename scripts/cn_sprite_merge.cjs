// Copies global's English sprites into the CN game's packed sprite sheets, for the "globalized CN"
// update (scripts/build_cn_patch.cjs).
//
// Most UI pictures are packed into sheets (one PNG + a layout file listing each sprite's name and
// rectangle). CN's sheets are packed differently from global's and hold CN-only sprites, so a whole
// global sheet can't replace CN's. Instead, every sprite that both sheets have with the same name, size
// and rotation is copied from global's sheet into CN's at CN's position; everything else stays CN's.
//
//   node scripts/cn_sprite_merge.cjs <out dir> <files.json>
//     writes the changed sheets to <out dir>/<hashed path> and lists them in files.json
//     ([{ path, from }], the build_cn_patch.cjs format); prints the sprites it couldn't match.
//
// Layout files: AMF3 arrays of { n: "<sheet>/.gen/<sprite>/<frame>", x, y, w, h, r?, fx, fy, fw, fh },
// raw-deflated, in production/upload. A sheet's PNG is "<sheet>.png" or "<sheet>/sprite_sheet.png".
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const crypto = require("crypto")
const unzipper = require("unzipper")

const SALT = "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy"
const CN = "D:/WF client/.cdn/cn"
const GL = path.join(__dirname, "..", ".cdn", "en")
const SKIP_PREFIXES = ["story/", "character/", "battle/boss/", "battle/funnel/", "battle/effect/", "battle/field_object/"]
const hashKey = logical => { const h = crypto.createHash("sha1").update(logical + SALT).digest("hex"); return h.slice(0, 2) + "/" + h.slice(2) }
const tail2 = p => p.split(String.fromCharCode(92)).join("/").split("/").slice(-2).join("/")

// ---- AMF3 (just what the layout files use) ----
function readAmf(buf) {
    let p = 0
    const strings = [], objects = [], traitsTable = []
    const u29 = () => {
        let v = 0
        for (let i = 0; i < 4; i++) {
            const b = buf[p++]
            if (i === 3) return (v << 8) | b
            v = (v << 7) | (b & 0x7f)
            if (!(b & 0x80)) return v
        }
        return v
    }
    const str = () => {
        const u = u29()
        if (!(u & 1)) return strings[u >> 1]
        const len = u >> 1
        const s = buf.toString("utf8", p, p + len); p += len
        if (len > 0) strings.push(s)
        return s
    }
    const value = () => {
        const m = buf[p++]
        switch (m) {
            case 0: case 1: return null
            case 2: return false
            case 3: return true
            case 4: { const v = u29(); return v & 0x10000000 ? v - 0x20000000 : v }
            case 5: { const v = buf.readDoubleBE(p); p += 8; return v }
            case 6: return str()
            case 9: {
                const u = u29()
                if (!(u & 1)) return objects[u >> 1]
                const arr = []; objects.push(arr)
                for (let k = str(); k !== ""; k = str()) arr[k] = value()
                for (let i = 0; i < u >> 1; i++) arr.push(value())
                return arr
            }
            case 10: {
                const u = u29()
                if (!(u & 1)) return objects[u >> 1]
                let traits
                if ((u & 3) === 1) traits = traitsTable[u >> 2]
                else {
                    traits = { dynamic: !!(u & 8), names: [] }
                    str()
                    for (let i = 0; i < u >> 4; i++) traits.names.push(str())
                    traitsTable.push(traits)
                }
                const obj = {}; objects.push(obj)
                for (const n of traits.names) obj[n] = value()
                if (traits.dynamic) for (let k = str(); k !== ""; k = str()) obj[k] = value()
                return obj
            }
            default: throw new Error(`AMF marker ${m} at ${p - 1}`)
        }
    }
    return value()
}

// ---- PNG ----
function decodePng(b) {
    let p = 8, w, h, bd, ct, il, plte, trns
    const idat = []
    while (p < b.length) {
        const len = b.readUInt32BE(p), t = b.toString("latin1", p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len)
        if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; il = d[12] }
        else if (t === "IDAT") idat.push(d)
        else if (t === "PLTE") plte = d
        else if (t === "tRNS") trns = d
        else if (t === "IEND") break
        p += 12 + len
    }
    if (bd !== 8 || il) return null
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct]
    const raw = zlib.inflateSync(Buffer.concat(idat))
    const st = w * ch, out = Buffer.alloc(w * h * 4)
    let prev = Buffer.alloc(st)
    for (let y = 0; y < h; y++) {
        const f = raw[y * (st + 1)], line = Buffer.from(raw.subarray(y * (st + 1) + 1, (y + 1) * (st + 1)))
        for (let x = 0; x < st; x++) {
            const a = x >= ch ? line[x - ch] : 0, u = prev[x], c = x >= ch ? prev[x - ch] : 0
            let v = line[x]
            if (f === 1) v += a
            else if (f === 2) v += u
            else if (f === 3) v += (a + u) >> 1
            else if (f === 4) { const pp = a + u - c, pa = Math.abs(pp - a), pb = Math.abs(pp - u), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? u : c) }
            line[x] = v & 255
        }
        for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4
            if (ct === 6) line.copy(out, o, x * 4, x * 4 + 4)
            else if (ct === 2) { out[o] = line[x * 3]; out[o + 1] = line[x * 3 + 1]; out[o + 2] = line[x * 3 + 2]; out[o + 3] = 255 }
            else if (ct === 3) { const i = line[x]; out[o] = plte[i * 3]; out[o + 1] = plte[i * 3 + 1]; out[o + 2] = plte[i * 3 + 2]; out[o + 3] = trns && i < trns.length ? trns[i] : 255 }
            else if (ct === 0) { out[o] = out[o + 1] = out[o + 2] = line[x]; out[o + 3] = 255 }
            else { out[o] = out[o + 1] = out[o + 2] = line[x * 2]; out[o + 3] = line[x * 2 + 1] }
        }
        prev = line
    }
    return { w, h, px: out }
}

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c } return t })()
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
function encodePng({ w, h, px }, signature) {
    const chunk = (type, data) => {
        const out = Buffer.alloc(12 + data.length)
        out.writeUInt32BE(data.length, 0); out.write(type, 4, "latin1"); data.copy(out, 8)
        out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])), 8 + data.length)
        return out
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
    const raw = Buffer.alloc(h * (w * 4 + 1))
    for (let y = 0; y < h; y++) px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
    return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))])
}

// ---- CDN ----
async function indexZips(dir) {
    const ver = name => (name.match(/-(\d+\.\d+\.\d+)-/) || [])[1] || "0"
    const cmp = (a, b) => a.split(".").map(Number).reduce((r, x, i) => r || x - Number(b.split(".")[i] || 0), 0)
    const zips = []
    for (const sub of fs.readdirSync(dir)) {
        if (!sub.startsWith("archive-") || sub.includes("ios")) continue
        for (const z of fs.readdirSync(path.join(dir, sub))) if (z.endsWith(".zip")) zips.push({ file: path.join(dir, sub, z), full: sub.endsWith("-full"), v: ver(z) })
    }
    zips.sort((a, b) => (a.full === b.full ? cmp(a.v, b.v) : a.full ? -1 : 1))
    const map = new Map()
    for (const z of zips) for (const e of (await unzipper.Open.file(z.file)).files) if (e.type === "File") map.set(tail2(e.path), { e, path: "production/" + e.path.split(String.fromCharCode(92)).join("/").replace(/^production\//, "") })
    return map
}

/** sheet logical name -> [{ n, x, y, w, h, r }] from every layout file of a CDN */
async function layouts(zipIndex) {
    const sheets = new Map()
    for (const [, { e, path: p }] of zipIndex) {
        if (!p.includes("/upload/") || e.uncompressedSize > 4_000_000) continue
        const b = await e.buffer()
        if (b[0] === 0x89) continue
        let t
        try { t = zlib.inflateRawSync(b) } catch { continue }
        if (t[0] !== 9 || t.indexOf("/.gen/") < 0) continue
        let arr
        try { arr = readAmf(t) } catch { continue }
        if (!Array.isArray(arr)) continue
        const seen = new Set()
        for (const s of arr) {
            if (!s || typeof s.n !== "string" || !s.n.includes("/.gen/")) continue
            const sheet = s.n.slice(0, s.n.indexOf("/.gen/"))
            if (!sheets.has(sheet)) sheets.set(sheet, new Map())
            if (!seen.has(sheet)) { seen.add(sheet); const files = sheets.get(sheet).files ?? 0; sheets.get(sheet).files = files + 1 }
            sheets.get(sheet).set(s.n.slice(sheet.length + 6), { x: s.x | 0, y: s.y | 0, w: s.w | 0, h: s.h | 0, r: !!s.r })
        }
    }
    return sheets
}

if (require.main === module) (async () => {
    const [outDir, listFile] = process.argv.slice(2)
    if (!outDir || !listFile) { console.error("usage: cn_sprite_merge.cjs <out dir> <files.json>"); process.exit(1) }
    console.log("indexing archives...")
    const [cnZ, glZ] = [await indexZips(CN), await indexZips(GL)]
    console.log("reading layouts...")
    const [cnL, glL] = [await layouts(cnZ), await layouts(glZ)]
    console.log(`sheets: CN ${cnL.size}, global ${glL.size}`)
    const list = [], report = []
    let copiedTotal = 0
    for (const [sheet, cnSprites] of cnL) {
        // story scenes and unit/boss animations differ only by re-compression; text lives in UI sheets
        if (SKIP_PREFIXES.some(prefix => sheet.startsWith(prefix))) continue
        const glSprites = glL.get(sheet)
        if (!glSprites) continue
        // a sheet whose sprites come from several layout files may be several pictures: unclear, skip
        if (cnSprites.files !== 1 || glSprites.files !== 1) { report.push(`${sheet}: several layout files, skipped`); continue }
        const key = [sheet + ".png", sheet + "/sprite_sheet.png"].map(hashKey).find(k => cnZ.has(k) && glZ.has(k))
        if (!key) continue
        const ce = cnZ.get(key), ge = glZ.get(key)
        const [cb, gb] = [await ce.e.buffer(), await ge.e.buffer()]
        if (cb.equals(gb)) continue
        const fix = b => { const c = Buffer.from(b); c.write("PNG", 1, "latin1"); return c }
        const A = decodePng(fix(cb)), B = decodePng(fix(gb))
        if (!A || !B) { report.push(`${sheet}: can't decode`); continue }
        let copied = 0, unmatched = 0
        for (const [name, c] of cnSprites) {
            const g = glSprites.get(name)
            if (!g) continue
            if (g.w !== c.w || g.h !== c.h || g.r !== c.r) { unmatched++; continue }
            // rotated sprites are stored turned in both sheets the same way, so the stored box copies as is
            const [bw, bh] = c.r ? [c.h, c.w] : [c.w, c.h]
            if (c.x + bw > A.w || c.y + bh > A.h || g.x + bw > B.w || g.y + bh > B.h) { unmatched++; continue }
            // only sprites that clearly look different (a changed label), not re-compression noise
            let changed = 0
            for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
                const ao = ((c.y + y) * A.w + c.x + x) * 4, bo = ((g.y + y) * B.w + g.x + x) * 4
                if (A.px[ao + 3] < 16 && B.px[bo + 3] < 16) continue
                const d = Math.abs(A.px[ao] - B.px[bo]) + Math.abs(A.px[ao + 1] - B.px[bo + 1]) + Math.abs(A.px[ao + 2] - B.px[bo + 2]) + Math.abs(A.px[ao + 3] - B.px[bo + 3])
                if (d > 96) changed++
            }
            if (changed < Math.max(20, bw * bh * 0.01)) continue
            for (let y = 0; y < bh; y++) B.px.copy(A.px, ((c.y + y) * A.w + c.x) * 4, ((g.y + y) * B.w + g.x) * 4, ((g.y + y) * B.w + g.x + bw) * 4)
            copied++
        }
        if (unmatched) report.push(`${sheet}: ${unmatched} sprite(s) differ in size, left as CN's`)
        if (copied === 0) continue
        const file = path.join(outDir, ce.path)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, encodePng(A, cb.subarray(0, 8)))
        list.push({ path: ce.path, from: file })
        copiedTotal += copied
        console.log(`${sheet}: ${copied} sprite(s) from global`)
    }
    fs.writeFileSync(listFile, JSON.stringify(list, null, 1))
    console.log(`\n${list.length} sheets changed, ${copiedTotal} sprites copied -> ${listFile}`)
    for (const line of report) console.log("  " + line)
})().catch(e => { console.error(e); process.exit(1) })

module.exports = { readAmf, decodePng, encodePng }
