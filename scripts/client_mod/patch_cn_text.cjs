// Puts English into the text built into the CN app's code: every SWF string constant listed in
// assets/translations/cn_app.json is replaced, but only where the code uses it as text (pushstring),
// never where it is a name (class, property, namespace), which would break the code.
//
//   node patch_cn_text.cjs <in.swf> <out.swf> [translations.json]
const fs = require("fs")
const path = require("path")
const A = require("./abc.cjs")

const [input, output, trFile = path.join(__dirname, "..", "..", "assets", "translations", "cn_app.json")] = process.argv.slice(2)
if (!input || !output) throw new Error("usage: patch_cn_text.cjs <in.swf> <out.swf> [translations.json]")
const tr = JSON.parse(fs.readFileSync(trFile, "utf8")).strings

const swf = A.readSwf(input)
let replaced = 0
const found = new Set()
for (const tag of swf.tags) {
    if (tag.code !== 82) continue
    const doAbc = A.splitDoAbc(tag.data)
    const abc = A.parseAbc(doAbc.abc)
    const names = new Set()
    for (const m of abc.multinames) if (m && m.name !== undefined) names.add(m.name)
    for (const n of abc.namespaces) if (n) names.add(n.name)
    let changed = false
    abc.strings.forEach((s, i) => {
        if (s === null || tr[s] === undefined || names.has(i)) return
        abc.strings[i] = tr[s]
        found.add(s)
        replaced++
        changed = true
    })
    if (changed) tag.data = A.joinDoAbc(doAbc, A.writeAbc(abc))
}
A.writeSwf(output, swf, false) // the CN client ships its SWF uncompressed (FWS)
const missing = Object.keys(tr).filter(s => !found.has(s))
console.log(`wrote ${output}: ${replaced} strings replaced${missing.length ? `; not found: ${missing.length}` : ""}`)
