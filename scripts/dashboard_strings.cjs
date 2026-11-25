// Lists the dashboard's English text for its Chinese dictionary (web/public/i18n/zh.json, used by web/public/js/i18n.js):
// - "html:" keys: whole elements (p, li, label, headings...) whose sentence is split by inline formatting (b, code, a...),
//   so the Chinese can keep its own word order; the key is the element's inner HTML without class/style/id attributes;
// - plain keys: the other text between tags, the attributes people read (placeholder, title, aria-label, alt, value),
//   and the string literals in the pages' scripts and web/public/js that hold words (messages, labels built at run time).
// Prints the strings the dictionary lacks.
//
//   node scripts/dashboard_strings.cjs [--all] [--json out.json]
const fs = require("fs")
const path = require("path")

const WEB = path.join(__dirname, "..", "web")
const norm = s => s.replace(/\s+/g, " ").trim()
const hasWords = s => /[A-Za-z]{2,}/.test(s) && !/^[a-z0-9_\-./:#?=&%]+$/i.test(s) && !/^(https?:|\/|#|[a-z]+\.[a-z]+$)/i.test(s)
const decode = s => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&rarr;/g, "→").replace(/&larr;/g, "←").replace(/&middot;/g, "·").replace(/&hellip;/g, "…").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&times;/g, "×")
// CSS class lists and selectors aren't text
const isCss = t => {
    const w = t.split(/\s+/)
    return (w.every(x => /^[a-z0-9:\-[\]/.%#()!,>*=]+$/.test(x)) && w.filter(x => /[-:]/.test(x)).length >= w.length / 2) || /^(input|button|a|select|textarea|label)(, ?[a-z]+)+$/.test(t)
}
const INLINE = /<(b|i|em|strong|code|a|br|span|kbd|u|sup|sub)\b/i
const WHOLE_TAGS = "p|li|label|h[1-6]|small|dd|dt|td|th|summary|legend"
const WHOLE = new RegExp(`<(${WHOLE_TAGS})\\b[^>]*>((?:(?!<\\/?(?:p|li|ul|ol|div|section|table|form|h[1-6])\\b)[\\s\\S])*?)<\\/\\1>`, "gi")
/** The key of a whole element: its inner HTML, attributes other than href/target dropped, spaces collapsed. */
const wholeKey = inner => norm(inner.replace(/\s+(class|style|id|data-[a-z-]+|aria-[a-z-]+)="[^"]*"/g, ""))

function fromHtml(html) {
    const out = new Set()
    const scripts = []
    const body = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (_, code) => { scripts.push(code); return " " }).replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
    const rest = body.replace(WHOLE, (all, tag, inner) => {
        if (!INLINE.test(inner) || !hasWords(inner.replace(/<[^>]*>/g, " "))) return all
        // an element holding a form control or a button is left in pieces
        if (/<(input|select|textarea|button|svg)\b/i.test(inner)) return all
        out.add("html:" + wholeKey(inner))
        return all.replace(inner, " ")
    })
    // text between tags is never code: single words count too ("Overview"); template placeholders and .env lines don't
    const isText = t => /[A-Za-z]{2,}/.test(t) && !isCss(t) && !/^\{\{.*\}\}$/.test(t) && !/^[A-Z_]+=/.test(t)
    for (const m of rest.matchAll(/>([^<>]+)</g)) { const t = norm(decode(m[1])); if (isText(t)) out.add(t) }
    for (const m of rest.matchAll(/\b(?:placeholder|title|aria-label|alt|data-label)="([^"]*)"/g)) { const t = norm(decode(m[1])); if (isText(t)) out.add(t) }
    for (const m of rest.matchAll(/<(?:input|button)\b[^>]*\bvalue="([^"]*)"/g)) { const t = norm(decode(m[1])); if (hasWords(t) && !isCss(t)) out.add(t) }
    for (const code of scripts) for (const t of fromScript(code)) out.add(t)
    return out
}
function fromScript(code) {
    const out = new Set()
    for (const m of code.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
        let t = m[2]
        if (m[1] === "`") t = t.replace(/\$\{[^}]*\}/g, "{}")
        t = norm(decode(t.replace(/\\n/g, " ").replace(/\\"/g, "\"").replace(/\\'/g, "'")))
        if (!hasWords(t) || isCss(t) || /^[a-z][a-zA-Z0-9]*$/.test(t)) continue
        if (/[<>]/.test(t) && !/^[^<]*$/.test(t.replace(/<\/?(b|i|code|br)>/g, ""))) continue // HTML built in code
        if (!/\s/.test(t) && !/^[A-Z]/.test(t)) continue
        out.add(t)
    }
    return out
}

const all = new Map() // string -> pages
const add = (t, page) => (all.get(t) ?? all.set(t, new Set()).get(t)).add(page)
for (const f of fs.readdirSync(path.join(WEB, "pages")).filter(f => f.endsWith(".html"))) for (const t of fromHtml(fs.readFileSync(path.join(WEB, "pages", f), "utf8"))) add(t, f)
for (const f of fs.readdirSync(path.join(WEB, "public", "js")).filter(f => f.endsWith(".js") && !["i18n.js", "unit-editor-zh.js"].includes(f))) for (const t of fromScript(fs.readFileSync(path.join(WEB, "public", "js", f), "utf8"))) add(t, f)

// the server's messages the dashboard shows (errors and checks from its API and the editors): string literals in
// new Error(...), message: ..., and the editors' problem lists. Ones with ${...} in them become patterns ("pattern:").
const SERVER = [path.join(__dirname, "..", "src", "routes", "web_api"), path.join(__dirname, "..", "src", "nya")]
const SERVER_FILES = ["unit_editor.cjs", "armament_editor.cjs", "skill_editor.cjs", "custom_units.cjs", "build_kit_text.cjs"].map(f => path.join(__dirname, f))
const serverFiles = [...SERVER.flatMap(d => fs.readdirSync(d).filter(f => /\.ts$/.test(f)).map(f => path.join(d, f))), ...SERVER_FILES.filter(fs.existsSync)]
for (const file of serverFiles) {
    const code = fs.readFileSync(file, "utf8")
    for (const m of code.matchAll(/(?:new Error\(|message:\s*|\b(?:e|errors|problems|out\.\w+)\.push\(|reply\.status\(4\d\d\)\.send\(\{[^}]*message:\s*)(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
        const raw = m[2]
        if (!/[A-Za-z]{3,}\s/.test(raw)) continue
        const t = norm(raw.replace(/\\n/g, " ").replace(/\\"/g, "\"").replace(/\\'/g, "'"))
        add(m[1] === "`" && /\$\{/.test(t) ? "pattern:" + t : t, path.basename(file))
    }
}

let known = new Set()
try { const j = JSON.parse(fs.readFileSync(path.join(WEB, "public", "i18n", "zh.json"), "utf8")); known = new Set(j.keys ?? Object.keys(j.strings ?? {})) } catch { }
// keys the translators marked as not text (scripts/i18n/zh/_skip.json: placeholders, code, CSS)
try { for (const k of Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, "i18n", "zh", "_skip.json"), "utf8")))) known.add(k) } catch { }
const missing = [...all.keys()].filter(t => process.argv.includes("--all") || !known.has(t))
const jsonAt = process.argv.indexOf("--json")
if (jsonAt > 0) fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify(missing.map(t => ({ t, pages: [...all.get(t)] })), null, 1))
console.log(`${all.size} strings, ${missing.length} without Chinese; words: ${missing.reduce((n, t) => n + t.replace(/<[^>]*>/g, " ").split(/\s+/).length, 0)}`)
const byPage = {}
for (const t of missing) for (const p of all.get(t)) byPage[p] = (byPage[p] ?? 0) + 1
console.log(JSON.stringify(byPage))
module.exports = { wholeKey, norm }
