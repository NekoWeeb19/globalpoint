// Checks that the game files a player needs are all there (used by setup.bat / setup.sh):
//   - the CN base files' list (.cdn/cn/path) and every Android/common/medium archive it names (size)
//   - StarPoint's patches (.cdn/cn_patches/patches.json): every archive, size and sha256
// With --full the CN base archives' sha256 is checked too (reads ~10 GB, takes a few minutes).
//
//   node scripts/verify_package.cjs [--full]
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { cnDir } = require("./cn_archives.cjs")

const ROOT = path.join(__dirname, "..")
const FULL = process.argv.includes("--full")
const problems = []
const sha256 = file => new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256")
    fs.createReadStream(file).on("data", d => h.update(d)).on("end", () => resolve(h.digest("base64"))).on("error", reject)
})

;(async () => {
    // CN base files
    const base = cnDir(), pathFile = path.join(base, "path")
    let archives = []
    if (!fs.existsSync(pathFile)) problems.push(`missing ${pathFile} (the CN game files' list)`)
    else {
        const list = JSON.parse(fs.readFileSync(pathFile, "utf8"))
        const all = [...(list.full ? [list.full] : []), ...(list.diff ?? [])].flatMap(d => d.archive ?? [])
        archives = all.filter(a => !a.location.includes("/archive-ios-"))
        for (const a of archives) {
            const rel = a.location.replace(/^https?:\/\/[^/]+\//, "").split("/").slice(-2).join("/")
            const file = path.join(base, rel)
            if (!fs.existsSync(file)) { problems.push(`missing CN file ${rel}`); continue }
            if (fs.statSync(file).size !== a.size) { problems.push(`wrong size: CN file ${rel}`); continue }
            if (FULL && a.sha256 && (await sha256(file)) !== a.sha256) problems.push(`damaged CN file ${rel}`)
        }
    }
    // StarPoint's patches
    const patchDir = path.join(ROOT, ".cdn", "cn_patches"), patchList = path.join(patchDir, "patches.json")
    const patches = fs.existsSync(patchList) ? JSON.parse(fs.readFileSync(patchList, "utf8")) : []
    if (patches.length === 0) problems.push("no StarPoint patches (.cdn/cn_patches/patches.json): the game would stay in Chinese")
    for (const p of patches) for (const a of p.archives) {
        const file = path.join(patchDir, a.file)
        if (!fs.existsSync(file)) { problems.push(`missing patch file ${a.file}`); continue }
        if (fs.statSync(file).size !== a.size || (await sha256(file)) !== a.sha256) problems.push(`damaged patch file ${a.file}`)
    }
    const newest = patches.map(p => p.version).pop() ?? "none"
    if (problems.length === 0) {
        console.log(`Game files OK: ${archives.length} CN files${FULL ? " (checksums checked)" : ""}, ${patches.length} StarPoint patch(es) up to ${newest}.`)
        return
    }
    console.log(`Game files: ${problems.length} problem(s):`)
    for (const p of problems.slice(0, 30)) console.log(`  - ${p}`)
    if (problems.length > 30) console.log(`  ... and ${problems.length - 30} more`)
    process.exit(1)
})().catch(e => { console.error(e); process.exit(1) })
