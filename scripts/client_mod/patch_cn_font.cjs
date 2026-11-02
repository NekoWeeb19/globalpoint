// Gives the CN client global's English letters: the Latin characters of the CN client's text font
// (DefineFont3 "SY", Noto Sans SC) are replaced with global's Poppins (shape, advance width,
// bounds, alignment zones). Global's English text was written to fit its boxes in Poppins; CN's
// font sets it 6-11% wider, so long names ran past their boxes. Chinese and everything else keeps
// CN's glyphs (Flash can't fall back between two embedded fonts, so the font is merged).
//
// Both fonts use the same units (1024 x 20 per em), so glyph shapes copy over as they are.
//
//   node patch_cn_font.cjs <cn.swf> <global.swf> <out.swf>
const A = require("./abc.cjs")

const [cnFile, glFile, outFile] = process.argv.slice(2)
if (!outFile) throw new Error("usage: patch_cn_font.cjs <cn.swf> <global.swf> <out.swf>")

// the characters taken from Poppins: Latin, Latin-1, Latin Extended-A/B, general punctuation, euro
const TAKE = c => (c >= 0x20 && c < 0x250) || (c >= 0x2000 && c <= 0x206f) || c === 0x20ac

class Bits {
    constructor(buf, pos) { this.buf = buf; this.pos = pos * 8 }
    ub(n) { let v = 0; for (let i = 0; i < n; i++) { v = (v << 1) | ((this.buf[this.pos >> 3] >> (7 - (this.pos & 7))) & 1); this.pos++ } return v >>> 0 }
    byte() { return Math.ceil(this.pos / 8) }
}
/** Byte length of a RECT starting at p. */
function rectLength(buf, p) { const b = new Bits(buf, p); const n = b.ub(5); b.ub(n * 4); return b.byte() - p }

/** DefineFont3 -> parts (glyph shapes as byte blobs, codes, layout tables as byte blobs). */
function parseFont3(d) {
    let p = 0
    const id = d.readUInt16LE(p); p += 2
    const flags = d[p++], lang = d[p++], nameLen = d[p++]
    const name = d.subarray(p, p + nameLen); p += nameLen
    const n = d.readUInt16LE(p); p += 2
    const wideOff = (flags & 8) !== 0, wideCodes = (flags & 4) !== 0, hasLayout = (flags & 128) !== 0
    if (!wideCodes || !hasLayout) throw new Error("font without wide codes or layout")
    const tableStart = p
    const offs = []
    for (let i = 0; i <= n; i++) { offs.push(wideOff ? d.readUInt32LE(p) : d.readUInt16LE(p)); p += wideOff ? 4 : 2 }
    const shapes = []
    for (let i = 0; i < n; i++) shapes.push(d.subarray(tableStart + offs[i], tableStart + offs[i + 1]))
    p = tableStart + offs[n]
    const codes = []
    for (let i = 0; i < n; i++) { codes.push(d.readUInt16LE(p)); p += 2 }
    const ascent = d.readUInt16LE(p), descent = d.readUInt16LE(p + 2), leading = d.readInt16LE(p + 4); p += 6
    const advances = []
    for (let i = 0; i < n; i++) { advances.push(d.readInt16LE(p)); p += 2 }
    const bounds = []
    for (let i = 0; i < n; i++) { const len = rectLength(d, p); bounds.push(d.subarray(p, p + len)); p += len }
    const kerning = d.subarray(p) // KerningCount + records, kept as they are
    return { id, flags, lang, name, n, shapes, codes, ascent, descent, leading, advances, bounds, kerning }
}

function writeFont3(f) {
    const n = f.codes.length
    const shapesLen = f.shapes.reduce((s, b) => s + b.length, 0)
    const wideOff = (n + 1) * 2 + shapesLen > 0xffff
    const flags = wideOff ? f.flags | 8 : f.flags & ~8
    const offSize = wideOff ? 4 : 2
    const parts = []
    const head = Buffer.alloc(5 + f.name.length + 2)
    head.writeUInt16LE(f.id, 0); head[2] = flags; head[3] = f.lang; head[4] = f.name.length
    f.name.copy(head, 5); head.writeUInt16LE(n, 5 + f.name.length)
    parts.push(head)
    const table = Buffer.alloc((n + 1) * offSize)
    let off = (n + 1) * offSize
    for (let i = 0; i <= n; i++) {
        if (wideOff) table.writeUInt32LE(off, i * 4); else table.writeUInt16LE(off, i * 2)
        if (i < n) off += f.shapes[i].length
    }
    parts.push(table, ...f.shapes)
    const codes = Buffer.alloc(n * 2); f.codes.forEach((c, i) => codes.writeUInt16LE(c, i * 2)); parts.push(codes)
    const lay = Buffer.alloc(6 + n * 2)
    lay.writeUInt16LE(f.ascent, 0); lay.writeUInt16LE(f.descent, 2); lay.writeInt16LE(f.leading, 4)
    f.advances.forEach((a, i) => lay.writeInt16LE(a, 6 + i * 2))
    parts.push(lay, ...f.bounds, f.kerning)
    return Buffer.concat(parts)
}

/** DefineFontAlignZones: [fontId, csm byte, one 10-byte record per glyph]. */
const zonesOf = d => ({ id: d.readUInt16LE(0), csm: d[2], records: Array.from({ length: (d.length - 3) / 10 }, (_, i) => d.subarray(3 + i * 10, 13 + i * 10)) })

function fontParts(swf, wanted) {
    const f3 = swf.tags.find(t => t.code === 75 && parseFont3(t.data).name.toString("utf8").replace(/\0/g, "") === wanted)
    if (!f3) throw new Error(`font ${wanted} not found`)
    const font = parseFont3(f3.data)
    const z = swf.tags.find(t => t.code === 73 && t.data.readUInt16LE(0) === font.id)
    return { tag: f3, font, zoneTag: z, zones: z ? zonesOf(z.data) : null }
}

const cnSwf = A.readSwf(cnFile), glSwf = A.readSwf(glFile)
const cn = fontParts(cnSwf, "SY"), gl = fontParts(glSwf, "Poppins")
const glIndex = new Map(gl.font.codes.map((c, i) => [c, i]))
let replaced = 0, added = 0
const cnIndex = new Map(cn.font.codes.map((c, i) => [c, i]))
for (const [code, gi] of glIndex) {
    if (!TAKE(code)) continue
    let ci = cnIndex.get(code)
    if (ci === undefined) {
        // a Latin character CN's font doesn't have: added (codes must stay sorted)
        let at = cn.font.codes.findIndex(c => c > code); if (at < 0) at = cn.font.codes.length
        cn.font.codes.splice(at, 0, code); cn.font.shapes.splice(at, 0, gl.font.shapes[gi])
        cn.font.advances.splice(at, 0, gl.font.advances[gi]); cn.font.bounds.splice(at, 0, gl.font.bounds[gi])
        if (cn.zones && gl.zones) cn.zones.records.splice(at, 0, gl.zones.records[gi])
        cnIndex.clear(); cn.font.codes.forEach((c, i) => cnIndex.set(c, i))
        added++
        continue
    }
    cn.font.shapes[ci] = gl.font.shapes[gi]
    cn.font.advances[ci] = gl.font.advances[gi]
    cn.font.bounds[ci] = gl.font.bounds[gi]
    if (cn.zones && gl.zones) cn.zones.records[ci] = gl.zones.records[gi]
    replaced++
}
if (added > 0) cn.font.kerning = Buffer.from([0, 0]) // kerning refers to glyph pairs by code; dropped when glyphs are added (CN's has none of note)
cn.tag.data = writeFont3(cn.font)
if (cn.zoneTag) {
    const head = Buffer.alloc(3); head.writeUInt16LE(cn.zones.id, 0); head[2] = cn.zones.csm
    cn.zoneTag.data = Buffer.concat([head, ...cn.zones.records])
}
A.writeSwf(outFile, cnSwf, false)
console.log(`wrote ${outFile}: ${replaced} Latin glyphs from Poppins, ${added} added (CN font now ${cn.font.codes.length} glyphs)`)
