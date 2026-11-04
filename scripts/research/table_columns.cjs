// RESEARCH (docs/research/new-units.md, appendix): the column -> field map of CN tables, from the decompiled
// client's generated parsers (pinball/master/generated/<Class>Values.as).
//   node scripts/research/table_columns.cjs <decompiled pinball/master/generated dir> CharacterValues AbilityValues ...
const fs = require("fs")
const DIR = (process.argv[2] ?? "").replace(/[\/]?$/, "/")
const out = {}
for (const cls of process.argv.slice(3)) {
    const src = fs.readFileSync(DIR + cls + ".as", "utf8").split(/\r?\n/).filter(l => !/"(fileName|lineNumber|className|methodName)"/.test(l))
    const vars = new Set(src.map(l => (l.match(/public var (\w+):/) || [])[1]).filter(Boolean))
    // split into functions
    const fns = {}
    let name = null
    for (const l of src) {
        const m = l.match(/function (\w+)\(/)
        if (m && /^\s{6}\S/.test(l)) { name = m[1]; fns[name] = []; continue }
        if (name) fns[name].push(l)
    }
    const memo = {}
    // columns a function reads: [[col, path]]
    function cols(fn, stack = []) {
        if (memo[fn]) return memo[fn]
        if (stack.includes(fn) || !fns[fn]) return []
        const res = []
        for (const l of fns[fn]) {
            for (const c of l.matchAll(/param1\[(\d+)\]/g)) res.push([+c[1], ""])
            for (const k of l.matchAll(/(?:"(\w+)":)?\w+\.(parseAt\d+)\(param1\)/g))
                for (const [col, p] of cols(k[2], [...stack, fn])) res.push([col, [k[1], p].filter(Boolean).join(".")])
        }
        return (memo[fn] = res)
    }
    const found = new Map()
    const add = (col, path) => {
        const set = found.get(col) ?? new Set()
        set.add(path)
        found.set(col, set)
    }
    let pending = []
    for (const l of fns[cls] ?? []) {
        for (const c of l.matchAll(/param1\[(\d+)\]/g)) pending.push([+c[1], ""])
        for (const k of l.matchAll(/(?:"(\w+)":)?\w+\.(parseAt\d+)\(param1\)/g))
            for (const [col, p] of cols(k[2])) pending.push([col, [k[1], p].filter(Boolean).join(".")])
        const a = l.match(/^\s*(\w+) = /)
        if (a && vars.has(a[1])) {
            for (const [col, p] of pending) add(col, p ? `${a[1]}.${p}` : a[1])
            pending = []
        }
    }
    out[cls] = [...found].sort((a, b) => a[0] - b[0]).map(([c, s]) => [c, [...s].join(" / ")])
}
console.log(JSON.stringify(out))
