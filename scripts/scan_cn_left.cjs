// Lists the Chinese text still left in the final CN text folder, unit tables included.
//   node scripts/scan_cn_left.cjs <merged dir (text8)> <final dir (textN)> <out.json>
const fs = require("fs")
const path = require("path")
const unzipper = require("unzipper")
const { cnZips } = require("./cn_archives.cjs")
const R = require("./cdn_rows.cjs")
const { recordsOf, isCnText } = require("./gen_cn_text.cjs")
const ROOT = path.join(__dirname, "..")

;(async () => {
    const [mergedDir, finalDir, outFile] = process.argv.slice(2)
    const names = JSON.parse(fs.readFileSync("F:/WF client/globalize/table_names.json", "utf8"))
    const merged = new Map(JSON.parse(fs.readFileSync(path.join(mergedDir, "files.json"), "utf8")).map(f => [f.path, f.from]))
    const final = new Map(JSON.parse(fs.readFileSync(path.join(finalDir, "files.json"), "utf8")).map(f => [f.path, f.from]))
    const glE = new Map(fs.readFileSync(path.join(ROOT, ".cdn/en/entities/2.1.125-android_medium.csv"), "utf8").split("\n").map(l => { const p = l.split(","); return [p[0], p[3]] }))
    const cnE = fs.readFileSync("D:/WF client/.cdn/cn/entities/10939-android_medium.csv", "utf8").split("\n").map(l => l.split(",")).filter(p => p.length >= 4)
    const candidates = cnE.filter(p => glE.get(p[0]) !== p[3]).map(p => p[0])
    const cn = new Map()
    for (const z of cnZips()) for (const e of (await unzipper.Open.file(z)).files) if (e.type === "File") cn.set(e.path, e)
    const out = {}
    for (const k of candidates) {
        const from = final.get(k) ?? merged.get(k)
        const src = from ? fs.readFileSync(from) : await cn.get(k)?.buffer()
        if (!src) continue
        let root
        try { root = R.decodeFile(src) } catch { continue }
        const name = names[k] ?? k
        for (const { path: keyPath, leaf } of R.leaves(root)) {
            if (!/[\u3400-\u9fff]/.test(leaf.text)) continue
            for (const rec of recordsOf(leaf.text)) rec.forEach((v, i) => {
                if (!isCnText(v)) return
                const t = (out[name] ??= { count: 0, samples: [] })
                t.count++
                if (t.samples.length < 6) t.samples.push(`${keyPath.join("/")} c${i}: ${v.slice(0, 80)}`)
            })
        }
    }
    const sorted = Object.fromEntries(Object.entries(out).sort((a, b) => b[1].count - a[1].count))
    fs.writeFileSync(outFile, JSON.stringify(sorted, null, 1))
    for (const [n, t] of Object.entries(sorted)) console.log(t.count, n)
})()
