// Global's own English for text pieces of the CN client's ability descriptions (and the element icon
// pieces), where the CN client can use it. Written to assets/translations/cn_rows.json, which
// scripts/apply_cn_translations.cjs puts in place of whole rows (these rows aren't only Chinese
// cells: the icon pieces have no Chinese at all, which is why they kept CN's plain spaces after
// the icon, which the text box drops, so the next word slid under the icon).
//
// CN reworked some pieces and gave them extra values (e.g. ::sum::). Global's English is used when
// every value it names is one the CN piece has too (the CN client then fills them the same way);
// CN-only values are left out, as global's client did. Pieces global doesn't have keep the
// translation from assets/translations/cn.json.
//
//   node scripts/gen_cn_global_rows.cjs   -> assets/translations/cn_rows.json
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { cnZips } = require("./cn_archives.cjs")
const unzipper = require("unzipper")

const TABLE = "production/upload/d6/88e4a5f7d84cc422357cc8acbdb72817bc8670" // UI text (ability pieces etc.)
const KEYS = /^(ability_description_|element_kind_)/
const OUT = path.join(__dirname, "..", "assets", "translations", "cn_rows.json")
const KEYWORDS = new Set(["if", "else", "elseif", "end", "foreach", "true", "false", "null", "and", "or"])
// flags the CN client sets for every piece (in its code), even where CN's own text doesn't use them;
// one left unset reads as false, which picks the plain wording
const CONTEXT_FLAGS = new Set(["isBeforeInstantTrigger", "includesThreshold", "isPrecondition", "hasAccumulationTrigger", "hasCount2", "count2", "withoutTarget"])

/**
 * Small fixes to global's own text: "is at or below" runs into the number ("below50 %"), "All
 * Elemental" has no space before the next word ("All Elementalresistance"), and the element icons
 * get a third non-breaking space like the main-unit icon, so the next word clears the icon.
 */
function fix(key, en) {
    let out = en.replace(/(at or below|at or above)::else::/g, "$1 ::else::")
    if (key === "element_kind_all_full" || key === "element_kind_all") out = out.replace(/Elemental$/, "Elemental ")
    // "the first time:" runs into the effect ("time:+ 25 %")
    if (/^ability_description_instant_trigger_limit_/.test(key)) out = out.replace(/:$/, ": ")
    if (/^element_kind_[a-z]+_icon$/.test(key)) out = out.replace(/(&nbsp;)+$/, "&nbsp;&nbsp;&nbsp;")
    return out
}

/** The values a haxe template names (identifiers in its ::expression:: parts). */
function values(template) {
    const out = new Set()
    template.split("::").forEach((part, i) => {
        if (i % 2 === 0) return // text between expressions
        for (const id of part.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) if (!KEYWORDS.has(id)) out.add(id)
    })
    return out
}

;(async () => {
    let cnBuf = null
    for (const z of cnZips()) for (const e of (await unzipper.Open.file(z)).files) if (e.path.split("\\").join("/").endsWith(TABLE.replace("production/", ""))) cnBuf = await e.buffer()
    const cn = {}
    for (const { path: k, leaf } of R.leaves(R.decodeFile(cnBuf))) cn[k.join("/")] = R.splitCsv(leaf.text.replace(/\n$/, ""))[0]
    const rows = {}
    let used = 0, skipped = []
    for (const { path: k, leaf } of R.leaves(R.decodeFile(await R.readHashedFile(TABLE)))) {
        const key = k.join("/")
        if (!KEYS.test(key) || cn[key] === undefined) continue
        const en = R.splitCsv(leaf.text.replace(/\n$/, ""))[2]
        if (en === undefined || en === "") continue
        const have = values(cn[key])
        const missing = [...values(en)].filter(v => !have.has(v) && !CONTEXT_FLAGS.has(v))
        if (missing.length > 0) { skipped.push(`${key} (${missing.join(", ")})`); continue }
        rows[key] = fix(key, en)
        used++
    }
    fs.writeFileSync(OUT, JSON.stringify({
        _note: "Whole rows put in place by scripts/apply_cn_translations.cjs: table -> key -> text. Built by scripts/gen_cn_global_rows.cjs (global's English where it fits the CN piece).",
        tables: { [TABLE]: rows },
    }, null, 1))
    console.log(`Wrote ${OUT}: ${used} pieces from global; ${skipped.length} kept (global names values CN lacks): ${skipped.join("; ")}`)
})().catch(e => { console.error(e); process.exit(1) })
