// Merges every StarPoint CN patch in .cdn/cn_patches into one: the newest copy of each file, as one
// update from CN's own 1.4.54 to the newest version number. A new player then downloads the CN base
// files plus this one patch instead of every patch built over time (files later patches replaced are
// left out). Patches built afterwards (dashboard schedule changes) continue from the next number.
// Used when packaging a release (the packaged copy, not the working folder); it replaces the folder's
// patches and patches.json.
//
//   node scripts/squash_cn_patches.cjs
const fs = require("fs")
const path = require("path")
const unzipper = require("unzipper")
const { build } = require("./build_cn_patch.cjs")

const ROOT = path.join(__dirname, "..")
const { cdnDir } = require("./cn_archives.cjs")
const DIR = path.join(cdnDir(), "cn_patches")
const TMP = path.join(cdnDir(), "cn_patches_squash")
const BASE = "1.4.54"
const cmp = (a, b) => a.split(".").map(Number).reduce((r, x, i) => r || x - Number(b.split(".")[i] || 0), 0)

;(async () => {
    const listFile = path.join(DIR, "patches.json")
    const patches = JSON.parse(fs.readFileSync(listFile, "utf8")).sort((a, b) => cmp(a.version, b.version))
    if (patches.length === 0) throw new Error("no patches to squash")
    const newestVersion = patches[patches.length - 1].version
    if (patches.length === 1 && patches[0].from === BASE) { console.log(`already one patch (${newestVersion})`); return }

    // newest copy of every file: later patches win
    const newest = new Map()
    for (const p of patches) for (const a of p.archives) {
        const zipFile = path.join(DIR, a.file)
        if (!fs.existsSync(zipFile)) throw new Error(`${p.version}: ${a.file} is missing`)
        for (const e of (await unzipper.Open.file(zipFile)).files) if (e.type === "File") newest.set(e.path.split("\\").join("/"), e)
    }
    console.log(`${patches.length} patches (${patches[0].version} .. ${newestVersion}), ${newest.size} distinct files`)

    fs.rmSync(TMP, { recursive: true, force: true })
    const list = []
    let n = 0
    for (const [p, e] of [...newest].sort(([a], [b]) => a.localeCompare(b))) {
        const out = path.join(TMP, p)
        fs.mkdirSync(path.dirname(out), { recursive: true })
        fs.writeFileSync(out, await e.buffer())
        list.push({ path: p, from: out })
        if (++n % 2000 === 0) console.log(`  extracted ${n}/${newest.size}`)
    }

    // replace the old patches with the merged one
    for (const p of patches) fs.rmSync(path.join(DIR, p.version), { recursive: true, force: true })
    fs.writeFileSync(listFile, "[]")
    await build(newestVersion, BASE, list)
    fs.rmSync(TMP, { recursive: true, force: true })
})().catch(e => { console.error(e); process.exit(1) })
