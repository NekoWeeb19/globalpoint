// Lists the Chinese text in the CN client's code (SWF string constants): each string, how many times
// code pushes it (pushstring), and whether it is also used as a name (class/property/namespace), which
// must never be changed. Used to translate the client's built-in UI text (patch_cn_text.cjs).
//
//   node cn_swf_strings.cjs <in.swf> <out.json>
const fs = require("fs")
const A = require("./abc.cjs")

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/
const KANA = /[\u3040-\u30fa\u30fc-\u30ff]/

function scan(file) {
    const swf = A.readSwf(file)
    const out = []
    swf.tags.forEach((tag, tagIndex) => {
        if (tag.code !== 82) return
        const abc = A.parseAbc(A.splitDoAbc(tag.data).abc)
        const pushes = new Map(), names = new Set()
        for (const m of abc.multinames) if (m && m.name !== undefined) names.add(m.name)
        for (const n of abc.namespaces) if (n) names.add(n.name)
        for (const body of abc.bodies) for (const op of A.decode(body.code))
            if (op.name === "pushstring") pushes.set(op.args[0], (pushes.get(op.args[0]) ?? 0) + 1)
        abc.strings.forEach((s, i) => {
            if (s && HAN.test(s)) out.push({ tag: tagIndex, i, s, pushes: pushes.get(i) ?? 0, name: names.has(i), kana: KANA.test(s) })
        })
    })
    return out
}

if (require.main === module) {
    const [input, output] = process.argv.slice(2)
    const list = scan(input)
    fs.writeFileSync(output, JSON.stringify(list, null, 1))
    const zh = list.filter(x => !x.kana && !x.name && x.pushes > 0)
    console.log(`${list.length} strings with Han; ${zh.length} Chinese pushed-only (no kana, not names); ${list.filter(x => x.name).length} used as names`)
}

module.exports = { scan, HAN, KANA }
