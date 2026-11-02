// A small AMF3 reader (Flash's binary object format), for the game's layout and sprite-sheet files
// (deflate-compressed AMF3). Objects come back as plain objects, arrays as arrays (with an associative
// part merged in as properties when present).
//   const { readAmf3 } = require("./amf3.cjs"); readAmf3(zlib.inflateRawSync(buf))
function readAmf3(buf) {
    let p = 0
    const strings = [], objects = [], traits = []
    const u8 = () => buf[p++]
    const u29 = () => {
        let v = 0
        for (let i = 0; i < 4; i++) {
            const b = u8()
            if (i < 3) { v = (v << 7) | (b & 0x7f); if (!(b & 0x80)) return v }
            else v = (v << 8) | b
        }
        return v
    }
    const str = () => {
        const r = u29()
        if (!(r & 1)) return strings[r >> 1]
        const len = r >> 1
        if (len === 0) return ""
        const s = buf.toString("utf8", p, p + len)
        p += len
        strings.push(s)
        return s
    }
    const value = () => {
        const t = u8()
        switch (t) {
            case 0x00: return undefined
            case 0x01: return null
            case 0x02: return false
            case 0x03: return true
            case 0x04: { const v = u29(); return v & 0x10000000 ? v - 0x20000000 : v }
            case 0x05: { const v = buf.readDoubleBE(p); p += 8; return v }
            case 0x06: return str()
            case 0x07: case 0x0b: { const r = u29(); if (!(r & 1)) return objects[r >> 1]; const s = buf.toString("utf8", p, p + (r >> 1)); p += r >> 1; objects.push(s); return s }
            case 0x08: { const r = u29(); if (!(r & 1)) return objects[r >> 1]; const d = new Date(buf.readDoubleBE(p)); p += 8; objects.push(d); return d }
            case 0x09: {
                const r = u29()
                if (!(r & 1)) return objects[r >> 1]
                const arr = []
                objects.push(arr)
                for (let k = str(); k !== ""; k = str()) arr[k] = value()
                for (let i = 0; i < r >> 1; i++) arr.push(value())
                return arr
            }
            case 0x0a: {
                const r = u29()
                if (!(r & 1)) return objects[r >> 1]
                let tr
                if (!(r & 2)) tr = traits[r >> 2]
                else {
                    tr = { name: str(), dynamic: !!(r & 8), external: !!(r & 4), keys: [] }
                    for (let i = 0; i < r >> 4; i++) tr.keys.push(str())
                    traits.push(tr)
                }
                const obj = {}
                objects.push(obj)
                if (tr.external) throw new Error(`external AMF3 class ${tr.name}`)
                for (const k of tr.keys) obj[k] = value()
                if (tr.dynamic) for (let k = str(); k !== ""; k = str()) obj[k] = value()
                return obj
            }
            case 0x0c: { const r = u29(); if (!(r & 1)) return objects[r >> 1]; const b = buf.subarray(p, p + (r >> 1)); p += r >> 1; objects.push(b); return b }
            case 0x0d: case 0x0e: case 0x0f: case 0x10: {
                const r = u29()
                if (!(r & 1)) return objects[r >> 1]
                const n = r >> 1
                p++ // fixed flag
                const out = []
                objects.push(out)
                if (t === 0x10) str()
                for (let i = 0; i < n; i++) {
                    if (t === 0x0d) { out.push(buf.readInt32BE(p)); p += 4 }
                    else if (t === 0x0e) { out.push(buf.readUInt32BE(p)); p += 4 }
                    else if (t === 0x0f) { out.push(buf.readDoubleBE(p)); p += 8 }
                    else out.push(value())
                }
                return out
            }
            case 0x11: {
                const r = u29()
                if (!(r & 1)) return objects[r >> 1]
                p++
                const m = new Map()
                objects.push(m)
                for (let i = 0; i < r >> 1; i++) m.set(value(), value())
                return m
            }
            default: throw new Error(`AMF3 type 0x${t.toString(16)} at ${p - 1}`)
        }
    }
    return value()
}

module.exports = { readAmf3 }
