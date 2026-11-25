// Chinese fixes from the Chinese community (晓之车's CN tables, "intermediate.zip", 2026-11-22), for the game in Chinese
// (scripts/game_language.cjs, scripts/cn_language.cjs). Their tables are CN's with their own edits; two kinds are taken:
// - cells CN left in Japanese that they wrote in Chinese (stories of events CN never ran, items, shops, missions...);
// - their rewordings of CN's own Chinese (e.g. the Lv labels, voice actors' names in Chinese characters).
// Only on the same row as CN's: every cell that isn't text (ids, numbers, paths) must match, dates aside. Their tables
// also have rows of their own and rows that moved; those are left out. A cell changes only while CN's own copy still has
// the text it was made from.
// One rule from their edits: 生命值 -> HP in game text (skills, abilities, UI, titles, missions), where they changed every
// one; unit profile text (character_text) keeps 生命值, as they did.
//
//   node --env-file=.env scripts/gen_cn_zh_fixes.cjs <their intermediate.zip or folder>   -> assets/cn_zh_fixes.json
const fs = require("fs")
const path = require("path")
const unzipper = require("unzipper")
const R = require("./cdn_rows.cjs")
const { readCn } = require("./cn_read.cjs")
const { recordsOf } = require("./gen_cn_text.cjs")
const { uploadPath } = require("./cdn_hash.cjs")

const HAN = /[\u3400-\u9fff]/, KANA = /[\u3040-\u30ff]/
const DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
const isText = s => HAN.test(s) || KANA.test(s)
const OUT = path.join(__dirname, "..", "assets", "cn_zh_fixes.json")
const RULES = [{ from: "生命值", to: "HP", except: ["master/character/character_text.orderedmap"] }]

/** Their tables: logical path -> Buffer (from the zip or an unpacked folder; "intermediate/" is their top folder). */
async function theirTables(source) {
    const out = new Map()
    const add = (name, read) => {
        const m = /(?:^|\/)intermediate\/(master\/.+\.orderedmap)$/.exec(name.split("\\").join("/"))
        if (m) out.set(m[1], read)
    }
    if (fs.statSync(source).isDirectory()) {
        const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else add(f, () => fs.readFileSync(f)) } }
        walk(source)
    } else {
        for (const e of (await unzipper.Open.file(source)).files) if (e.type === "File") add(e.path, () => e.buffer())
    }
    return out
}

;(async () => {
    const source = process.argv[2]
    if (!source || !fs.existsSync(source)) throw new Error("usage: gen_cn_zh_fixes.cjs <their intermediate.zip or folder>")
    const cells = {}
    let fromJapanese = 0, rewordings = 0, otherRows = 0
    for (const [logical, read] of await theirTables(source)) {
        let theirs
        try { theirs = R.decodeFile(await read()) } catch { continue }
        const cnBuf = await readCn(logical, { raw: true })
        if (!cnBuf) continue
        const cn = new Map(R.leaves(R.decodeFile(cnBuf)).map(({ path: k, leaf }) => [k.join("/"), leaf.text]))
        const stored = uploadPath(logical)
        for (const { path: k, leaf } of R.leaves(theirs)) {
            const key = k.join("/"), c = cn.get(key)
            if (c === undefined) continue
            const a = recordsOf(leaf.text.replace(/\r/g, "")), b = recordsOf(c.replace(/\r/g, ""))
            if (a.length !== b.length) continue
            for (let r = 0; r < a.length; r++) {
                if (a[r].length !== b[r].length) continue
                const sameRow = a[r].every((x, i) => isText(x) || isText(b[r][i]) || x.trim() === b[r][i].trim() || (DATE.test(x.trim()) && DATE.test(b[r][i].trim())))
                for (let i = 0; i < a[r].length; i++) {
                    const zh = a[r][i].trim(), was = b[r][i].trim()
                    if (zh === was || !HAN.test(zh) || KANA.test(zh) || !isText(was)) continue
                    if (!sameRow) { otherRows++; continue }
                    ;((cells[stored] ??= {})[key] ??= {})[`${r}:${i}`] = [was, zh]
                    if (KANA.test(was)) fromJapanese++; else rewordings++
                }
            }
        }
    }
    const rules = RULES.map(rule => ({ ...rule, except: rule.except.map(uploadPath) }))
    fs.writeFileSync(OUT, JSON.stringify({
        _note: "Built by scripts/gen_cn_zh_fixes.cjs from 晓之车's CN tables: Chinese for cells CN left in Japanese, and their rewordings of CN's Chinese, applied when the game is set to Chinese (cells: table -> row key -> \"record:column\" -> [CN's text, theirs]). rules: term changes for every table but the excepted ones.",
        credit: "晓之车 (Chinese community), 2026-11-22",
        cells, rules,
    }, null, 1) + "\n")
    console.log(`${fromJapanese} cells from Japanese, ${rewordings} rewordings in ${Object.keys(cells).length} tables (${otherRows} on other rows left out); ${rules.length} rule(s) -> ${path.relative(process.cwd(), OUT)}`)
})().catch(e => { console.error(e.stack || e.message); process.exit(1) })
