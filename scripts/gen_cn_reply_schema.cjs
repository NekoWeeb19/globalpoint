// Reads, from the CN client's bytecode (FFDec p-code export), the type the client requires for every
// field of every API reply, so StarPoint's replies to the CN client can be checked and completed
// (src/lib/cnClient.ts). The client throws ClientError 8700-8707 when a field has the wrong type:
//   8700 Int, 8701 Float, 8702 String, 8703 Bool, 8704 Array, 8707 Object
// A check is "nullable" when the client compares the field with null first (then null/absent is fine).
//
//   node scripts/gen_cn_reply_schema.cjs [<p-code export>/scripts]   (or set CN_DECOMPILED_DIR)
// (export: ffdec-cli -format script:pcode -selectclass "pinball.remote.**,pinball.context.remote.real.**" -export script <out> <1.8.1 swf>)
//   -> assets/cn_reply_schema.json  { common: [checks], apis: { "single_battle_quest/finish": [checks] } }
const fs = require("fs")
const path = require("path")

const ROOT = require("./cn_archives.cjs").requiredPath("CN_DECOMPILED_DIR", process.argv[2], "the CN client's FFDec p-code export (its scripts folder)")
const TYPES = { 8700: "int", 8701: "float", 8702: "string", 8703: "bool", 8704: "array", 8707: "object" }
// files whose checks apply to every reply, and files whose API path isn't written as "a/b"
const COMMON = "pinball/context/remote/real/RealRemoteService.pcode"
const FIXED_APIS = { "pinball/remote/initialize/InitializeRealRemote.pcode": ["load"] }

function walk(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name)
        if (fs.statSync(full).isDirectory()) walk(full, out)
        else if (name.endsWith("RealRemote.pcode") || name === "RealRemoteService.pcode") out.push(full)
    }
    return out
}

function checksOf(lines) {
    const checks = new Map()
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/pushint (87\d\d)\s*$/)
        if (!m || !TYPES[m[1]]) continue
        let field = null
        for (let j = i + 1; j <= i + 4 && j < lines.length; j++) {
            const s = lines[j].match(/pushstring "(data(?:[.[][^"]*)?)"\s*$/)
            if (s) { field = s[1]; break }
        }
        if (field === null) continue
        // null/absent allowed when the client compares the value with null between reading the field
        // and testing its type. The read is the nearest "<name>" property/key before the test (list
        // elements and map values, path ending in ], are read without a name: look a short way back).
        const name = field.endsWith("]") ? null : field.split(".").pop()
        let from = Math.max(0, i - 40)
        if (name) {
            for (let j = i - 1; j >= Math.max(0, i - 400); j--) {
                if (lines[j].includes(`"${name}")`) || lines[j].match(new RegExp(`pushstring "${name}"\\s*$`))) { from = j; break }
            }
        }
        const nullable = lines.slice(from, i).some(l => /^\s*pushnull\s*$/.test(l))
        const key = field
        const prev = checks.get(key)
        // the same field checked in two places: nullable only if every check allows it
        checks.set(key, { path: field, type: TYPES[m[1]], nullable: prev ? prev.nullable && nullable : nullable })
    }
    return [...checks.values()]
}

const out = { common: [], apis: {} }
let files = 0
for (const file of walk(ROOT)) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/")
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/)
    const checks = checksOf(lines)
    if (checks.length === 0) continue
    files++
    if (rel === COMMON) { out.common = checks; continue }
    const apis = FIXED_APIS[rel] ?? [...new Set(lines
        .map(l => l.match(/pushstring "([a-z_]+(?:\/[a-zA-Z_]+)+)"\s*$/)?.[1])
        .filter(p => p && !p.includes("/.") && !/^(battle|scene|layout|item|quest\/thumbnail|story|character\/|rich_text)/.test(p)))]
    for (const api of apis) out.apis[api] = [...(out.apis[api] ?? []), ...checks]
}

const file = path.join(__dirname, "..", "assets", "cn_reply_schema.json")
fs.writeFileSync(file, JSON.stringify(out))
console.log(`${files} remotes, ${Object.keys(out.apis).length} API paths, ${out.common.length} common checks -> ${file}`)
for (const api of ["load", "single_battle_quest/finish", "shop/buy", "gacha/exec"]) {
    const c = out.apis[api] ?? []
    console.log(`  ${api}: ${c.length} checks, ${c.filter(x => !x.nullable).length} required`)
}
