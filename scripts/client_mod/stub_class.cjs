// Writes a tiny SWF holding one empty AS3 class (package.Class with empty static methods), so FFDec's
// -importScript (which can only replace classes that already exist) can compile real code into it.
//
//   node stub_class.cjs <out.swf> <package> <Class> <staticMethod>...
// e.g. node stub_class.cjs stub.swf starpoint BattleLog log flush

const fs = require("fs")

const [out, pkg, cls, ...methods] = process.argv.slice(2)
if (!cls) throw new Error("usage: stub_class.cjs <out.swf> <package> <Class> <staticMethod>...")

// --- ABC writer (only what this stub needs) ---
const bytes = []
const u8 = v => bytes.push(v & 0xff)
const u16 = v => { u8(v); u8(v >> 8) }
const u30 = v => { do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; u8(b) } while (v) }
const str = s => { const b = Buffer.from(s, "utf8"); u30(b.length); for (const x of b) u8(x) }

const strings = ["", pkg, cls, "Object", ...methods, `${pkg}:${cls}`]
const S = s => strings.indexOf(s)
// namespaces: 1 package(pkg), 2 package(""), 3 protected(pkg:cls)
const namespaces = [[0x16, S(pkg)], [0x16, S("")], [0x18, S(`${pkg}:${cls}`)]]
// multinames: 1 QName(pkg, cls), 2 QName("", Object), then one per method (public, so package "")
const multinames = [[1, S(cls)], [2, S("Object")], ...methods.map(m => [2, S(m)])]
const MN_CLASS = 1, MN_OBJECT = 2, MN_METHOD = i => 3 + i

// method infos: 0 script init, 1 cinit, 2 iinit, 3.. static methods (no params, void)
const methodCount = 3 + methods.length

u16(16); u16(46) // minor, major
u30(0); u30(0); u30(0) // int, uint, double pools (empty)
u30(strings.length); for (let i = 1; i < strings.length; i++) str(strings[i])
u30(namespaces.length + 1); for (const [k, n] of namespaces) { u8(k); u30(n) }
u30(0) // namespace sets
u30(multinames.length + 1); for (const [ns, n] of multinames) { u8(0x07); u30(ns); u30(n) }
u30(methodCount); for (let i = 0; i < methodCount; i++) { u30(0); u30(0); u30(0); u8(0) } // 0 params, any return, no name, no flags
u30(0) // metadata
u30(1) // one class
// instance info
u30(MN_CLASS); u30(MN_OBJECT); u8(0x08 /* protected ns */ | 0x01 /* sealed */); u30(3); u30(0) /* interfaces */; u30(2) /* iinit */; u30(0) /* traits */
// class info: cinit + static method traits
u30(1); u30(methods.length)
methods.forEach((m, i) => { u30(MN_METHOD(i)); u8(0x01 /* method */); u30(0); u30(3 + i) })
// script: init 0, one class trait
u30(1); u30(0); u30(1); u30(MN_CLASS); u8(0x04 /* class */); u30(0); u30(0)
// method bodies
const body = (method, maxStack, localCount, initScope, maxScope, code) => {
    u30(method); u30(maxStack); u30(localCount); u30(initScope); u30(maxScope)
    u30(code.length); for (const b of code) u8(b); u30(0); u30(0)
}
const GETLOCAL0 = 0xd0, PUSHSCOPE = 0x30, RETURNVOID = 0x47, POPSCOPE = 0x1d
// script init: getlocal0 pushscope getscopeobject 0 getlex Object pushscope getlex Object newclass 0 popscope initproperty Class returnvoid
body(0, 2, 1, 1, 3, [GETLOCAL0, PUSHSCOPE, 0x65, 0, 0x60, MN_OBJECT, PUSHSCOPE, 0x60, MN_OBJECT, 0x58, 0, POPSCOPE, 0x68, MN_CLASS, RETURNVOID])
body(1, 1, 1, 3, 4, [GETLOCAL0, PUSHSCOPE, RETURNVOID]) // cinit
body(2, 1, 1, 4, 5, [GETLOCAL0, PUSHSCOPE, GETLOCAL0, 0x49, 0, RETURNVOID]) // iinit: constructsuper 0
methods.forEach((_, i) => body(3 + i, 1, 1, 3, 4, [GETLOCAL0, PUSHSCOPE, RETURNVOID]))
const abc = Buffer.from(bytes)

// --- SWF: FileAttributes(AS3) + DoABC + ShowFrame + End ---
const tag = (code, data) => {
    const head = Buffer.alloc(6)
    head.writeUInt16LE((code << 6) | 0x3f, 0); head.writeUInt32LE(data.length, 2)
    return Buffer.concat([head, data])
}
const doAbc = Buffer.concat([Buffer.from([1, 0, 0, 0]), Buffer.from(`${pkg}.${cls}\0`), abc])
const fileAttrs = Buffer.from([0x08, 0, 0, 0]) // ActionScript 3
const rect = Buffer.from([0x00]) // 0-bit RECT
const body2 = Buffer.concat([rect, Buffer.from([0, 24, 1, 0]), tag(69, fileAttrs), tag(82, doAbc), tag(1, Buffer.alloc(0)), Buffer.from([0, 0])])
const header = Buffer.alloc(8)
header.write("FWS", 0); header[3] = 30; header.writeUInt32LE(8 + body2.length, 4)
fs.writeFileSync(out, Buffer.concat([header, body2]))
console.log(`wrote ${out}: class ${pkg}.${cls} with ${methods.join(", ")}`)
