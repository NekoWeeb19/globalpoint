// Translates the Chinese left in the CN client's tables after scripts/gen_cn_text.cjs: every Chinese
// cell whose text is in the translation memory (glossary.json, global's own translations) or in
// assets/translations/cn.json (translations made for CN-only text) becomes English. Covers the tables
// both CDNs have (starting from the merged ones) and the tables only CN has. Unit tables (character
// text, speech, stories, skills) are left alone: those only get global's own text.
//
//   node scripts/apply_cn_translations.cjs <merged dir> <out dir>
//   -> <out dir>/production/upload/... (tables that changed vs the merged/CN copy), files.json (the
//      merged tables with these on top, for scripts/build_cn_patch.cjs), todo.json (Chinese still left,
//      { text: [table names] }, unit tables excluded)
const fs = require("fs")
const { cnZips } = require("./cn_archives.cjs")
const path = require("path")
const crypto = require("crypto")
const R = require("./cdn_rows.cjs")
const { recordsOf, isCnText, placeholdersFit } = require("./gen_cn_text.cjs")
const unzipper = require("unzipper")

const ROOT = path.join(__dirname, "..")
const UNIT_TABLE = /character|story_character|speech|scenario|ability|action_skill|episode|degree_character/
// records back to CSV text; the parser's empty record after a final line break isn't a row
const encodeRecords = (recs, trailing) => {
    const rows = recs.length > 0 && recs[recs.length - 1].length === 1 && recs[recs.length - 1][0] === "" ? recs.slice(0, -1) : recs
    return rows.map(r => r.map(R.csvField).join(",")).join("\n") + (trailing ? "\n" : "")
}

async function cnArchives() {
    const map = new Map()
    for (const z of cnZips()) for (const e of (await unzipper.Open.file(z)).files) if (e.type === "File") map.set(e.path, e)
    return map
}

;(async () => {
    const [mergedDir, outDir] = process.argv.slice(2)
    if (!mergedDir || !outDir) throw new Error("usage: apply_cn_translations.cjs <merged dir> <out dir>")
    const glossary = JSON.parse(fs.readFileSync(path.join(mergedDir, "glossary.json"), "utf8"))
    const manualFile = path.join(ROOT, "assets", "translations", "cn.json")
    const manualData = fs.existsSync(manualFile) ? JSON.parse(fs.readFileSync(manualFile, "utf8")) : {}
    const manual = manualData.strings ?? {}
    // cn.json "overrides": used even where the translation memory has another English (it can be
    // wrong for CN's wording, e.g. 妨碍 "Jammer" came out as "Fire Pulse")
    const overrides = manualData.overrides ?? {}
    // whole rows by table and key (assets/translations/cn_rows.json, scripts/gen_cn_global_rows.cjs):
    // global's English for ability text pieces, also ones with no Chinese in them
    const rowsFile = path.join(ROOT, "assets", "translations", "cn_rows.json")
    const rowTexts = fs.existsSync(rowsFile) ? JSON.parse(fs.readFileSync(rowsFile, "utf8")).tables ?? {} : {}
    // hand fixes, applied last (assets/translations/cn_fixes.json): whole rows, and text replacements
    const fixesFile = path.join(ROOT, "assets", "translations", "cn_fixes.json")
    const fixes = fs.existsSync(fixesFile) ? JSON.parse(fs.readFileSync(fixesFile, "utf8")) : {}
    for (const [table, rows] of Object.entries(fixes.rows ?? {})) rowTexts[table] = { ...(rowTexts[table] ?? {}), ...rows }
    const replacements = fixes.replace ?? {}
    // global's English for single Chinese cells (assets/translations/cn_global_cells.json,
    // scripts/gen_cn_global_cells.cjs); the hand-fixed cells win
    const globalCellsFile = path.join(ROOT, "assets", "translations", "cn_global_cells.json")
    const cellFixes = fs.existsSync(globalCellsFile) ? JSON.parse(fs.readFileSync(globalCellsFile, "utf8")).tables ?? {} : {}
    // unit text written for CN's units and skill++ (assets/translations/cn_unit_cells.json,
    // scripts/gen_cn_unit_cells.cjs) goes over global's cells
    const unitCellsFile = path.join(ROOT, "assets", "translations", "cn_unit_cells.json")
    const unitCells = fs.existsSync(unitCellsFile) ? JSON.parse(fs.readFileSync(unitCellsFile, "utf8")).tables ?? {} : {}
    for (const [table, keys] of [...Object.entries(unitCells), ...Object.entries(fixes.cells ?? {})]) for (const [key, cells] of Object.entries(keys))
        ((cellFixes[table] ??= {})[key] = { ...(cellFixes[table]?.[key] ?? {}), ...cells })
    const names = JSON.parse(fs.readFileSync("F:/WF client/globalize/table_names.json", "utf8"))
    const merged = new Map(JSON.parse(fs.readFileSync(path.join(mergedDir, "files.json"), "utf8")).map(f => [f.path, f.from]))

    // which tables: everything CN has that isn't byte-identical to global (shared-but-same files have no Chinese)
    const glE = new Map(fs.readFileSync(path.join(ROOT, ".cdn/en/entities/2.1.125-android_medium.csv"), "utf8").split("\n").map(l => { const p = l.split(","); return [p[0], p[3]] }))
    const cnE = fs.readFileSync("D:/WF client/.cdn/cn/entities/10939-android_medium.csv", "utf8").split("\n").map(l => l.split(",")).filter(p => p.length >= 4)
    const candidates = cnE.filter(p => glE.get(p[0]) !== p[3]).map(p => p[0])
    // tables the hand fixes name are read too, also when they're the same as global's
    for (const t of [...Object.keys(fixes.rows ?? {}), ...Object.keys(replacements), ...Object.keys(cellFixes)]) if (!candidates.includes(t)) candidates.push(t)
    const cn = await cnArchives()
    console.log(`${candidates.length} CN files differ from global; reading tables...`)

    const files = [], todo = {}
    let translated = 0, tables = 0
    for (const k of candidates) {
        const name = names[k] ?? k
        const src = merged.has(k) ? fs.readFileSync(merged.get(k)) : await cn.get(k)?.buffer()
        if (!src) continue
        let root
        try { root = R.decodeFile(src) } catch { continue }
        tables++
        const unit = UNIT_TABLE.test(name)
        let changed = false
        const tableRows = rowTexts[k] ?? {}
        for (const { path: keyPath, leaf } of R.leaves(root)) {
            const rowText = tableRows[keyPath.join("/")]
            if (rowText !== undefined) {
                const text = R.csvField(rowText) + (leaf.text.endsWith("\n") ? "\n" : "")
                if (text !== leaf.text) { R.setLeafText(leaf, text); changed = true; translated++ }
                continue
            }
            if (!/[\u3400-\u9fff]/.test(leaf.text)) continue
            const recs = recordsOf(leaf.text)
            let leafChanged = false
            for (const rec of recs) rec.forEach((v, i) => {
                if (!isCnText(v)) return
                // a memory match must also keep the client's placeholders (see placeholdersFit)
                const fromMemory = glossary[v] !== undefined && placeholdersFit(v, glossary[v]) ? glossary[v] : undefined
                const en = (unit ? undefined : overrides[v]) ?? fromMemory ?? (unit ? undefined : manual[v])
                if (en !== undefined) { rec[i] = en; leafChanged = true; translated++ }
                else if (!unit) (todo[v] ??= new Set()).add(name)
            })
            if (leafChanged) {
                const text = encodeRecords(recs, leaf.text.endsWith("\n"))
                // the row must keep its shape (a broken row stops the client: CSV error U0000)
                const shape = t => recordsOf(t).filter(r => !(r.length === 1 && r[0] === "")).map(r => r.length).join(",")
                if (shape(text) !== shape(leaf.text)) throw new Error(`${name}: a row changed shape (${shape(leaf.text)} -> ${shape(text)})`)
                R.setLeafText(leaf, text)
                changed = true
            }
        }
        // single cells: { key: { column: text } } or { key: { "record:column": text } } (text may hold
        // line breaks; the row is re-encoded)
        for (const { path: keyPath, leaf } of R.leaves(root)) {
            const cells = cellFixes[k]?.[keyPath.join("/")]
            if (!cells) continue
            const recs = recordsOf(leaf.text)
            for (const [at, text] of Object.entries(cells)) {
                const [r, col] = at.includes(":") ? at.split(":").map(Number) : [0, Number(at)]
                if (recs[r] && col < recs[r].length) { recs[r][col] = text; translated++ }
            }
            const text = encodeRecords(recs, leaf.text.endsWith("\n"))
            if (text !== leaf.text) { R.setLeafText(leaf, text); changed = true }
        }
        // [from, to] replaces text; [pattern, to, "re"] is a regular expression (to may use $1...)
        for (const [from, to, kind] of replacements[k] ?? []) for (const { leaf } of R.leaves(root)) {
            const text = kind === "re" ? leaf.text.replace(new RegExp(from, "g"), to) : leaf.text.split(from).join(to)
            if (text === leaf.text) continue
            R.setLeafText(leaf, text)
            changed = true
        }
        if (changed) {
            const file = path.join(outDir, k)
            fs.mkdirSync(path.dirname(file), { recursive: true })
            fs.writeFileSync(file, R.encodeFile(root))
            files.push({ path: k, from: file })
        } else if (merged.has(k)) files.push({ path: k, from: merged.get(k) })
    }
    fs.writeFileSync(path.join(outDir, "files.json"), JSON.stringify(files))
    fs.writeFileSync(path.join(outDir, "todo.json"), JSON.stringify(Object.fromEntries(Object.entries(todo).map(([t, s]) => [t, [...s]]))))
    console.log(`${tables} tables; ${translated} cells translated; ${files.length} tables in the patch; ${Object.keys(todo).length} Chinese texts left (unit tables not counted)`)
})().catch(e => { console.error(e); process.exit(1) })
