// Prints Haxe enums with each constructor's index (found as: pushstring <name>, push <index> in the
// constructor function or the class initializer) and parameter types.
const { swfBody, tags, parseAbc } = require("./abc.cjs")
const [file, pattern] = process.argv.slice(2)
const re = new RegExp(pattern)
function indexOf(code, strIndex) {
    for (let p = 0; p < code.length - 3; p++) {
        if (code[p] !== 0x2c) continue
        let q = p + 1, v = 0, s = 0
        for (;;) { const x = code[q++]; v |= (x & 0x7f) << s; if (!(x & 0x80)) break; s += 7 }
        if (v !== strIndex) continue
        const op = code[q]
        if (op === 0x24) return code[q + 1] << 24 >> 24 // pushbyte
        if (op === 0x25) { let r = 0, t = 0; let z = q + 1; for (;;) { const x = code[z++]; r |= (x & 0x7f) << t; if (!(x & 0x80)) break; t += 7 } return r } // pushshort
        if (op === 0x26 || op === 0x27) return op === 0x26 ? 1 : 0
    }
    return null
}
for (const tag of tags(swfBody(file))) {
    if (tag.code !== 82 && tag.code !== 72) continue
    let data = tag.data
    if (tag.code === 82) data = data.subarray(data.indexOf(0, 4) + 1)
    const abc = parseAbc(data)
    for (const inst of abc.instances) {
        if (!re.test(inst.name) || !inst.ctraits.some(t => t.name === "__isenum")) continue
        const rows = []
        const cinit = abc.bodies.get(inst.cinit)
        for (const t of inst.ctraits) {
            if (t.name.startsWith("__")) continue
            const si = abc.strings.indexOf(t.name)
            let idx = null, sig = ""
            if (t.kind === 1) { const m = abc.methods[t.method]; sig = `(${m.params.join(", ")})`; const b = abc.bodies.get(t.method); if (b) idx = indexOf(b, si) }
            if (idx === null && cinit) idx = indexOf(cinit, si)
            rows.push([idx, t.name + sig])
        }
        rows.sort((a, b) => (a[0] ?? 99) - (b[0] ?? 99))
        console.log(`${inst.name}: ` + rows.map(([i, n]) => `${i}=${n}`).join("  "))
    }
}
