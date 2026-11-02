// Minimal AMF3 reader (enough for the game's .atlas.amf3.deflate sprite layouts and similar data):
// undefined, null, booleans, integers, doubles, strings, arrays, objects (sealed/dynamic traits),
// byte arrays, with AMF3's string/object/trait reference tables.
//
//   const { readAmf3 } = require("./amf3.cjs"); readAmf3(zlib.inflateRawSync(buf))
function readAmf3(buf) {
    let p = 0
    const strings = [], objects = [], traits = []
    const u8 = () => buf[p++]
    function u29() {
        let n = 0
        for (let i = 0; i < 3; i++) { const b = u8(); if (b < 0x80) return (n << 7) | b; n = (n << 7) | (b & 0x7f) }
        return (n << 8) | u8()
    }
    function str() {
        const h = u29()
        if ((h & 1) === 0) return strings[h >> 1]
        const len = h >> 1
        if (len === 0) return ""
        const s = buf.toString("utf8", p, p + len); p += len
        strings.push(s)
        return s
    }
    function value() {
        const m = u8()
        switch (m) {
            case 0x00: return undefined
            case 0x01: return null
            case 0x02: return false
            case 0x03: return true
            case 0x04: { const n = u29(); return n & 0x10000000 ? n - 0x20000000 : n }
            case 0x05: { const d = buf.readDoubleBE(p); p += 8; return d }
            case 0x06: return str()
            case 0x09: {
                const h = u29()
                if ((h & 1) === 0) return objects[h >> 1]
                const arr = []; objects.push(arr)
                for (let k = str(); k !== ""; k = str()) arr[k] = value()
                for (let i = 0; i < h >> 1; i++) arr.push(value())
                return arr
            }
            case 0x0a: {
                const h = u29()
                if ((h & 1) === 0) return objects[h >> 1]
                let t
                if ((h & 2) === 0) t = traits[h >> 2]
                else {
                    t = { name: str(), dynamic: (h & 8) !== 0, keys: [] }
                    for (let i = 0; i < h >> 4; i++) t.keys.push(str())
                    traits.push(t)
                }
                const obj = {}; objects.push(obj)
                for (const k of t.keys) obj[k] = value()
                if (t.dynamic) for (let k = str(); k !== ""; k = str()) obj[k] = value()
                return obj
            }
            case 0x0c: { const h = u29(); if ((h & 1) === 0) return objects[h >> 1]; const b = buf.subarray(p, p + (h >> 1)); p += h >> 1; objects.push(b); return b }
            default: throw new Error(`AMF3 marker 0x${m.toString(16)} at ${p - 1} not supported`)
        }
    }
    return value()
}
/**
 * AMF3 writer for plain data: arrays (dense), objects (written as anonymous dynamic objects),
 * strings, integers (29-bit; others as doubles), doubles, booleans, null/undefined. No references,
 * which any AMF3 reader accepts.
 */
function writeAmf3(value) {
    const parts = []
    function u29(n) {
        if (n < 0x80) parts.push(Buffer.from([n]))
        else if (n < 0x4000) parts.push(Buffer.from([(n >> 7) | 0x80, n & 0x7f]))
        else if (n < 0x200000) parts.push(Buffer.from([(n >> 14) | 0x80, ((n >> 7) & 0x7f) | 0x80, n & 0x7f]))
        else parts.push(Buffer.from([(n >> 22) | 0x80, ((n >> 15) & 0x7f) | 0x80, ((n >> 8) & 0x7f) | 0x80, n & 0xff]))
    }
    const str = s => { const b = Buffer.from(s, "utf8"); u29((b.length << 1) | 1); parts.push(b) }
    function val(v) {
        if (v === undefined) parts.push(Buffer.from([0x00]))
        else if (v === null) parts.push(Buffer.from([0x01]))
        else if (v === false) parts.push(Buffer.from([0x02]))
        else if (v === true) parts.push(Buffer.from([0x03]))
        else if (typeof v === "number") {
            if (Number.isInteger(v) && v >= -0x10000000 && v < 0x10000000) { parts.push(Buffer.from([0x04])); u29(v < 0 ? v + 0x20000000 : v) }
            else { const b = Buffer.alloc(9); b[0] = 0x05; b.writeDoubleBE(v, 1); parts.push(b) }
        } else if (typeof v === "string") { parts.push(Buffer.from([0x06])); str(v) }
        else if (Array.isArray(v)) { parts.push(Buffer.from([0x09])); u29((v.length << 1) | 1); str(""); for (const x of v) val(x) }
        else if (Buffer.isBuffer(v)) { parts.push(Buffer.from([0x0c])); u29((v.length << 1) | 1); parts.push(v) }
        else {
            parts.push(Buffer.from([0x0a, 0x0b])); str("") // dynamic, no sealed members, anonymous
            for (const [k, x] of Object.entries(v)) { if (k === "") continue; str(k); val(x) }
            str("")
        }
    }
    val(value)
    return Buffer.concat(parts)
}
module.exports = { readAmf3, writeAmf3 }
