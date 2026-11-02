// Read, patch and write the game client's ActionScript bytecode (ABC) inside its SWF.
//
// Only what patching needs: the constant pool is fully parsed (new constants are appended, so every
// existing index stays valid), method/class/script tables are kept as raw bytes (they don't change),
// and method bodies are decoded into instructions so code can be inserted with branches fixed up.

const fs = require("fs")
const zlib = require("zlib")

// ---------- SWF ----------

function readSwf(file) {
    const raw = fs.readFileSync(file)
    const sig = raw.toString("latin1", 0, 3)
    const version = raw[3]
    let body
    if (sig === "FWS") body = raw.subarray(8)
    else if (sig === "CWS") body = zlib.inflateSync(raw.subarray(8))
    else throw new Error("unsupported SWF signature " + sig)
    const nbits = body[0] >> 3
    const headerLen = Math.ceil((5 + nbits * 4) / 8) + 4
    const tags = []
    let pos = headerLen
    while (pos < body.length) {
        const h = body.readUInt16LE(pos); pos += 2
        const code = h >> 6
        let len = h & 0x3f
        if (len === 0x3f) { len = body.readUInt32LE(pos); pos += 4 }
        tags.push({ code, data: body.subarray(pos, pos + len) })
        pos += len
        if (code === 0) break
    }
    return { version, header: body.subarray(0, headerLen), tags }
}

function writeSwf(file, swf, compress = true) {
    const parts = [swf.header]
    for (const t of swf.tags) {
        const long = t.data.length >= 0x3f || [6, 21, 35, 36, 20, 90].includes(t.code)
        const h = Buffer.alloc(long ? 6 : 2)
        h.writeUInt16LE((t.code << 6) | (long ? 0x3f : t.data.length), 0)
        if (long) h.writeUInt32LE(t.data.length, 2)
        parts.push(h, t.data)
    }
    const body = Buffer.concat(parts)
    const head = Buffer.alloc(8)
    head.write(compress ? "CWS" : "FWS", 0, "latin1"); head[3] = swf.version; head.writeUInt32LE(body.length + 8, 4)
    fs.writeFileSync(file, Buffer.concat([head, compress ? zlib.deflateSync(body, { level: 9 }) : body]))
}

/** DoABC (82) tag -> { flags, name, abc } */
function splitDoAbc(data) {
    const flags = data.readUInt32LE(0)
    const end = data.indexOf(0, 4)
    return { flags, name: data.toString("utf8", 4, end), abc: data.subarray(end + 1) }
}
function joinDoAbc({ flags, name }, abc) {
    const head = Buffer.alloc(4); head.writeUInt32LE(flags, 0)
    return Buffer.concat([head, Buffer.from(name + "\0", "utf8"), abc])
}

// ---------- byte reading/writing ----------

class Reader {
    constructor(b) { this.b = b; this.p = 0 }
    u8() { return this.b[this.p++] }
    u16() { const v = this.b.readUInt16LE(this.p); this.p += 2; return v }
    u30() { let r = 0, s = 0; for (;;) { const x = this.b[this.p++]; r += (x & 0x7f) * 2 ** s; if (!(x & 0x80) || s >= 28) break; s += 7 } return r >>> 0 }
    s32() { return this.u30() | 0 }
    s24() { const v = this.b[this.p] | (this.b[this.p + 1] << 8) | (this.b[this.p + 2] << 16); this.p += 3; return (v << 8) >> 8 }
    bytes(n) { const v = this.b.subarray(this.p, this.p + n); this.p += n; return v }
}

class Writer {
    constructor() { this.parts = []; this.cur = []; this.len = 0 }
    u8(v) { this.cur.push(v & 0xff); this.len++ }
    u16(v) { this.u8(v); this.u8(v >> 8) }
    u30(v) { v = v >>> 0; do { let b = v & 0x7f; v = Math.floor(v / 128); if (v) b |= 0x80; this.u8(b) } while (v) }
    s32(v) { this.u30(v >>> 0) }
    s24(v) { this.u8(v); this.u8(v >> 8); this.u8(v >> 16) }
    bytes(buf) { this.flush(); this.parts.push(Buffer.from(buf)); this.len += buf.length }
    flush() { if (this.cur.length) { this.parts.push(Buffer.from(this.cur)); this.cur = [] } }
    done() { this.flush(); return Buffer.concat(this.parts) }
}

// ---------- instructions ----------

// operand kinds: u30, u8, s24 (branch), u30x2, sw (lookupswitch), dbg (debug)
const OPS = {}
const def = (code, name, args = []) => { OPS[code] = { name, args }; OPS[name] = { code, args } }
;[[0x01, "bkpt"], [0x02, "nop"], [0x03, "throw"], [0x07, "dxnslate"], [0x09, "label"], [0x1c, "pushwith"], [0x1d, "popscope"],
  [0x1e, "nextname"], [0x1f, "hasnext"], [0x20, "pushnull"], [0x21, "pushundefined"], [0x23, "nextvalue"], [0x26, "pushtrue"],
  [0x27, "pushfalse"], [0x28, "pushnan"], [0x29, "pop"], [0x2a, "dup"], [0x2b, "swap"], [0x30, "pushscope"], [0x47, "returnvoid"],
  [0x48, "returnvalue"], [0x57, "newactivation"], [0x64, "getglobalscope"], [0x70, "convert_s"], [0x71, "esc_xelem"],
  [0x72, "esc_xattr"], [0x73, "convert_i"], [0x74, "convert_u"], [0x75, "convert_d"], [0x76, "convert_b"], [0x77, "convert_o"],
  [0x78, "checkfilter"], [0x81, "coerce_b"], [0x82, "coerce_a"], [0x83, "coerce_i"], [0x84, "coerce_d"], [0x85, "coerce_s"],
  [0x87, "astypelate"], [0x88, "coerce_u"], [0x89, "coerce_o"], [0x90, "negate"], [0x91, "increment"], [0x93, "decrement"],
  [0x95, "typeof"], [0x96, "not"], [0x97, "bitnot"], [0xa0, "add"], [0xa1, "subtract"], [0xa2, "multiply"], [0xa3, "divide"],
  [0xa4, "modulo"], [0xa5, "lshift"], [0xa6, "rshift"], [0xa7, "urshift"], [0xa8, "bitand"], [0xa9, "bitor"], [0xaa, "bitxor"],
  [0xab, "equals"], [0xac, "strictequals"], [0xad, "lessthan"], [0xae, "lessequals"], [0xaf, "greaterthan"],
  [0xb0, "greaterequals"], [0xb1, "instanceof"], [0xb3, "istypelate"], [0xb4, "in"], [0xc0, "increment_i"], [0xc1, "decrement_i"],
  [0xc4, "negate_i"], [0xc5, "add_i"], [0xc6, "subtract_i"], [0xc7, "multiply_i"], [0xd0, "getlocal0"], [0xd1, "getlocal1"],
  [0xd2, "getlocal2"], [0xd3, "getlocal3"], [0xd4, "setlocal0"], [0xd5, "setlocal1"], [0xd6, "setlocal2"], [0xd7, "setlocal3"],
  [0xf3, "timestamp"], [0x35, "li8"], [0x36, "li16"], [0x37, "li32"], [0x38, "lf32"], [0x39, "lf64"], [0x3a, "si8"],
  [0x3b, "si16"], [0x3c, "si32"], [0x3d, "sf32"], [0x3e, "sf64"], [0x50, "sxi1"], [0x51, "sxi8"], [0x52, "sxi16"]
].forEach(([c, n]) => def(c, n))
;[[0x04, "getsuper"], [0x05, "setsuper"], [0x06, "dxns"], [0x08, "kill"], [0x25, "pushshort"], [0x2c, "pushstring"],
  [0x2d, "pushint"], [0x2e, "pushuint"], [0x2f, "pushdouble"], [0x31, "pushnamespace"], [0x40, "newfunction"], [0x41, "call"],
  [0x42, "construct"], [0x49, "constructsuper"], [0x53, "applytype"], [0x55, "newobject"], [0x56, "newarray"], [0x58, "newclass"],
  [0x59, "getdescendants"], [0x5a, "newcatch"], [0x5d, "findpropstrict"], [0x5e, "findproperty"], [0x5f, "finddef"],
  [0x60, "getlex"], [0x61, "setproperty"], [0x62, "getlocal"], [0x63, "setlocal"], [0x66, "getproperty"], [0x67, "getouterscope"],
  [0x68, "initproperty"], [0x6a, "deleteproperty"], [0x6c, "getslot"], [0x6d, "setslot"], [0x6e, "getglobalslot"],
  [0x6f, "setglobalslot"], [0x80, "coerce"], [0x86, "astype"], [0x92, "inclocal"], [0x94, "declocal"], [0xb2, "istype"],
  [0xc2, "inclocal_i"], [0xc3, "declocal_i"], [0xf0, "debugline"], [0xf1, "debugfile"], [0xf2, "bkptline"]
].forEach(([c, n]) => def(c, n, ["u30"]))
;[[0x24, "pushbyte"], [0x65, "getscopeobject"]].forEach(([c, n]) => def(c, n, ["u8"]))
;[[0x32, "hasnext2"], [0x43, "callmethod"], [0x44, "callstatic"], [0x45, "callsuper"], [0x46, "callproperty"],
  [0x4a, "constructprop"], [0x4c, "callproplex"], [0x4e, "callsupervoid"], [0x4f, "callpropvoid"]
].forEach(([c, n]) => def(c, n, ["u30", "u30"]))
;[[0x0c, "ifnlt"], [0x0d, "ifnle"], [0x0e, "ifngt"], [0x0f, "ifnge"], [0x10, "jump"], [0x11, "iftrue"], [0x12, "iffalse"],
  [0x13, "ifeq"], [0x14, "ifne"], [0x15, "iflt"], [0x16, "ifle"], [0x17, "ifgt"], [0x18, "ifge"], [0x19, "ifstricteq"],
  [0x1a, "ifstrictne"]
].forEach(([c, n]) => def(c, n, ["s24"]))
def(0x1b, "lookupswitch", ["sw"])
def(0xef, "debug", ["dbg"])

/** code bytes -> [{ op, name, args, offset, size, targets? }] ; branch targets as byte offsets */
function decode(code) {
    const r = new Reader(code)
    const out = []
    while (r.p < code.length) {
        const offset = r.p
        const op = r.u8()
        const info = OPS[op]
        if (!info) throw new Error(`unknown opcode 0x${op.toString(16)} at ${offset}`)
        const ins = { op, name: info.name, args: [], offset }
        for (const a of info.args) {
            if (a === "u30") ins.args.push(r.u30())
            else if (a === "u8") ins.args.push(r.u8())
            else if (a === "s24") { const d = r.s24(); ins.targets = [r.p + d] }
            else if (a === "sw") {
                const def0 = r.s24(); const n = r.u30(); const cases = []
                for (let i = 0; i <= n; i++) cases.push(r.s24())
                ins.targets = [offset + def0, ...cases.map(c => offset + c)]
            } else if (a === "dbg") ins.args.push(r.u8(), r.u30(), r.u8(), r.u30())
        }
        ins.size = r.p - offset
        out.push(ins)
    }
    return out
}

/** Make an instruction: ins("getlex", mn) / ins("iffalse", labelObject) / { label } markers */
function ins(name, ...args) {
    const info = OPS[name]
    if (!info || info.code === undefined) throw new Error("unknown instruction " + name)
    const i = { op: info.code, name, args: [] }
    if (info.args[0] === "s24") i.targetLabels = [args[0]]
    else i.args = args
    return i
}

/** Encode a list of instructions; branches use targetLabels (label objects) resolved via labelOffset. */
function encode(list) {
    // sizes are fixed per instruction (s24 branches), so two passes are enough
    const sizeOf = i => {
        const w = new Writer(); w.u8(i.op)
        const info = OPS[i.op]
        let argi = 0
        for (const a of info.args) {
            if (a === "u30") w.u30(i.args[argi++])
            else if (a === "u8") w.u8(i.args[argi++])
            else if (a === "s24") w.s24(0)
            else if (a === "sw") { w.s24(0); w.u30(i.targetLabels.length - 2); for (let k = 1; k < i.targetLabels.length; k++) w.s24(0) }
            else if (a === "dbg") { w.u8(i.args[0]); w.u30(i.args[1]); w.u8(i.args[2]); w.u30(i.args[3]) }
        }
        return w.done().length
    }
    let pos = 0
    for (const i of list) { i.newOffset = pos; if (i.label) continue; i.newSize = sizeOf(i); pos += i.newSize }
    const labelPos = l => { if (l.newOffset === undefined) throw new Error("branch to a label not in the code"); return l.newOffset }
    const w = new Writer()
    for (const i of list) {
        if (i.label) continue
        w.u8(i.op)
        const info = OPS[i.op]
        let argi = 0
        for (const a of info.args) {
            if (a === "u30") w.u30(i.args[argi++])
            else if (a === "u8") w.u8(i.args[argi++])
            else if (a === "s24") w.s24(labelPos(i.targetLabels[0]) - (i.newOffset + i.newSize))
            else if (a === "sw") {
                w.s24(labelPos(i.targetLabels[0]) - i.newOffset)
                w.u30(i.targetLabels.length - 2)
                for (let k = 1; k < i.targetLabels.length; k++) w.s24(labelPos(i.targetLabels[k]) - i.newOffset)
            } else if (a === "dbg") { w.u8(i.args[0]); w.u30(i.args[1]); w.u8(i.args[2]); w.u30(i.args[3]) }
        }
    }
    return { code: w.done(), length: pos }
}

// ---------- ABC ----------

function parseAbc(buf) {
    const r = new Reader(buf)
    const abc = { minor: r.u16(), major: r.u16() }
    let c = r.u30(); abc.ints = [0]; for (let i = 1; i < c; i++) abc.ints.push(r.s32())
    c = r.u30(); abc.uints = [0]; for (let i = 1; i < c; i++) abc.uints.push(r.u30())
    c = r.u30(); abc.doubles = [null]; for (let i = 1; i < c; i++) abc.doubles.push(r.bytes(8))
    c = r.u30(); abc.strings = [null]; for (let i = 1; i < c; i++) { const n = r.u30(); abc.strings.push(r.bytes(n).toString("utf8")) }
    c = r.u30(); abc.namespaces = [null]; for (let i = 1; i < c; i++) abc.namespaces.push({ kind: r.u8(), name: r.u30() })
    c = r.u30(); abc.nssets = [null]; for (let i = 1; i < c; i++) { const k = r.u30(); const s = []; for (let j = 0; j < k; j++) s.push(r.u30()); abc.nssets.push(s) }
    c = r.u30(); abc.multinames = [null]
    for (let i = 1; i < c; i++) {
        const kind = r.u8(); const m = { kind }
        if (kind === 0x07 || kind === 0x0d) { m.ns = r.u30(); m.name = r.u30() }
        else if (kind === 0x0f || kind === 0x10) m.name = r.u30()
        else if (kind === 0x11 || kind === 0x12) { }
        else if (kind === 0x09 || kind === 0x0e) { m.name = r.u30(); m.nsset = r.u30() }
        else if (kind === 0x1b || kind === 0x1c) m.nsset = r.u30()
        else if (kind === 0x1d) { m.type = r.u30(); const k = r.u30(); m.params = []; for (let j = 0; j < k; j++) m.params.push(r.u30()) }
        else throw new Error("multiname kind " + kind)
        abc.multinames.push(m)
    }
    // method infos (kept raw, but parsed for names/param counts)
    const middleStart = r.p
    c = r.u30(); abc.methodInfos = []
    for (let i = 0; i < c; i++) {
        const pc = r.u30(); const ret = r.u30(); const params = []; for (let j = 0; j < pc; j++) params.push(r.u30())
        const name = r.u30(); const flags = r.u8()
        if (flags & 0x08) { const oc = r.u30(); for (let j = 0; j < oc; j++) { r.u30(); r.u8() } }
        if (flags & 0x80) for (let j = 0; j < pc; j++) r.u30()
        abc.methodInfos.push({ params, ret, name, flags })
    }
    c = r.u30(); for (let i = 0; i < c; i++) { r.u30(); const k = r.u30(); for (let j = 0; j < k; j++) { r.u30(); r.u30() } }
    const traits = () => {
        const out = []; const k = r.u30()
        for (let j = 0; j < k; j++) {
            const t = { name: r.u30() }; const kb = r.u8(); t.kind = kb & 0x0f
            if (t.kind === 0 || t.kind === 6) { t.slot = r.u30(); t.type = r.u30(); const vi = r.u30(); if (vi) r.u8() }
            else if (t.kind === 1 || t.kind === 2 || t.kind === 3) { r.u30(); t.method = r.u30() }
            else if (t.kind === 4 || t.kind === 5) { t.slot = r.u30(); t.index = r.u30() }
            if (kb & 0x40) { const mc = r.u30(); for (let x = 0; x < mc; x++) r.u30() }
            out.push(t)
        }
        return out
    }
    c = r.u30(); abc.instances = []
    for (let i = 0; i < c; i++) {
        const inst = { name: r.u30(), super: r.u30() }; const flags = r.u8()
        if (flags & 0x08) r.u30()
        const ic = r.u30(); for (let j = 0; j < ic; j++) r.u30()
        inst.iinit = r.u30(); inst.traits = traits(); abc.instances.push(inst)
    }
    abc.classes = []; for (let i = 0; i < c; i++) abc.classes.push({ cinit: r.u30(), traits: traits() })
    c = r.u30(); abc.scripts = []; for (let i = 0; i < c; i++) abc.scripts.push({ init: r.u30(), traits: traits() })
    abc.middle = buf.subarray(middleStart, r.p)
    c = r.u30(); abc.bodies = []
    for (let i = 0; i < c; i++) {
        const b = { method: r.u30(), maxStack: r.u30(), localCount: r.u30(), initScope: r.u30(), maxScope: r.u30() }
        const len = r.u30(); b.code = r.bytes(len)
        const ec = r.u30(); b.exceptions = []
        for (let j = 0; j < ec; j++) b.exceptions.push({ from: r.u30(), to: r.u30(), target: r.u30(), type: r.u30(), varName: r.u30() })
        const traitsStart = r.p; traits(); b.traitsRaw = buf.subarray(traitsStart, r.p)
        abc.bodies.push(b)
    }
    abc.bodyOf = new Map(abc.bodies.map(b => [b.method, b]))
    return abc
}

function writeAbc(abc) {
    const w = new Writer()
    w.u16(abc.minor); w.u16(abc.major)
    const pool = (arr, f) => { w.u30(arr.length <= 1 ? 0 : arr.length); for (let i = 1; i < arr.length; i++) f(arr[i]) }
    pool(abc.ints, v => w.s32(v))
    pool(abc.uints, v => w.u30(v))
    pool(abc.doubles, v => w.bytes(v))
    pool(abc.strings, s => { const b = Buffer.from(s, "utf8"); w.u30(b.length); w.bytes(b) })
    pool(abc.namespaces, n => { w.u8(n.kind); w.u30(n.name) })
    pool(abc.nssets, s => { w.u30(s.length); s.forEach(x => w.u30(x)) })
    pool(abc.multinames, m => {
        w.u8(m.kind)
        if (m.kind === 0x07 || m.kind === 0x0d) { w.u30(m.ns); w.u30(m.name) }
        else if (m.kind === 0x0f || m.kind === 0x10) w.u30(m.name)
        else if (m.kind === 0x09 || m.kind === 0x0e) { w.u30(m.name); w.u30(m.nsset) }
        else if (m.kind === 0x1b || m.kind === 0x1c) w.u30(m.nsset)
        else if (m.kind === 0x1d) { w.u30(m.type); w.u30(m.params.length); m.params.forEach(p => w.u30(p)) }
    })
    w.bytes(abc.middle)
    w.u30(abc.bodies.length)
    for (const b of abc.bodies) {
        w.u30(b.method); w.u30(b.maxStack); w.u30(b.localCount); w.u30(b.initScope); w.u30(b.maxScope)
        w.u30(b.code.length); w.bytes(b.code)
        w.u30(b.exceptions.length)
        for (const e of b.exceptions) { w.u30(e.from); w.u30(e.to); w.u30(e.target); w.u30(e.type); w.u30(e.varName) }
        w.bytes(b.traitsRaw)
    }
    return w.done()
}

// ---------- constant pool helpers (append if missing) ----------

function str(abc, s) { let i = abc.strings.indexOf(s); if (i < 1) { i = abc.strings.length; abc.strings.push(s) } return i }
function ns(abc, kind, name) {
    const n = str(abc, name)
    let i = abc.namespaces.findIndex((x, k) => k > 0 && x.kind === kind && x.name === n)
    if (i < 1) { i = abc.namespaces.length; abc.namespaces.push({ kind, name: n }) }
    return i
}
/** QName(PackageNamespace(pkg), name) */
function qname(abc, pkg, name) {
    const nsi = ns(abc, 0x16, pkg), ni = str(abc, name)
    let i = abc.multinames.findIndex((m, k) => k > 0 && m.kind === 0x07 && m.ns === nsi && m.name === ni)
    if (i < 1) { i = abc.multinames.length; abc.multinames.push({ kind: 0x07, ns: nsi, name: ni }) }
    return i
}
function intConst(abc, v) { let i = abc.ints.indexOf(v, 1); if (i < 1) { i = abc.ints.length; abc.ints.push(v) } return i }

// ---------- naming ----------

function nsName(abc, i) { const n = abc.namespaces[i]; return n ? abc.strings[n.name] ?? "" : "" }
function mnName(abc, i) {
    const m = abc.multinames[i]
    if (!m) return "*"
    if (m.kind === 0x07 || m.kind === 0x0d) { const p = nsName(abc, m.ns); return p ? `${p}.${abc.strings[m.name]}` : abc.strings[m.name] }
    if (m.name !== undefined) return abc.strings[m.name] ?? "*"
    if (m.kind === 0x1d) return `${mnName(abc, m.type)}<${m.params.map(p => mnName(abc, p)).join(",")}>`
    return "?"
}
function shortName(abc, i) { const m = abc.multinames[i]; return m && m.name !== undefined ? abc.strings[m.name] : mnName(abc, i) }

/** Find a class by full name ("pkg.path.int") -> its index */
function findClass(abc, full) {
    const i = abc.instances.findIndex(inst => mnName(abc, inst.name) === full)
    if (i < 0) throw new Error("class not found: " + full)
    return i
}
/** Method index of an instance (or static, with isStatic) method by name */
function findMethod(abc, classIndex, name, isStatic = false) {
    const traits = isStatic ? abc.classes[classIndex].traits : abc.instances[classIndex].traits
    const hits = traits.filter(t => (t.kind === 1 || t.kind === 2 || t.kind === 3) && shortName(abc, t.name) === name)
    if (hits.length !== 1) throw new Error(`method ${name}: ${hits.length} matches`)
    return hits[0].method
}

/** Readable listing of a body's code (for finding patch points) */
function listing(abc, body) {
    return decode(body.code).map(i => {
        let a = ""
        if (["getlex", "getproperty", "setproperty", "initproperty", "findpropstrict", "findproperty", "coerce", "astype", "istype", "getsuper", "setsuper", "deleteproperty", "getdescendants", "finddef"].includes(i.name)) a = mnName(abc, i.args[0])
        else if (["callproperty", "callpropvoid", "callproplex", "constructprop", "callsuper", "callsupervoid"].includes(i.name)) a = `${mnName(abc, i.args[0])}, ${i.args[1]}`
        else if (i.name === "pushstring") a = JSON.stringify(abc.strings[i.args[0]])
        else if (i.name === "pushint") a = String(abc.ints[i.args[0]])
        else if (i.targets) a = i.targets.map(t => "@" + t).join(" ")
        else a = i.args.join(" ")
        return `${String(i.offset).padStart(5)}  ${i.name} ${a}`
    }).join("\n")
}

/**
 * Patch a method body. edit(list, helpers) gets the decoded instructions (branches converted to label
 * references) and returns the new list. Labels are the instruction objects themselves.
 */
function patchBody(abc, methodIndex, edit, { extraStack = 8, extraLocals = 0 } = {}) {
    const body = abc.bodyOf.get(methodIndex)
    if (!body) throw new Error("no body for method " + methodIndex)
    const list = decode(body.code)
    const end = { label: true, offset: body.code.length } // end-of-code marker for exceptions
    const byOffset = new Map(list.map(i => [i.offset, i]))
    byOffset.set(body.code.length, end)
    const at = off => { const t = byOffset.get(off); if (!t) throw new Error("branch into the middle of an instruction at " + off); return t }
    for (const i of list) if (i.targets) i.targetLabels = i.targets.map(at)
    const excs = body.exceptions.map(e => ({ ...e, fromI: at(e.from), toI: at(e.to), targetI: at(e.target) }))
    const edited = edit(list)
    const full = [...edited, end]
    const { code } = encode(full)
    body.code = code
    body.exceptions = excs.map(e => ({ ...e, from: e.fromI.newOffset, to: e.toI.newOffset, target: e.targetI.newOffset }))
    body.maxStack += extraStack
    body.localCount += extraLocals
    return body
}

/** Insert instructions before `target`; branches that pointed at target now point at the new code. */
function insertBefore(list, target, newIns) {
    const k = list.indexOf(target)
    if (k < 0) throw new Error("insert point not found")
    for (const i of list) if (i.targetLabels) i.targetLabels = i.targetLabels.map(l => (l === target ? newIns[0] : l))
    list.splice(k, 0, ...newIns)
    return list
}
function insertAfter(list, target, newIns) {
    const k = list.indexOf(target)
    if (k < 0) throw new Error("insert point not found")
    list.splice(k + 1, 0, ...newIns)
    return list
}

module.exports = {
    readSwf, writeSwf, splitDoAbc, joinDoAbc, parseAbc, writeAbc, decode, encode, ins,
    str, ns, qname, intConst, mnName, shortName, nsName, findClass, findMethod, listing, patchBody, insertBefore, insertAfter
}
