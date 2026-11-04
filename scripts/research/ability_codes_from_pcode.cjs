// RESEARCH (docs/research/ability-triggers.md): reads FFDec p-code of the CN client's ability table parsers
// (pinball.master.generated.AbilityValues / LeaderAbilityValues) and writes, for every part of an ability line
// (condition, "when" trigger, "while" trigger, effects, who, targets), each code's kind name and the fields
// (with their columns) that kind reads. This is the client's own mapping; the decompiled source can't be used
// (the big parsers fail to decompile), p-code always works.
//
//   ffdec-cli -format script:pcode -selectclass pinball.master.generated.AbilityValues -export script <out> <client .swf>
//   node scripts/research/ability_codes_from_pcode.cjs <out>/scripts/pinball/master/generated/AbilityValues.pcode [out.json]
// Result for the CN 1.8.1 client: assets/unit_editor/ability_codes.json (columns in the ability table's layout;
// leader rows are the same from column 3 on, two to the left).
const fs = require("fs")
const lines = fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/).map(l => l.trim())

// every parseAtN: its lines, the columns it reads, the functions it calls
const fns = {}
let cur = null
for (const l of lines) {
    const m = l.match(/^trait method QName\(PackageNamespace\(""\),"(parseAt\d+)"\)/)
    if (m) { cur = fns[m[1]] = { body: [], cols: new Set(), calls: new Set(), pair: false, ret: null }; continue }
    if (l.startsWith("trait ")) { cur = null; continue }
    if (!cur) continue
    cur.body.push(l)
    const r = l.match(/^returns QName\(PackageNamespace\("[^"]*"\),"(\w+)"\)/); if (r) cur.ret = r[1]
    const c = l.match(/^push(?:byte|short) (\d+)$/); if (c) cur.cols.add(+c[1])
    const k = l.match(/callproperty QName\(PackageNamespace\(""\),"(parseAt\d+)"\)/); if (k) cur.calls.add(k[1])
    if (l === 'pushstring "power1"') cur.pair = true
}
/** The columns a function reads, its own and its callees' (column 0 is only read for error messages). */
function columns(fn, seen = new Set()) {
    if (seen.has(fn) || !fns[fn]) return []
    seen.add(fn)
    const own = [...fns[fn].cols].filter(c => c !== 0)
    return [...new Set([...own, ...[...fns[fn].calls].flatMap(c => columns(c, seen))])].sort((a, b) => a - b)
}
const isPair = fn => fns[fn]?.pair === true

/** code -> { name, fields: { field: { cols, pair } } } for an enum-returning parser (e.g. parseAt47). */
function codes(fnName) {
    const f = fns[fnName], out = {}
    if (!f) return out
    const b = f.body
    for (let i = 0; i < b.length; i++) {
        const s = b[i].match(/^pushstring "(-?\d+)"$/)
        if (!s || !/^if(ne|strictne)/.test(b[i + 1] ?? "")) continue
        const fields = {}
        let name = null, last = null
        for (let j = i + 2; j < b.length; j++) {
            const l = b[j]
            if (l === "returnvalue" || /^pushstring "(-?\d+)"$/.test(l) && /^if(ne|strictne)/.test(b[j + 1] ?? "")) break
            const p = l.match(/^pushstring "([a-z_0-9]+)"$/); if (p) { last = p[1]; continue }
            const c = l.match(/callproperty QName\(PackageNamespace\(""\),"(parseAt\d+)"\)/)
            if (c) { if (last) fields[last] = { cols: columns(c[1]), pair: isPair(c[1]) }; last = null; continue }
            const n = l.match(/^(?:getproperty|callproperty|constructprop) QName\(PackageNamespace\(""\),"(\w+)"\)/)
            if (n) name = n[1]
        }
        out[s[1]] = { name, fields }
    }
    return out
}

const result = {
    _source: "CN 1.8.1 client (worldflipper_android_release.swf): FFDec p-code of pinball.master.generated.AbilityValues, read by scripts/research/ability_codes_from_pcode.cjs",
    _layout: "columns are the ability table's; leader rows are the same from column 3 on, two to the left (leader column c = ability column c + 2)",
    kind: { column: 5, codes: { 0: "Instant", 1: "During", 2: "Opening" } },
    blocks: {
        condition: [6, 13, 20], whenTrigger: 27, whenPrecontent: 39, whenDelay: 46, whenEffect: 47,
        whileAccumulation: 85, whileTrigger: 97, whileEvenIfOwnerDead: 108, whileEffect: 109,
    },
    condition: codes("parseAt6"),
    conditionWho: codes("parseAt7"),
    whenTrigger: codes("parseAt27"),
    whenWho: codes("parseAt28"),
    whenPrecontent: codes("parseAt39"),
    whileTrigger: codes("parseAt97"),
    whileWho: codes("parseAt98"),
    whenEffect: codes("parseAt47"),
    whileEffect: codes("parseAt109"),
    target: codes("parseAt48"),
}
// one code per line
const text = "{\n" + Object.entries(result).map(([k, v]) => !k.startsWith("_") && k !== "kind" && k !== "blocks"
    ? ` ${JSON.stringify(k)}: {\n` + Object.entries(v).map(([c, x]) => `  ${JSON.stringify(c)}: ${JSON.stringify(x)}`).join(",\n") + "\n }"
    : ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n") + "\n}\n"
if (process.argv[3]) fs.writeFileSync(process.argv[3], text)
for (const [k, v] of Object.entries(result)) if (!k.startsWith("_") && k !== "kind" && k !== "blocks") console.log(k, Object.keys(v).length)
