// Builds the dashboard's Chinese dictionary (web/public/i18n/zh.json, read by web/public/js/i18n.js) from the
// translation files in scripts/i18n/zh/*.json ({ "English": "中文" }, one file per page or area):
// - plain keys: a text piece, attribute or message, matched whole (spaces collapsed);
// - "html:" keys: a whole element's inner HTML (scripts/dashboard_strings.cjs prints them), replaced whole;
// - "pattern:" keys: a message with ${...} parts (as the server writes it); the Chinese names them ${1}, ${2}... in
//   their English order, and each part is translated too when the dictionary has it.
// Then lists the dashboard's strings still without Chinese (scripts/dashboard_strings.cjs).
//
//   node scripts/build_dashboard_i18n.cjs
const fs = require("fs")
const path = require("path")

const SRC = path.join(__dirname, "i18n", "zh")
const OUT = path.join(__dirname, "..", "web", "public", "i18n", "zh.json")
const norm = s => s.replace(/\s+/g, " ").trim()
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const strings = {}, patterns = [], seen = new Map()
for (const file of fs.readdirSync(SRC).filter(f => f.endsWith(".json") && !f.startsWith("_")).sort()) {
    const table = JSON.parse(fs.readFileSync(path.join(SRC, file), "utf8"))
    for (const [en, zh] of Object.entries(table)) {
        if (en.startsWith("_")) continue
        if (seen.has(en) && seen.get(en).zh !== zh) console.log(`note: "${en.slice(0, 50)}" differs between ${seen.get(en).file} and ${file}; ${file} wins`)
        seen.set(en, { file, zh })
        if (en.startsWith("regex:")) {
            // a raw regular expression (durations, dates): the Chinese uses $1, $2...
            patterns.push([en.slice("regex:".length), zh])
        } else if (en.startsWith("pattern:")) {
            const text = norm(en.slice("pattern:".length))
            const parts = text.split(/\$\{[^}]*\}/)
            const re = parts.map(escape).join("(.+?)")
            patterns.push([re, zh.replace(/\$\{(\d+)\}/g, "$$$1")])
        } else if (en.startsWith("html:")) strings[en] = zh
        else if (en.includes("{}")) {
            // a string built in code around values ("HP {}x · attack {}x"): a pattern, the Chinese's {} in the same order
            const re = norm(en).split("{}").map(escape).join("(.+?)")
            let n = 0
            patterns.push([re, zh.replace(/{}/g, () => "$" + ++n)])
        } else strings[norm(en)] = zh
    }
}
// longer patterns first, so the most specific one wins
patterns.sort((a, b) => b[0].length - a[0].length)
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify({ _note: "Built by scripts/build_dashboard_i18n.cjs from scripts/i18n/zh/*.json.", strings, patterns, keys: [...seen.keys()].map(k => k.startsWith("html:") || k.startsWith("pattern:") ? k : norm(k)) }))
console.log(`${Object.keys(strings).length} strings, ${patterns.length} patterns -> ${path.relative(process.cwd(), OUT)}`)
require("./dashboard_strings.cjs")
