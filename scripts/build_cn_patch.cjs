// Builds a game-file update for the CN client (an update step after CN's own 1.4.54, served by
// StarPoint, see src/lib/cnClient.ts): zips of hashed CDN files, ~20 MB each like the official ones,
// in .cdn/cn_patches/<version>/, listed in .cdn/cn_patches/patches.json.
//
//   node scripts/build_cn_patch.cjs <version> <from version> <files.json>
//     files.json: [{ "path": "production/upload/ab/cdef...", "from": "global" | "<local file>" }, ...]
//       "global" = the file from global's CDN (.cdn/en), with its translation mod files on top
//   e.g. node scripts/build_cn_patch.cjs 1.4.55 1.4.54 globalize.json
//
// Building a version again replaces it (and every version after it stays listed).
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { zip } = require("./gen_translation_mod.cjs")
const { readHashedFile } = require("./cdn_rows.cjs")

const ROOT = path.join(__dirname, "..")
const OUT = path.join(ROOT, ".cdn", "cn_patches")
const LIMIT = 20 * 1024 * 1024

// global's translation mod overrides some hashed files
let modFiles = null
async function globalFile(hashedPath) {
    if (modFiles === null) {
        modFiles = new Map()
        const modZip = path.join(ROOT, ".cdn", "mods", "translations.zip")
        if (fs.existsSync(modZip)) {
            const unzipper = require("unzipper")
            const dir = await unzipper.Open.file(modZip)
            for (const f of dir.files) if (f.type === "File") modFiles.set(f.path, f)
        }
    }
    const mod = modFiles.get(hashedPath)
    if (mod) return await mod.buffer()
    const entry = (await globalIndex()).get(hashedPath)
    if (entry) return await entry.buffer()
    return await readHashedFile(hashedPath)
}

// every global archive (common, medium, android; not iOS), newest copy of each file winning
let globalIndexCache = null
async function globalIndex() {
    if (globalIndexCache) return globalIndexCache
    const unzipper = require("unzipper")
    const dir = path.join(ROOT, ".cdn", "en")
    const ver = n => (n.match(/-(\d+\.\d+\.\d+)-\d+-[0-9a-f]+\.zip$/) || [])[1] || "0"
    const cmp = (a, b) => a.split(".").map(Number).reduce((r, x, i) => r || x - Number(b.split(".")[i] || 0), 0)
    const zips = []
    for (const sub of fs.readdirSync(dir)) {
        if (!sub.startsWith("archive-") || sub.includes("ios")) continue
        for (const z of fs.readdirSync(path.join(dir, sub))) if (z.endsWith(".zip")) zips.push({ file: path.join(dir, sub, z), full: sub.endsWith("-full"), v: ver(z) })
    }
    zips.sort((a, b) => (a.full === b.full ? cmp(a.v, b.v) : a.full ? -1 : 1))
    const map = new Map()
    for (const z of zips) for (const e of (await unzipper.Open.file(z.file)).files) if (e.type === "File") map.set(e.path, e)
    globalIndexCache = map
    return map
}

async function build(version, fromVersion, list) {
    const dir = path.join(OUT, version)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(path.join(dir, "archive-common-diff"), { recursive: true })
    const archives = []
    let batch = [], batchSize = 0
    const flush = () => {
        if (batch.length === 0) return
        const data = zip(batch)
        const hex = crypto.createHash("sha1").update(data).digest("hex").slice(0, 8)
        const name = `archive-common-diff/pinball-${fromVersion}-${version}-${archives.length + 1}-${hex}.zip`
        fs.writeFileSync(path.join(dir, name), data)
        archives.push({ file: `${version}/${name}`, size: data.length, sha256: crypto.createHash("sha256").update(data).digest("base64") })
        batch = []; batchSize = 0
    }
    let done = 0
    for (const entry of list) {
        const data = entry.from === "global" ? await globalFile(entry.path) : fs.readFileSync(entry.from)
        if (!data) throw new Error(`no data for ${entry.path}`)
        batch.push({ name: entry.path, data })
        batchSize += data.length
        if (batchSize >= LIMIT) flush()
        if (++done % 2000 === 0) console.log(`  ${done}/${list.length}`)
    }
    flush()

    const listFile = path.join(OUT, "patches.json")
    const patches = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, "utf8")) : []
    const kept = patches.filter(p => p.version !== version)
    kept.push({ version, from: fromVersion, files: list.length, archives })
    kept.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
    fs.writeFileSync(listFile, JSON.stringify(kept, null, 1))
    console.log(`${version} (after ${fromVersion}): ${list.length} files in ${archives.length} archive(s), ${(archives.reduce((s, a) => s + a.size, 0) / 1e6).toFixed(1)} MB`)
}

if (require.main === module) {
    const [version, fromVersion, listPath] = process.argv.slice(2)
    if (!version || !fromVersion || !listPath) throw new Error("usage: build_cn_patch.cjs <version> <from version> <files.json>")
    build(version, fromVersion, JSON.parse(fs.readFileSync(listPath, "utf8"))).catch(e => { console.error(e); process.exit(1) })
}

module.exports = { build, globalFile }
