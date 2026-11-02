// Dumps TypePackerResource2.resolveMap* tables: name -> index pairs (d1 2c <name> 24 <index> 4f ...).
const { swfBody, tags, parseAbc } = require("./abc.cjs")
const [file, ...must] = process.argv.slice(2)
const u30 = (c, p) => { let v = 0, s = 0, q = p; for (;;) { const x = c[q++]; v |= (x & 0x7f) << s; if (!(x & 0x80)) break; s += 7 } return [v, q] }
for (const tag of tags(swfBody(file))) {
    if (tag.code !== 82 && tag.code !== 72) continue
    let data = tag.data
    if (tag.code === 82) data = data.subarray(data.indexOf(0, 4) + 1)
    const abc = parseAbc(data)
    for (const inst of abc.instances) {
        if (inst.name !== "TypePackerResource2") continue
        for (const t of [...inst.ctraits, ...inst.itraits]) {
            if (!/^resolveMap/.test(t.name)) continue
            const code = abc.bodies.get(t.method)
            if (!code) continue
            const pairs = []
            for (let p = 0; p < code.length - 4; p++) {
                if (code[p] !== 0xd1 || code[p + 1] !== 0x2c) continue
                const [si, q] = u30(code, p + 2)
                if (code[q] !== 0x24 || code[q + 2] !== 0x4f) continue
                pairs.push([code[q + 1] << 24 >> 24, abc.strings[si]])
            }
            const names = pairs.map(p => p[1])
            if (must.some(m => names.includes(m))) console.log(`${t.name}: ` + pairs.sort((a, b) => a[0] - b[0]).map(([i, s]) => `${i}=${s}`).join("  "))
        }
    }
}
