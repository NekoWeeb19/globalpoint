// Builds a slim CN game-files folder for a server that doesn't keep the 10 GB of CN archives (the phone
// companion, once the game has its files): everything the dashboard's schedule changes and the server
// read from CN's files, without the art and sound.
//   <out>/path, <out>/entities/   CN's file list and index (as in the full folder)
//   <out>/tables/production/...   every CN data table (orderedmap), the newest original copy
//   <out>/names.txt               every file in CN's archives as "xx/hash" (folder left out), for picture checks
// Point CN_CDN_DIR at <out>: scripts/cn_read.cjs and scripts/gen_cn_event_schedule.cjs use tables/ and
// names.txt when there are no archives.
//
//   node scripts/gen_cn_slim.cjs <out folder>
const fs = require("fs")
const path = require("path")
const unzipper = require("unzipper")
const { cnDir, cnZips } = require("./cn_archives.cjs")

const OUT = process.argv[2]
if (!OUT) throw new Error("usage: gen_cn_slim.cjs <out folder>")
const CN = cnDir()
if (path.resolve(OUT) === path.resolve(CN)) throw new Error("write the slim folder somewhere else than the full CN folder")

/** Whether a file is an orderedmap table (the format scripts/cdn_rows.cjs reads), from its first bytes. */
function isTable(buf) {
    if (buf.length < 8) return false
    const indexLength = buf.readUInt32LE(0)
    if (indexLength < 4 || 4 + indexLength > buf.length) return false
    try { require("zlib").inflateSync(buf.subarray(4, 4 + indexLength)); return true } catch { return false }
}

;(async () => {
    fs.mkdirSync(path.join(OUT, "entities"), { recursive: true })
    fs.copyFileSync(path.join(CN, "path"), path.join(OUT, "path"))
    for (const f of fs.readdirSync(path.join(CN, "entities"))) fs.copyFileSync(path.join(CN, "entities", f), path.join(OUT, "entities", f))

    const names = new Set()
    const tables = new Map() // path -> entry (newest wins: cnZips is oldest first)
    for (const z of cnZips()) {
        const common = path.basename(path.dirname(z)).startsWith("archive-common")
        for (const e of (await unzipper.Open.file(z)).files) {
            if (e.type !== "File") continue
            const p = e.path.split("\\").join("/")
            names.add(p.replace(/^production\/[a-z_]+\//, ""))
            // tables are in the common archives, and small; check the format to tell them from art
            if (common && e.uncompressedSize < 64 * 1024 * 1024) tables.set(p, e)
        }
    }
    let kept = 0, bytes = 0
    for (const [p, e] of tables) {
        const buf = await e.buffer()
        if (!isTable(buf)) continue
        const out = path.join(OUT, "tables", p)
        fs.mkdirSync(path.dirname(out), { recursive: true })
        fs.writeFileSync(out, buf)
        kept++; bytes += buf.length
    }
    fs.writeFileSync(path.join(OUT, "names.txt"), [...names].sort().join("\n"))
    console.log(`${kept} tables (${(bytes / 1e6).toFixed(1)} MB), ${names.size} file names -> ${OUT}`)
})().catch(e => { console.error(e); process.exit(1) })
