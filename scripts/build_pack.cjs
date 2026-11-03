// Makes packs for the phone companion app's "Import pack..." button (Game data), for phone players
// without a PC on the same Wi-Fi. A pack is one zip of stored entries (images and zips don't compress)
// at the paths the companion's data folder needs, after a first entry that says what it is.
//
//   node scripts/build_pack.cjs comics <out.zip> [--from <server folder>] [--comics <folder>]
//     <CDN_DIR>/comics as .cdn/comics/... (~1.4 GB). Marker: starpoint-comics-pack.json
//   node scripts/build_pack.cjs data <out.zip> [--from <server folder>] [--slim <folder>]
//     what "Download from PC" brings, without the save and the full game files (~1.8 GB): the CN version
//     files (path, entities csv), the slim CN tables + names.txt (schedule edits), the English tables,
//     StarPoint's patch zips (a game older than the newest patch downloads them; schedule rebuilds read
//     their art), the schedule files the server made (cn_schedule_files), dashboard pictures, and the
//     schedule/news files in .database. Never the save, account files or .env. Marker:
//     starpoint-data-pack.json, which also lists what the pack replaces on the phone (so leftovers of
//     earlier schedule edits there are removed).
//
// --from: the server folder whose .env (CDN_DIR, CN_CDN_DIR, CN_TRANSLATED_DIR, CN_SLIM_DIR; relative
// paths are from that folder) and .database are used; default: this checkout. Build the shareable data
// pack from a clean package (e.g. the shared release folder), not a personal server with your own
// schedule edits. --slim: the slim CN folder (tables/ + names.txt, from scripts/gen_cn_slim.cjs) when
// CN_CDN_DIR isn't slim and CN_SLIM_DIR isn't set. Prints the pack's size and SHA-256.
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const zlib = require("zlib")

const args = process.argv.slice(2)
const kind = args.shift(), out = args.shift()
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
if (!["comics", "data"].includes(kind) || !out) {
    console.error("usage: node scripts/build_pack.cjs comics|data <out.zip> [--from <server folder>] [--slim <folder>] [--comics <folder>]")
    process.exit(1)
}

// the server folder's settings, the way the server reads them
const from = path.resolve(opt("from") || path.join(__dirname, ".."))
const env = {}
try {
    for (const line of fs.readFileSync(path.join(from, ".env"), "utf8").split(/\r?\n/)) {
        const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/.exec(line)
        if (m) env[m[1]] = m[2]
    }
} catch { }
const setting = key => process.env[key] ?? env[key]
const at = (value, fallback) => path.resolve(from, value || fallback)
const cdn = at(setting("CDN_DIR"), ".cdn")
const cnRoot = at(setting("CN_CDN_DIR"), path.join(cdn, "cn"))
const isSlim = dir => dir && fs.existsSync(path.join(dir, "tables")) && fs.existsSync(path.join(dir, "names.txt"))

// [zip path, file]
const files = []
function addFile(zipPath, file) {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) files.push([zipPath, file])
    else return false
    return true
}
function addTree(zipPath, dir) {
    if (!fs.existsSync(dir)) return false
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) addTree(`${zipPath}/${entry.name}`, file)
        else if (entry.isFile()) files.push([`${zipPath}/${entry.name}`, file])
    }
    return true
}
const need = (ok, what) => { if (!ok) { console.error(`Missing: ${what}`); process.exit(1) } }

let marker
if (kind === "comics") {
    const comics = path.resolve(opt("comics") || path.join(cdn, "comics"))
    need(addTree(".cdn/comics", comics), `comics folder ${comics}`)
    marker = { name: "starpoint-comics-pack.json", info: { kind: "starpoint-comics-pack", version: 1 } }
} else {
    need(addFile(".cdn/cn/path", path.join(cnRoot, "path")), `${path.join(cnRoot, "path")} (CN_CDN_DIR)`)
    const entities = path.join(cnRoot, "entities")
    const csv = fs.existsSync(entities) ? fs.readdirSync(entities).find(f => /android_medium\.csv$/.test(f)) : undefined
    need(csv && addFile(`.cdn/cn/entities/${csv}`, path.join(entities, csv)), `${entities}/*android_medium.csv`)
    const slim = [opt("slim") && path.resolve(opt("slim")), cnRoot, setting("CN_SLIM_DIR") && at(setting("CN_SLIM_DIR")), path.join(cdn, "cn_slim")].find(isSlim)
    need(slim, "a slim CN folder (tables/ + names.txt): pass --slim, or make one with node scripts/gen_cn_slim.cjs")
    addFile(".cdn/cn/names.txt", path.join(slim, "names.txt"))
    addTree(".cdn/cn/tables", path.join(slim, "tables"))
    const translated = at(setting("CN_TRANSLATED_DIR"), path.join(cdn, "cn_text"))
    need(addTree(".cdn/cn_text", translated), `English CN tables ${translated} (CN_TRANSLATED_DIR)`)
    const patches = path.join(cdn, "cn_patches")
    need(fs.existsSync(path.join(patches, "patches.json")) && addTree(".cdn/cn_patches", patches), `${patches}/patches.json`)
    addTree(".cdn/cn_schedule_files", path.join(cdn, "cn_schedule_files"))
    addTree(".cdn/dashboard_images", path.join(cdn, "dashboard_images"))
    // only these .database files (schedules and news), never the save or account files
    // the build record and its by-products go too (the pack has none), so the phone rebuilds the CN update on start:
    // its own earlier updates are removed with .cdn/cn_patches
    const schedules = ["news.json", "event_schedule.json", "campaign_schedule.json", "cn_copy_window.json", "banner_rotation.json", "cn_schedule_built.json", "cn_event_windows.json", "cn_mb2_dates.json"]
    for (const name of schedules) addFile(`.database/${name}`, path.join(from, ".database", name))
    const list = JSON.parse(fs.readFileSync(path.join(patches, "patches.json"), "utf8"))
    const newest = list.map(p => p.version).sort((a, b) => {
        const pa = a.split(".").map(Number), pb = b.split(".").map(Number)
        for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
        return 0
    }).pop()
    marker = {
        name: "starpoint-data-pack.json",
        info: {
            kind: "starpoint-data-pack", version: 1, gameFilesVersion: newest,
            // on the phone: these .database files are replaced (or removed when the pack has none: the
            // server's defaults), and files in these folders that the pack doesn't hold are removed
            replaces: { database: schedules, folders: [".cdn/cn/tables", ".cdn/cn_text", ".cdn/cn_patches", ".cdn/cn_schedule_files", ".generated"] },
        },
    }
}
const bytes = files.reduce((n, [, file]) => n + fs.statSync(file).size, 0)

// ---- the zip: stored entries, utf-8 names, no zip64 (the packs stay under 4 GB) ----
const target = path.resolve(out)
const part = target + ".part"
const fd = fs.openSync(part, "w")
const hash = crypto.createHash("sha256")
let offset = 0
const central = []
function write(buf) { fs.writeSync(fd, buf); hash.update(buf); offset += buf.length }
function add(name, data, mtime) {
    if (offset + data.length > 0xfffffff0) throw new Error("the pack would pass 4 GB (zip64 is not supported)")
    const nameBuf = Buffer.from(name, "utf8"), crc = zlib.crc32(data)
    const d = new Date(mtime)
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28)
    central.push({ nameBuf, crc, size: data.length, dosTime, dosDate, at: offset })
    write(local); write(nameBuf); write(data)
}
try {
    const info = { ...marker.info, files: files.length, bytes, created: new Date().toISOString() }
    add(marker.name, Buffer.from(JSON.stringify(info, null, 1)), Date.now())
    let done = 0
    for (const [name, file] of files) {
        add(name, fs.readFileSync(file), fs.statSync(file).mtimeMs)
        if (++done % 200 === 0) process.stdout.write(`\r${done} / ${files.length} files`)
    }
    const cdStart = offset
    for (const e of central) {
        const c = Buffer.alloc(46)
        c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8)
        c.writeUInt16LE(0, 10); c.writeUInt16LE(e.dosTime, 12); c.writeUInt16LE(e.dosDate, 14)
        c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.size, 20); c.writeUInt32LE(e.size, 24)
        c.writeUInt16LE(e.nameBuf.length, 28); c.writeUInt32LE(e.at, 42)
        write(c); write(e.nameBuf)
    }
    if (central.length > 0xffff) throw new Error("too many files for a zip without zip64")
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10)
    end.writeUInt32LE(offset - cdStart, 12); end.writeUInt32LE(cdStart, 16)
    write(end)
    fs.closeSync(fd)
    fs.rmSync(target, { force: true })
    fs.renameSync(part, target)
} catch (e) {
    try { fs.closeSync(fd) } catch { }
    fs.rmSync(part, { force: true })
    throw e
}
console.log(`\nWrote ${target} (${kind} pack${marker.info.gameFilesVersion ? `, game files version ${marker.info.gameFilesVersion}` : ""})`)
console.log(`  ${files.length} files from ${from}`)
console.log(`  size   ${offset} bytes (${(offset / 1048576).toFixed(1)} MB)`)
console.log(`  sha256 ${hash.digest("hex")}`)
