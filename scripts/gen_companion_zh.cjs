// The companion app's Chinese (Simplified): companion/i18n/zh.json (English -> Chinese) becomes
// companion/app/src/main/java/org/globalpoint/companion/ZhStrings.java, the table Tr.t reads.
// Every text the app's code passes to Tr.t (the English literals inside its first argument, ternaries included), and
// the download names DownloadCheck shows, must have its Chinese; a format's %s / %d must be the same in both.
//
//   node scripts/gen_companion_zh.cjs          -> writes ZhStrings.java; exits 1 when a text has no Chinese
//   node scripts/gen_companion_zh.cjs --check  -> only checks (the tests run this)
const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..", "companion")
const SRC = path.join(ROOT, "app", "src", "main", "java", "org", "globalpoint", "companion")
const TABLE = path.join(ROOT, "i18n", "zh.json")
const OUT = path.join(SRC, "ZhStrings.java")

// a Java string literal's value
const javaValue = lit => JSON.parse(lit.replace(/\\'/g, "'"))
const LITERAL = /"(?:[^"\\\n]|\\.)*"/g

/** The texts the code passes to Tr.t, by file. */
function usedTexts() {
    const used = new Map()
    for (const file of fs.readdirSync(SRC).filter(f => f.endsWith(".java") && f !== "ZhStrings.java" && f !== "Tr.java")) {
        const src = fs.readFileSync(path.join(SRC, file), "utf8")
        for (let at = src.indexOf("Tr.t("); at >= 0; at = src.indexOf("Tr.t(", at + 5)) {
            // the first argument: up to the first comma or closing parenthesis at depth 0, outside strings
            let i = at + 5, depth = 0, arg = ""
            for (; i < src.length; i++) {
                const ch = src[i]
                if (ch === "\"") { const m = /"(?:[^"\\\n]|\\.)*"/y; m.lastIndex = i; const lit = m.exec(src)[0]; arg += lit; i += lit.length - 1; continue }
                if (ch === "(") depth++
                else if (ch === ")") { if (depth === 0) break; depth-- }
                else if (ch === "," && depth === 0) break
                arg += ch
            }
            for (const lit of arg.match(LITERAL) ?? []) {
                const text = javaValue(lit)
                // the ternary's test ("zh-art".equals(...)) isn't text
                if (arg.includes(lit + ".equals(")) continue
                // nor a method's argument inside it (info.optString("content"))
                if (/[A-Za-z_]\(\s*$/.test(arg.slice(0, arg.indexOf(lit)))) continue
                if (!used.has(text)) used.set(text, file)
            }
        }
        // DownloadCheck's known downloads: their names are shown through Tr.t((String) k[2])
        if (file === "DownloadCheck.java") for (const m of src.matchAll(/\{"[0-9a-f]{64}", -?[0-9]+L, ("(?:[^"\\]|\\.)*")\}/g)) used.set(javaValue(m[1]), file)
    }
    return used
}

// a format's % parts, compared as a set: the Chinese may reorder them with %2$s, %1$s
const formats = s => (s.match(/%(?:[0-9]+\$)?[-#+ 0,(]*[0-9]*(?:\.[0-9]+)?[sdfx%n]/g) ?? []).map(f => f.replace(/^%[0-9]+\$/, "%")).sort().join(" ")

const table = JSON.parse(fs.readFileSync(TABLE, "utf8"))
const used = usedTexts()
const problems = []
for (const [text, file] of used) {
    if (typeof table[text] !== "string") problems.push(`${file}: no Chinese for ${JSON.stringify(text)}`)
    else if (formats(table[text]) !== formats(text)) problems.push(`${file}: the Chinese of ${JSON.stringify(text)} has other % parts (${formats(table[text])} vs ${formats(text)})`)
}
const unused = Object.keys(table).filter(k => k !== "_note" && !used.has(k))
for (const p of problems) console.log(p)
if (unused.length) console.log(`not used any more (${unused.length}): ${unused.map(u => JSON.stringify(u)).join(", ")}`)
console.log(`${used.size} texts, ${problems.length} problem(s)`)
if (problems.length) process.exit(1)

if (!process.argv.includes("--check")) {
    const javaLit = s => JSON.stringify(s).replace(/[\u007f-￿]/g, c => c) // UTF-8 source
    const entries = [...used.keys()].sort().map(k => `        m.put(${javaLit(k)}, ${javaLit(table[k])});`)
    const java = `package org.globalpoint.companion;

import java.util.HashMap;
import java.util.Map;

/** The app's Simplified Chinese, by its English. Made by scripts/gen_companion_zh.cjs from companion/i18n/zh.json: edit that. */
final class ZhStrings {
    private ZhStrings() { }

    private static final Map<String, String> MAP = new HashMap<>(${used.size * 2});

    static {
        Map<String, String> m = MAP;
${entries.join("\n")}
    }

    static String get(String en) { return MAP.get(en); }
}
`
    fs.writeFileSync(OUT, java)
    console.log(`-> ${path.relative(process.cwd(), OUT)}`)
}
