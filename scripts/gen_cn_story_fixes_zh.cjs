// The story scripts CN's own files cut short (assets/cn_story_fixes, shipped whole in global's English), complete in
// Chinese for the game in Chinese: from 晓之车's CN tables (their "intermediate.zip", 2026-11-22), which have every line
// (the same rows as global's complete copies, checked row by row: same speakers and commands). Line endings ("\r")
// are taken out. The update builder ships these instead of the English copies when the game is set to Chinese.
//
//   node scripts/gen_cn_story_fixes_zh.cjs <their intermediate.zip or folder>   -> assets/cn_story_fixes_zh/
const fs = require("fs")
const path = require("path")
const unzipper = require("unzipper")
const R = require("./cdn_rows.cjs")
const { recordsOf } = require("./gen_cn_text.cjs")

const ROOT = path.join(__dirname, "..")
const OUT = path.join(ROOT, "assets", "cn_story_fixes_zh")
const index = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "cn_story_fixes", "index.json"), "utf8")).files

async function theirFile(source, logical) {
    if (fs.statSync(source).isDirectory()) {
        const f = path.join(source, "intermediate", logical)
        return fs.existsSync(f) ? fs.readFileSync(f) : null
    }
    const entry = (await unzipper.Open.file(source)).files.find(e => e.path.split("\\").join("/").endsWith("intermediate/" + logical))
    return entry ? entry.buffer() : null
}

;(async () => {
    const source = process.argv[2]
    if (!source || !fs.existsSync(source)) throw new Error("usage: gen_cn_story_fixes_zh.cjs <their intermediate.zip or folder>")
    fs.rmSync(OUT, { recursive: true, force: true })
    fs.mkdirSync(OUT, { recursive: true })
    const files = {}
    for (const [stored, info] of Object.entries(index)) {
        const buf = await theirFile(source, info.table)
        if (!buf) throw new Error(`${info.table}: not in their tables`)
        const root = R.decodeFile(buf)
        const english = new Map(R.leaves(R.decodeFile(fs.readFileSync(path.join(ROOT, "assets", "cn_story_fixes", info.file)))).map(({ path: k, leaf }) => [k.join("/"), leaf.text]))
        let rows = 0
        for (const { path: k, leaf } of R.leaves(root)) {
            const key = k.join("/")
            if (!english.has(key)) throw new Error(`${info.table} ${key}: a row global's complete copy doesn't have`)
            R.setLeafText(leaf, leaf.text.replace(/\r/g, ""))
            rows++
        }
        if (rows !== english.size) throw new Error(`${info.table}: ${rows} rows, global's complete copy has ${english.size}`)
        fs.writeFileSync(path.join(OUT, info.file), R.encodeFile(root))
        files[stored] = { table: info.table, file: info.file, rows }
    }
    fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({
        _note: "Built by scripts/gen_cn_story_fixes_zh.cjs: the story scripts CN cut short, complete in Chinese from 晓之车's CN tables, shipped instead of assets/cn_story_fixes when the game is set to Chinese.",
        credit: "晓之车 (Chinese community), 2026-11-22",
        files,
    }, null, 1) + "\n")
    console.log(`${Object.keys(files).length} stories, ${Object.values(files).reduce((n, f) => n + f.rows, 0)} rows -> ${path.relative(process.cwd(), OUT)}`)
})().catch(e => { console.error(e.stack || e.message); process.exit(1) })
