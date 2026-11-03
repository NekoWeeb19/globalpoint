// Compares the CN and global game files that both have (same hashed name, different content), for the
// "globalized CN" update (scripts/build_cn_patch.cjs): which global images can replace CN's.
//
//   node scripts/scan_cn_globalize.cjs <worker index> <worker count> <out.json>
//   (run several at once, then merge with scripts/plan_cn_globalize.cjs)
//
// For each differing pair it records the kind (png, orderedmap table, other), and for PNGs both sizes
// and how many pixels clearly changed (re-encodes and tiny compression differences change none). For
// other files (sprite layouts, animations) it records the asset paths they name, so images used by a
// layout that changed can be left alone.
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const unzipper = require("unzipper")

const CN = require("./cn_archives.cjs").cnDir()
const GL = path.join(__dirname, "..", ".cdn", "en")

function loadEntities(dir) {
    const csv = fs.readdirSync(path.join(dir, "entities")).filter(f => /android_medium\.csv$/.test(f)).sort().pop()
    const m = new Map()
    for (const line of fs.readFileSync(path.join(dir, "entities", csv), "utf8").split(/\r?\n/)) {
        const p = line.split(",")
        if (p.length >= 4) m.set(p[0], p[3])
    }
    return m
}

// hashed path -> zip entry, newest copy winning (full archives first, then updates by version)
async function indexZips(dir) {
    const ver = name => (name.match(/-(\d+\.\d+\.\d+)-\d+-[0-9a-f]+\.zip$/) || name.match(/-(\d+\.\d+\.\d+)-/) || [])[1] || "0"
    const cmp = (a, b) => a.split(".").map(Number).reduce((r, x, i) => r || x - Number(b.split(".")[i] || 0), 0)
    const zips = []
    for (const sub of fs.readdirSync(dir)) {
        if (!sub.startsWith("archive-") || sub.includes("ios")) continue
        for (const z of fs.readdirSync(path.join(dir, sub))) if (z.endsWith(".zip"))
            zips.push({ file: path.join(dir, sub, z), full: sub.endsWith("-full"), v: ver(z) })
    }
    zips.sort((a, b) => (a.full === b.full ? cmp(a.v, b.v) : a.full ? -1 : 1))
    const map = new Map()
    for (const z of zips) {
        const d = await unzipper.Open.file(z.file)
        for (const e of d.files) if (e.type === "File") map.set(e.path, e)
    }
    return map
}

function kindOf(b) {
    if (b.length > 8 && b[0] === 0x89 && b.toString("latin1", 1, 4).toLowerCase() === "png") return "png"
    if (b.length > 8) {
        const n = b.readUInt32LE(0)
        if (n > 0 && n < b.length && b[4] === 0x78) return "orderedmap"
    }
    const s = b.toString("latin1", 0, 4)
    if (s.startsWith("OggS")) return "ogg"
    if (s.startsWith("ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "mp3"
    try { zlib.inflateRawSync(b.subarray(0, Math.min(b.length, 1 << 20)), { finishFlush: zlib.constants.Z_SYNC_FLUSH }); return "deflate" } catch { }
    return "other"
}

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
    if (bd !== 8 || il) return { w, h, px: null }
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

// pixels that clearly changed: compression noise is small, a changed label or picture is not
function changedPixels(A, B) {
    let n = 0
    for (let i = 0; i < A.px.length; i += 4) {
        if (A.px[i + 3] < 16 && B.px[i + 3] < 16) continue
        const d = Math.abs(A.px[i] - B.px[i]) + Math.abs(A.px[i + 1] - B.px[i + 1]) + Math.abs(A.px[i + 2] - B.px[i + 2]) + Math.abs(A.px[i + 3] - B.px[i + 3])
        if (d > 96) n++
    }
    return n
}

const refsOf = buf => {
    let text
    try { text = zlib.inflateRawSync(buf).toString("latin1") } catch { text = buf.toString("latin1") }
    return [...new Set(text.match(/[a-z][a-z0-9_]*(?:\/[a-z0-9_.]+){1,}/g) || [])].slice(0, 400)
}

if (require.main === module) (async () => {
    const [wi, wn, outFile] = [Number(process.argv[2] ?? 0), Number(process.argv[3] ?? 1), process.argv[4] ?? "scan.json"]
    const cnE = loadEntities(CN), glE = loadEntities(GL)
    const differing = [...cnE.keys()].filter(k => glE.has(k) && glE.get(k) !== cnE.get(k)).sort()
    const mine = differing.filter((_, i) => i % wn === wi)
    console.log(`worker ${wi}/${wn}: ${mine.length} of ${differing.length} differing files; indexing archives...`)
    const cnZ = await indexZips(CN), glZ = await indexZips(GL)
    const results = []
    let n = 0
    for (const k of mine) {
        const key = k
        const ce = cnZ.get(key), ge = glZ.get(key)
        if (!ce || !ge) { results.push({ k, kind: "missing", cn: !!ce, gl: !!ge }); continue }
        const [cb, gb] = [await ce.buffer(), await ge.buffer()]
        const kind = kindOf(gb)
        const r = { k, kind, cnSize: cb.length, glSize: gb.length }
        if (kind === "png" && kindOf(cb) === "png") {
            try {
                const A = decodePng(cb), B = decodePng(gb)
                r.cnDims = [A.w, A.h]; r.glDims = [B.w, B.h]
                if (A.px && B.px && A.w === B.w && A.h === B.h) r.changed = changedPixels(A, B)
            } catch (e) { r.error = String(e.message).slice(0, 80) }
        } else if (kind === "deflate" || kind === "other") {
            r.refs = [...new Set([...refsOf(cb), ...refsOf(gb)])]
        }
        results.push(r)
        if (++n % 500 === 0) console.log(`worker ${wi}: ${n}/${mine.length}`)
    }
    fs.writeFileSync(outFile, JSON.stringify(results))
    console.log(`worker ${wi}: done, ${results.length} -> ${outFile}`)
})().catch(e => { console.error(e); process.exit(1) })

module.exports = { decodePng, changedPixels }
