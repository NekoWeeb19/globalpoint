// Minimal reader for the ActionScript bytecode (ABC) inside a SWF: classes, their traits and method
// signatures, and the strings a class initializer pushes into __constructs__ (Haxe enum constructor
// names, in index order). Read-only analysis of the game client.
//   node abc.cjs <file.swf> <class name regex>
const fs = require("fs")
const zlib = require("zlib")

function swfBody(file) {
    const raw = fs.readFileSync(file)
    const sig = raw.toString("latin1", 0, 3)
    if (sig === "FWS") return raw.subarray(8)
    if (sig === "CWS") return zlib.inflateSync(raw.subarray(8))
    throw new Error("unsupported SWF signature " + sig)
}

function* tags(body) {
    const nbits = body[0] >> 3
    let pos = Math.ceil((5 + nbits * 4) / 8) + 4 // RECT + frame rate + frame count
    while (pos < body.length) {
        const header = body.readUInt16LE(pos); pos += 2
        const code = header >> 6
        let len = header & 0x3f
        if (len === 0x3f) { len = body.readUInt32LE(pos); pos += 4 }
        yield { code, data: body.subarray(pos, pos + len) }
        pos += len
        if (code === 0) break
    }
}

class R {
    constructor(b) { this.b = b; this.p = 0 }
    u8() { return this.b[this.p++] }
    u16() { const v = this.b.readUInt16LE(this.p); this.p += 2; return v }
    u30() { let r = 0, s = 0; for (;;) { const x = this.b[this.p++]; r |= (x & 0x7f) << s; if (!(x & 0x80) || s >= 28) break; s += 7 } return r >>> 0 }
    s32() { return this.u30() | 0 }
    d64() { const v = this.b.readDoubleLE(this.p); this.p += 8; return v }
    str() { const n = this.u30(); const s = this.b.toString("utf8", this.p, this.p + n); this.p += n; return s }
}

function parseAbc(buf) {
    const r = new R(buf)
    r.u16(); r.u16()
    const n = () => r.u30()
    let c = n(); for (let i = 1; i < c; i++) r.s32()
    c = n(); for (let i = 1; i < c; i++) r.u30()
    c = n(); for (let i = 1; i < c; i++) r.d64()
    c = n(); const strings = [""]; for (let i = 1; i < c; i++) strings.push(r.str())
    c = n(); const ns = [{ name: "" }]; for (let i = 1; i < c; i++) { const kind = r.u8(); ns.push({ kind, name: strings[r.u30()] }) }
    c = n(); for (let i = 1; i < c; i++) { const k = r.u30(); for (let j = 0; j < k; j++) r.u30() }
    c = n(); const mn = [{ name: "*" }]
    for (let i = 1; i < c; i++) {
        const kind = r.u8()
        if (kind === 0x07 || kind === 0x0d) { const nsi = r.u30(); mn.push({ ns: ns[nsi]?.name, name: strings[r.u30()] }) }
        else if (kind === 0x0f || kind === 0x10) mn.push({ name: strings[r.u30()] })
        else if (kind === 0x11 || kind === 0x12) mn.push({ name: "?" })
        else if (kind === 0x09 || kind === 0x0e) { const name = strings[r.u30()]; r.u30(); mn.push({ name }) }
        else if (kind === 0x1b || kind === 0x1c) { r.u30(); mn.push({ name: "?" }) }
        else if (kind === 0x1d) { const q = r.u30(); const pc = r.u30(); const ps = []; for (let j = 0; j < pc; j++) ps.push(r.u30()); mn.push({ typeName: q, params: ps }) }
        else throw new Error("multiname kind " + kind)
    }
    const mname = i => { const m = mn[i]; if (!m) return "?"; if (m.typeName !== undefined) return `${mname(m.typeName)}<${m.params.map(mname).join(",")}>`; return m.name }
    c = n(); const methods = []
    for (let i = 0; i < c; i++) {
        const pc = r.u30(); const ret = r.u30(); const params = []; for (let j = 0; j < pc; j++) params.push(r.u30())
        const name = strings[r.u30()]; const flags = r.u8()
        if (flags & 0x08) { const oc = r.u30(); for (let j = 0; j < oc; j++) { r.u30(); r.u8() } }
        let names = null
        if (flags & 0x80) { names = []; for (let j = 0; j < pc; j++) names.push(strings[r.u30()]) }
        methods.push({ params: params.map(mname), ret: mname(ret), names, name })
    }
    c = n(); for (let i = 0; i < c; i++) { r.u30(); const k = r.u30(); for (let j = 0; j < k; j++) { r.u30(); r.u30() } }
    const traits = () => {
        const out = []; const k = r.u30()
        for (let j = 0; j < k; j++) {
            const name = mname(r.u30()); const kb = r.u8(); const kind = kb & 0x0f; const t = { name, kind }
            if (kind === 0 || kind === 6) { r.u30(); t.type = mname(r.u30()); const vi = r.u30(); if (vi) r.u8() }
            else if (kind === 1 || kind === 2 || kind === 3) { r.u30(); t.method = r.u30() }
            else if (kind === 4 || kind === 5) { r.u30(); r.u30() }
            if (kb & 0x40) { const mc = r.u30(); for (let x = 0; x < mc; x++) r.u30() }
            out.push(t)
        }
        return out
    }
    c = n(); const instances = []
    for (let i = 0; i < c; i++) {
        const name = mname(r.u30()); const sup = mname(r.u30()); const flags = r.u8()
        if (flags & 0x08) r.u30()
        const ic = r.u30(); for (let j = 0; j < ic; j++) r.u30()
        const iinit = r.u30(); instances.push({ name, sup, iinit, itraits: traits() })
    }
    for (let i = 0; i < c; i++) { instances[i].cinit = r.u30(); instances[i].ctraits = traits() }
    c = n(); for (let i = 0; i < c; i++) { r.u30(); traits() }
    c = n(); const bodies = new Map()
    for (let i = 0; i < c; i++) {
        const m = r.u30(); r.u30(); r.u30(); r.u30(); r.u30()
        const len = r.u30(); const code = buf.subarray(r.p, r.p + len); r.p += len
        const ec = r.u30(); for (let j = 0; j < ec; j++) { r.u30(); r.u30(); r.u30(); r.u30(); r.u30() }
        traits(); bodies.set(m, code)
    }
    return { strings, instances, methods, bodies }
}

/** The strings pushed (pushstring 0x2c) just before a newarray (0x56) in a class initializer. */
function constructsOf(code, strings) {
    const lists = []; let run = []
    const rr = new R(code)
    while (rr.p < code.length) {
        const op = rr.u8()
        if (op === 0x2c) { run.push(strings[rr.u30()]); continue }
        if (op === 0x56) { const k = rr.u30(); if (run.length >= k && k > 0) lists.push(run.slice(-k)); run = []; continue }
        // skip operands of common opcodes; anything else resets the run
        if ([0x24, 0x25, 0x2d, 0x2e, 0x2f, 0x5d, 0x5e, 0x60, 0x61, 0x66, 0x68, 0x62, 0x63, 0x46, 0x4a, 0x4f, 0x80, 0x86, 0xd0 - 0x100].includes(op)) { if (op === 0x46 || op === 0x4a || op === 0x4f) { rr.u30(); rr.u30() } else if (op === 0x24) rr.u8(); else rr.u30() }
        run = run.length && op === 0x2c ? run : (op === 0x2c ? run : run)
    }
    return lists
}

module.exports = { swfBody, tags, parseAbc, constructsOf }

if (require.main === module) {
    const [file, pattern] = process.argv.slice(2)
    const re = new RegExp(pattern ?? "Meeting|Battle.*(Server2Client|Client2Server)|Notify")
    const body = swfBody(file)
    for (const tag of tags(body)) {
        if (tag.code !== 82 && tag.code !== 72) continue
        let data = tag.data
        if (tag.code === 82) { const nameEnd = data.indexOf(0, 4); data = data.subarray(nameEnd + 1) }
        let abc
        try { abc = parseAbc(data) } catch (e) { console.error("ABC parse failed:", e.message); continue }
        for (const inst of abc.instances) {
            if (!re.test(inst.name)) continue
            const lists = abc.bodies.has(inst.cinit) ? constructsOf(abc.bodies.get(inst.cinit), abc.strings) : []
            console.log(`\n=== ${inst.name} (extends ${inst.sup})`)
            if (lists.length) console.log(`  __constructs__: ${JSON.stringify(lists[0])}`)
            for (const t of inst.ctraits) {
                if (t.kind === 1 || t.kind === 2) { const m = abc.methods[t.method]; console.log(`  static ${t.name}(${m.params.map((p, i) => (m.names?.[i] ? m.names[i] + ": " : "") + p).join(", ")}): ${m.ret}`) }
                else if (t.kind === 0 || t.kind === 6) console.log(`  static var ${t.name}: ${t.type}`)
            }
            for (const t of inst.itraits) if (t.kind === 0 || t.kind === 6) console.log(`  var ${t.name}: ${t.type}`)
        }
    }
}
