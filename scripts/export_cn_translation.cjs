// Exports GlobalPoint's English for the CN client as a standalone package other CN-based projects can
// apply with their own tools: every table cell the translation changed, with its Chinese next to its
// English, plus flat dictionaries. Built from the finished English tables (CN_TRANSLATED_DIR and the
// files its files.json lists) compared with the CN game files (CN_CDN_DIR), so global's own wording
// that the build takes from global's files is included too. Only cells whose CN text has Chinese
// characters are exported: dates, numbers, ids and asset paths are never in it.
//
//   node scripts/export_cn_translation.cjs <out dir> [--schema <master_schema dir>]
//   --schema: a folder of master_schema/*_schema.amf3 files, used only to name more tables
//   -> <out dir>/tables/<name>.json, dictionary.json, names.json, app_strings.json, manifest.json
const fs = require("fs")
const path = require("path")
const unzipper = require("unzipper")
const { cnZips, cnDir, cnTextDir } = require("./cn_archives.cjs")
const { decodeFile, leaves } = require("./cdn_rows.cjs")
const { recordsOf, isCnText } = require("./gen_cn_text.cjs")
const { uploadPath } = require("./cdn_hash.cjs")

const ROOT = path.join(__dirname, "..")
const args = process.argv.slice(2)
const outDir = args[0]
if (!outDir || outDir.startsWith("--")) throw new Error("usage: export_cn_translation.cjs <out dir> [--schema <master_schema dir>]")
const schemaAt = args.indexOf("--schema")
const schemaDir = schemaAt >= 0 ? args[schemaAt + 1] : null

/** Logical table names this repo knows (and a schema folder's), by hashed path. */
function tableNames() {
    const names = new Set()
    const scan = dir => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, f.name)
            if (f.isDirectory()) { if (f.name !== "node_modules") scan(p) }
            else if (/\.(c?js|ts|json)$/.test(f.name)) for (const m of fs.readFileSync(p, "utf8").matchAll(/master\/[a-z0-9_/]+\.orderedmap/g)) names.add(m[0])
        }
    }
    for (const d of ["scripts", "src"]) scan(path.join(ROOT, d))
    const catalog = path.join(ROOT, "assets", "event_catalog_cn.json")
    if (fs.existsSync(catalog)) for (const n of Object.values(JSON.parse(fs.readFileSync(catalog, "utf8")).tables ?? {})) names.add(n)
    if (schemaDir) {
        const walk = dir => {
            for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, f.name)
                if (f.isDirectory()) walk(p)
                else if (f.name.endsWith("_schema.amf3")) names.add("master/" + path.relative(schemaDir, p).split(path.sep).join("/").replace(/_schema\.amf3$/, ".orderedmap"))
            }
        }
        walk(schemaDir)
    }
    return new Map([...names].map(n => [uploadPath(n), n]))
}

/** The CN game's own copy of each wanted file (newest archive wins, as the game sees it), else the slim folder's. */
async function cnOriginals(wanted) {
    const found = new Map()
    for (const zip of cnZips()) {
        for (const e of (await unzipper.Open.file(zip)).files) {
            if (e.type !== "File") continue
            const p = e.path.split("\\").join("/")
            const key = p.startsWith("production/") ? p : "production/" + p
            if (wanted.has(key)) found.set(key, e)
        }
    }
    const out = new Map()
    for (const key of wanted) {
        if (found.has(key)) out.set(key, await found.get(key).buffer())
        else {
            const slim = path.join(cnDir(), "tables", key)
            if (fs.existsSync(slim)) out.set(key, fs.readFileSync(slim))
        }
    }
    return out
}

const rowsOf = buf => {
    const rows = new Map()
    for (const { path: keys, leaf } of leaves(decodeFile(buf))) rows.set(keys.join("/"), leaf.text)
    return rows
}

;(async () => {
    const listFile = path.join(cnTextDir(), "files.json")
    const list = JSON.parse(fs.readFileSync(listFile, "utf8")).filter(f => f.from !== "global")
    const names = tableNames()
    const originals = await cnOriginals(new Set(list.map(f => f.path)))
    fs.rmSync(path.join(outDir, "tables"), { recursive: true, force: true })
    fs.mkdirSync(path.join(outDir, "tables"), { recursive: true })

    const pairs = new Map() // Chinese cell -> Map(English -> count)
    const stats = { tablesWithText: 0, cells: 0, rowsSkipped: 0, notInCn: 0, notDecoded: 0 }
    const index = []
    for (const f of list) {
        const cn = originals.get(f.path)
        if (!cn) { stats.notInCn++; continue }
        let zhRows, enRows
        try { zhRows = rowsOf(cn); enRows = rowsOf(fs.readFileSync(f.from)) } catch { stats.notDecoded++; continue }
        const cells = {}
        let count = 0
        for (const [key, zhText] of zhRows) {
            const enText = enRows.get(key)
            if (enText === undefined || enText === zhText || !isCnText(zhText)) continue
            // the parser's empty record after a final line break isn't a row
            const records = text => recordsOf(text).filter(r => !(r.length === 1 && r[0] === ""))
            const zh = records(zhText), en = records(enText)
            if (zh.length !== en.length || zh.some((r, i) => r.length !== en[i].length)) { stats.rowsSkipped++; continue }
            const one = zh.length === 1
            zh.forEach((rec, r) => rec.forEach((z, c) => {
                const e = en[r][c]
                if (z === e || !isCnText(z)) return
                ;(cells[key] ??= {})[one ? String(c) : `${r}:${c}`] = { zh: z, en: e }
                count++
                const seen = pairs.get(z) ?? new Map()
                seen.set(e, (seen.get(e) ?? 0) + 1)
                pairs.set(z, seen)
            }))
        }
        if (count === 0) continue
        const logical = names.get(f.path) ?? null
        const fileName = (logical ?? f.path).replace(/\.orderedmap$/, "").split("/").join("__") + ".json"
        fs.writeFileSync(path.join(outDir, "tables", fileName), JSON.stringify({ table: logical, file: f.path, cells }, null, 1))
        index.push({ table: logical, file: f.path, json: "tables/" + fileName, rows: Object.keys(cells).length, cells: count })
        stats.tablesWithText++; stats.cells += count
    }

    // one English per Chinese cell; where the translation differs by context, the most used one (all listed)
    const dictionary = {}, contextual = {}
    for (const [zh, ens] of [...pairs].sort((a, b) => a[0].localeCompare(b[0]))) {
        const sorted = [...ens].sort((a, b) => b[1] - a[1])
        dictionary[zh] = sorted[0][0]
        if (sorted.length > 1) contextual[zh] = sorted.map(([en]) => en)
    }
    const write = (name, data) => fs.writeFileSync(path.join(outDir, name), JSON.stringify(data, null, 1))
    write("dictionary.json", { _note: "Chinese cell text -> English, from every exported cell. 'contextual' lists texts translated more than one way (the tables say which applies where).", strings: dictionary, contextual })
    write("names.json", JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "translations", "cn_names.json"), "utf8")))
    const app = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "translations", "cn_app.json"), "utf8"))
    write("app_strings.json", { _note: "Chinese text built into the CN app's code (SWF string constants) -> English.", strings: app.strings })
    write("manifest.json", { built: new Date().toISOString(), ...stats, dictionary: Object.keys(dictionary).length, contextual: Object.keys(contextual).length, tables: index.sort((a, b) => (a.table ?? a.file).localeCompare(b.table ?? b.file)) })
    console.log(stats, "dictionary", Object.keys(dictionary).length, "contextual", Object.keys(contextual).length)
})()
