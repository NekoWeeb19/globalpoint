// RESEARCH (docs/research/ability-triggers.md): reads FFDec p-code of a table parser
// (pinball.master.generated.*Values) and prints, per parseAtN function that returns an enum, the column,
// the enum class and the code -> constructor table: the client's own mapping from a row's code to its kind.
// The decompiled source can't be used for this (the big parsers fail to decompile), p-code always works.
//
//   ffdec-cli -format script:pcode -selectclass pinball.master.generated.AbilityValues -export script <out> <client .swf>
//   node scripts/research/ability_codes_from_pcode.cjs <out>/scripts/pinball/master/generated/AbilityValues.pcode
// Result for the CN 1.8.1 client: docs/research/data/ability_codes.json.
const fs = require("fs")
const file = process.argv[2]
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).map(l => l.trim())
const out = []
for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^trait method QName\(PackageNamespace\(""\),"(parseAt\d+)"\)/)
    if (!m) continue
    let ret = null, col = null, j = i + 1
    for (; j < lines.length && !lines[j].startsWith("trait "); j++) {
        const r = lines[j].match(/^returns QName\(PackageNamespace\("([^"]*)"\),"(\w+)"\)/)
        if (r) ret = r[2]
        if (col === null) { const c = lines[j].match(/^push(?:byte|short|int) (\d+)/); if (c) col = +c[1] }
    }
    const body = lines.slice(i, j)
    const codes = {}
    for (let k = 0; k < body.length; k++) {
        const s = body[k].match(/^pushstring "(-?\d+)"$/)
        if (!s || !/^if(ne|strictne)/.test(body[k + 1] ?? "")) continue
        for (let n = k + 2; n < Math.min(body.length, k + 40); n++) {
            const g = body[n].match(new RegExp(String.raw`^getlex QName\(PackageNamespace\("[^"]*"\),"${ret}"\)`))
            if (!g) continue
            for (let q = n + 1; q < Math.min(body.length, n + 60); q++) {
                const c = body[q].match(/^(?:getproperty|callproperty|callpropvoid|constructprop) QName\(PackageNamespace\(""\),"(\w+)"\)/)
                if (c && !c[1].startsWith("parseAt")) { codes[s[1]] = c[1]; break }
            }
            break
        }
    }
    if (Object.keys(codes).length) out.push({ fn: m[1], col, enum: ret, codes })
}
console.log(JSON.stringify(out, null, 1))
