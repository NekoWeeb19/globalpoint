// Turns the decompiled AS3 of the game's summon ball field (pinball.gacha.ballMovie, its physics engine gacha_physics,
// MathCompat and MersenneTwister) into scripts/gacha_seeds/physics.js for field.cjs. Needs the decompiled CN client
// (F:/WF client/cn/decompiled: scripts, scripts-priority, scripts-pcode). physics.js is generated, not in git.
// Usage: node scripts/gacha_seeds/transpile.cjs
const fs = require("fs"), path = require("path")
const DEC = process.env.CN_DECOMPILED_ROOT || "F:/WF client/cn/decompiled"
const SRC = `${DEC}/scripts/scripts`
const ALT = `${DEC}/scripts-priority/scripts`
const PCODE = `${DEC}/scripts-pcode/scripts`

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".as") ? [path.join(d, e.name)] : [])
const rel = f => path.relative(SRC, f).split(path.sep).join("/")
const files = [
    ...walk(path.join(SRC, "gacha_physics")).map(rel),
    "pinball/common/math/MathCompat.as",
    "pinball/common/random/MersenneTwister.as",
    "pinball/gacha/ballMovie/fallingField/FallingField.as",
    "pinball/gacha/ballMovie/fallingField/FixedFallingField.as",
    "pinball/gacha/ballMovie/element/Amulet.as",
    "pinball/gacha/ballMovie/element/AmuletPlaceId.as",
    "pinball/gacha/ballMovie/element/Ball.as",
    "pinball/gacha/ballMovie/element/Pin.as",
]

// split code into a list of { kind: "code" | "str" | "comment", text }
function lex(src) {
    const out = []; let i = 0, start = 0
    const push = (kind, end) => { if (end > start) out.push({ kind, text: src.slice(start, end) }); start = end }
    while (i < src.length) {
        const c = src[i]
        if (c === '"' || c === "'") {
            push("code", i); let j = i + 1
            while (j < src.length && src[j] !== c) { if (src[j] === "\\") j++; j++ }
            i = j + 1; push("str", i)
        } else if (c === "/" && src[i + 1] === "/") { push("code", i); const j = src.indexOf("\n", i); i = j < 0 ? src.length : j; push("comment", i) }
        else if (c === "/" && src[i + 1] === "*") { push("code", i); const j = src.indexOf("*/", i + 2); i = j < 0 ? src.length : j + 2; push("comment", i) }
        else i++
    }
    push("code", i)
    return out
}
const mapCode = (src, fn) => lex(src).map(p => p.kind === "code" ? fn(p.text) : p.kind === "str" ? p.text : "").join("")

function matchBrace(s, open) { // index of the } matching s[open] === "{", skipping strings
    let depth = 0
    for (let i = open; i < s.length; i++) {
        const c = s[i]
        if (c === '"' || c === "'") { let j = i + 1; while (s[j] !== c) { if (s[j] === "\\") j++; j++ } i = j; continue }
        if (c === "{") depth++
        else if (c === "}") { depth--; if (depth === 0) return i }
    }
    throw new Error("unbalanced")
}

const defaultFor = t => (t === "int" || t === "uint") ? "0" : t === "Number" ? "NaN" : t === "Boolean" ? "false" : "null"

function parseClass(file) {
    let src = fs.readFileSync(path.join(SRC, file), "utf8")
    if (src.includes("Not decompiled")) src = fs.readFileSync(path.join(ALT, file), "utf8")
    const h = /(?:public\s+|internal\s+)?(?:final\s+)?(?:dynamic\s+)?(class|interface)\s+(\w+)(?:\s+extends\s+([\w.]+))?(?:\s+implements\s+[\w.,\s]+?)?\s*\{/.exec(src)
    const open = h.index + h[0].length - 1, close = matchBrace(src, open)
    const body = src.slice(open + 1, close)
    const cls = { file, kind: h[1], name: h[2], base: h[3] ? h[3].split(".").pop() : null, fields: [], statics: [], methods: [] }
    let i = 0
    while (i < body.length) {
        if (/\s/.test(body[i])) { i++; continue }
        // read a member header up to ; or {
        let j = i
        while (j < body.length && body[j] !== ";" && body[j] !== "{") {
            if (body[j] === '"') { j++; while (body[j] !== '"') j++ }
            j++
        }
        const head = body.slice(i, j).trim()
        if (body[j] === ";" && /\bfunction\b/.test(head)) { i = j + 1; continue } // interface method
        if (body[j] === ";") {
            const m = /(static\s+)?(?:var|const)\s+(\w+)\s*:\s*([\w.*<>]+)(?:\s*=\s*([\s\S]+))?$/.exec(head)
            if (!m) throw new Error(`${file}: field? ${head}`)
            ;(m[1] ? cls.statics : cls.fields).push({ name: m[2], type: m[3], init: m[4] })
            i = j + 1
        } else {
            const end = matchBrace(body, j)
            const m = /(static\s+)?(?:final\s+)?function\s+(get\s+|set\s+)?(\w+)\s*\(([^)]*)\)/.exec(head)
            if (!m) throw new Error(`${file}: method? ${head}`)
            const isStatic = !!m[1] || /\bstatic\b/.test(head)
            const params = m[4].split(",").map(p => p.trim()).filter(Boolean).map(p => {
                const pm = /^(\.\.\.)?(\w+)\s*(?::\s*[\w.*<>]+)?\s*(?:=\s*(.+))?$/.exec(p)
                return (pm[1] || "") + pm[2] + (pm[3] !== undefined ? ` = ${pm[3]}` : "")
            })
            cls.methods.push({ name: m[3], accessor: (m[2] || "").trim(), isStatic, params, code: body.slice(j + 1, end) })
            i = end + 1
        }
    }
    return cls
}

const classes = files.map(parseClass)
const byName = new Map(classes.map(c => [c.name, c]))
if (byName.size !== classes.length) throw new Error("duplicate class names")
const ancestors = c => c.base && byName.has(c.base) ? [byName.get(c.base), ...ancestors(byName.get(c.base))] : []

// enum values from the pcode class initializers: name -> index
function enumIndices(cls) {
    const pc = path.join(PCODE, cls.file.replace(/\.as$/, ".pcode"))
    if (!fs.existsSync(pc)) return null
    const text = fs.readFileSync(pc, "utf8"), out = []
    const re = /pushstring "(\w+)"\s+push(?:byte|short|int) (-?\d+)\s+pushnull\s+constructprop[^\n]*\n\s+initproperty QName\(PackageNamespace\(""\),"(\w+)"\)/g
    let m
    while ((m = re.exec(text))) out.push([m[3], m[1], Number(m[2])])
    const zero = /pushstring "(\w+)"\s+pushbyte 0\s+pushnull/.exec(text) // pushbyte 0 is sometimes pushnull-free; covered above
    return out
}

function transformBody(code, cls) {
    const instance = new Set(), statics = new Map(), methods = new Set()
    for (const c of [cls, ...ancestors(cls)]) {
        for (const f of c.fields) instance.add(f.name)
        for (const m of c.methods) if (m.isStatic) { if (!statics.has(m.name)) statics.set(m.name, c.name) } else { instance.add(m.name); methods.add(m.name) }
        for (const f of c.statics) if (!statics.has(f.name)) statics.set(f.name, c.name)
    }
    const locals = new Set()
    for (const m of code.matchAll(/\bvar\s+(\w+)/g)) locals.add(m[1])
    return mapCode(code, t => {
        t = t.replace(/\bBoot\.lastError\s*=\s*new Error\(\);/g, "")
            .replace(/\bBoot\.skip_constructor\b/g, "false")
            .replace(/\bgetTimer\(\)/g, "0")
            .replace(/\bMath\.POSITIVE_INFINITY\b/g, "Infinity").replace(/\bMath\.NEGATIVE_INFINITY\b/g, "(-Infinity)").replace(/\bMath\.NaN\b/g, "NaN")
            .replace(/new Vector\.<((?:[^<>]|<[^<>]*>)*)>\(\s*([^,)]*)[^)]*\)/g, (a, t, n) => `__vec(${t === "Number" || t === "int" || t === "uint" ? 0 : null}, ${n || 0})`)
            .replace(/\bvar\s+(\w+)\s*:\s*[\w.*]+(?:<(?:[^<>]|<[^<>]*>)*>)?/g, "var $1")
            .replace(/\s+as\s+[A-Za-z_][\w.]*/g, "")
            .replace(/(\w)\s+is\s+([A-Z]\w*)/g, "$1 instanceof $2")
        // identifiers: casts and bare member references
        return t.replace(/(\.\s*)?\b([A-Za-z_$][\w$]*)\b(\s*\()?/g, (all, dot, id, call) => {
            if (dot) return all
            if (!dot && call && (id === "int" || id === "uint" || id === "Number" || id === "Boolean")) return `__${id}${call}`
            if (locals.has(id) || /^(param\d+|_loc\d+_)$/.test(id) || byName.has(id)) return all
            if (instance.has(id)) return methods.has(id) && !call ? `this.${id}.bind(this)` : `this.${id}${call || ""}`
            if (statics.has(id) && statics.get(id) !== id) return `${statics.get(id)}.${id}${call || ""}`
            return all
        })
    })
}

let out = `"use strict"
// Generated from the game's decompiled AS3 by transpile.cjs. Do not edit.
const __int = x => x | 0, __uint = x => x >>> 0, __Number = x => +x, __Boolean = x => !!x
const __vec = (fill, n) => new Array(n | 0).fill(fill)
const __bind = (o, k) => typeof o[k] === "function" ? o[k].bind(o) : o[k]
const __defaults = (o, d) => { for (const k in d) if (o[k] === undefined) o[k] = d[k] }
`
// order: bases first
const done = new Set(), order = []
const visit = c => { if (done.has(c.name)) return; if (c.base && byName.has(c.base)) visit(byName.get(c.base)); done.add(c.name); order.push(c) }
classes.forEach(visit)
const missingBases = new Set(classes.filter(c => c.base && !byName.has(c.base)).map(c => c.base))
for (const b of missingBases) out += `class ${b} {}\n`

for (const c of order) {
    out += `\nclass ${c.name}${c.base ? ` extends ${c.base}` : ""} {\n`
    const defaults = `__defaults(this, {${c.fields.map(f => `${f.name}: ${defaultFor(f.type)}`).join(", ")}})`
    let hasCtor = false
    for (const m of c.methods) {
        let code = transformBody(m.code, c)
        if (m.name === c.name && !m.isStatic) {
            hasCtor = true
            if (c.base) {
                if (!/\bsuper\s*\(/.test(code)) code = `super(); ${defaults};` + code
                else { // JS needs super() first; the game's bases here set nothing the subclasses set before it
                    let call = ""
                    code = code.replace(/\bsuper\s*\(([^;]*)\);/, s => { call = s; return "" })
                    code = `${call} ${defaults};` + code
                }
            } else code = `${defaults};` + code
            out += `  constructor(${m.params.join(", ")}) {${code}}\n`
        } else {
            out += `  ${m.isStatic ? "static " : ""}${m.accessor ? m.accessor + " " : ""}${m.name}(${m.params.join(", ")}) {${transformBody(m.code, c)}}\n`
        }
    }
    if (!hasCtor) out += `  constructor(...a) {${c.base ? "super(...a); " : ""}${defaults}}\n`
    out += `}\n`
    for (const f of c.statics) out += `${c.name}.${f.name} = ${f.init !== undefined ? transformBody(f.init, c) : defaultFor(f.type)};\n`
    const en = enumIndices(c)
    if (en && en.length) for (const [prop, tag, idx] of en) out += `${c.name}.${prop} = new ${c.name}(${JSON.stringify(tag)}, ${idx}, null);\n`
}
// AS3 method closures are bound: "x = obj.method;" -> bound copy
const allMethods = new Set(classes.flatMap(c => c.methods.filter(m => !m.isStatic).map(m => m.name)))
out = out.replace(/=\s*([\w$]+(?:\.[\w$]+)*)\.([\w$]+)\s*;/g, (all, obj, name) => allMethods.has(name) && !byName.has(name) ? `= __bind(${obj}, "${name}");` : all)
out += `\nmodule.exports = { ${order.map(c => c.name).join(", ")} }\n`
// Haxe Int multiplication wraps at 32 bits (checked against the recorded seeds)
out = out.replace("_loc2_ = 1812433253 * (_loc2_ ^ _loc2_ >>> 30) + _loc4_;", "_loc2_ = (Math.imul(1812433253, _loc2_ ^ _loc2_ >>> 30) + _loc4_) | 0;")
fs.writeFileSync(process.argv[2] || path.join(__dirname, "physics.js"), out)
console.log(`${order.length} classes, ${out.length} chars; external bases: ${[...missingBases].join(", ")}`)
