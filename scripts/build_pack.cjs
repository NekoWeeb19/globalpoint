// Makes packs for the phone companion app's "Import pack..." button (Game data), for phone players
// without a PC on the same Wi-Fi. A pack is one zip of stored entries (images and zips don't compress)
// at the paths the companion's data folder needs, after a first entry that says what it is.
//
//   node scripts/build_pack.cjs comics <out.zip> [--from <server folder>] [--comics <folder>]
//     <CDN_DIR>/comics as .cdn/comics/... (~1.4 GB). Marker: starpoint-comics-pack.json
//   node scripts/build_pack.cjs art <out.zip> [--from <server folder>] [--slim <folder>]
//     the Unit editor's skill preview art from the slim CN folder (unit sprites and skill effects in tables/, which
//     scripts/gen_cn_slim.cjs adds by their hashed names, plus preview_art.txt; ~35 MB), for phones that already
//     have the data pack, so the 1.8 GB data pack needn't be downloaded again. Marker: starpoint-art-pack.json.
//     Import it after a data pack: a data pack replaces .cdn/cn/tables and removes what it doesn't hold.
//   node scripts/build_pack.cjs zh-art <out.zip> [--from <server folder>]
//     CN's own pictures for the game in Chinese (docs/CHINESE.md): CN's originals of every picture and sprite layout
//     StarPoint's updates replaced (assets/cn_lang_art.json, ~1.6 GB), from CN's archives (CN_CDN_DIR, not a slim
//     folder), into the slim folder's tables/ by their hashed names, where the update builder reads CN's files.
//     Same marker as the skill preview art pack (starpoint-art-pack.json, content "zh-art"), so the companion's
//     Import pack... takes it; import it after a data pack, like that one. Needs ~1.6 GB free next to <out.zip>
//     while it's made (the pictures are unpacked there first, then removed).
//   node scripts/build_pack.cjs data <out.zip> [--from <server folder>] [--slim <folder>]
//     what "Download from PC" brings, without the save and the full game files (~190 MB): the CN version
//     files (path, entities csv), the slim CN tables + names.txt (schedule edits), the English tables (with their
//     files.json), StarPoint's patch zips after the OBB's game files version (OBB_VERSION: the 3-part OBB holds
//     the ones up to it, so they stay out; the old single OBB isn't supported), the schedule files the server made
//     (cn_schedule_files), dashboard pictures, and the
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

// the game files version the OBB holds (the 3-part OBB): a data pack leaves out the updates up to it
const OBB_VERSION = "1.4.800"

const args = process.argv.slice(2)
const kind = args.shift(), out = args.shift()
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
if (!["comics", "data", "art", "zh-art"].includes(kind) || !out) {
    console.error("usage: node scripts/build_pack.cjs comics|data|art|zh-art <out.zip> [--from <server folder>] [--slim <folder>] [--comics <folder>]")
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
/** Whether a file is an orderedmap table (as scripts/gen_cn_slim.cjs tells them from art). */
function isTable(buf) {
    if (buf.length < 8) return false
    const indexLength = buf.readUInt32LE(0)
    if (indexLength < 4 || 4 + indexLength > buf.length) return false
    try { zlib.inflateSync(buf.subarray(4, 4 + indexLength)); return true } catch { return false }
}
const need = (ok, what) => { if (!ok) { console.error(`Missing: ${what}`); process.exit(1) } }

let marker
if (kind === "comics") {
    const comics = path.resolve(opt("comics") || path.join(cdn, "comics"))
    need(addTree(".cdn/comics", comics), `comics folder ${comics}`)
    marker = { name: "starpoint-comics-pack.json", info: { kind: "starpoint-comics-pack", version: 1 } }
} else if (kind === "zh-art") {
    need(!isSlim(cnRoot), `CN's archives (${cnRoot} is a slim folder): point CN_CDN_DIR at the full CN game files`)
    // CN's originals, unpacked by a child step (reading the archives is async) into a folder next to the pack
    const work = path.resolve(out) + ".files"
    fs.rmSync(work, { recursive: true, force: true })
    const extract = `
        const fs = require("fs"), path = require("path")
        const { readCnOriginals, artPaths } = require(${JSON.stringify(path.join(__dirname, "cn_language.cjs"))})
        ;(async () => {
            const paths = artPaths()
            if (paths.length === 0) throw new Error("assets/cn_lang_art.json is missing (node scripts/gen_cn_lang_art.cjs)")
            const got = await readCnOriginals(process.env.CN_CDN_DIR, paths)
            if (got.size !== paths.length) throw new Error("only " + got.size + " of " + paths.length + " pictures are in CN's files")
            for (const [p, buf] of got) { const f = path.join(${JSON.stringify(work)}, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf) }
            console.log(paths.length + " pictures unpacked")
        })().catch(e => { console.error(e.message); process.exit(1) })`
    require("child_process").execFileSync(process.execPath, ["-e", extract], { stdio: "inherit", env: { ...process.env, CN_CDN_DIR: cnRoot } })
    addTree(".cdn/cn/tables/production", path.join(work, "production"))
    process.on("exit", () => fs.rmSync(work, { recursive: true, force: true }))
    marker = { name: "starpoint-art-pack.json", info: { kind: "starpoint-art-pack", version: 1, content: "zh-art" } }
} else if (kind === "art") {
    const slim = [opt("slim") && path.resolve(opt("slim")), cnRoot, setting("CN_SLIM_DIR") && at(setting("CN_SLIM_DIR")), path.join(cdn, "cn_slim")].find(isSlim)
    need(slim, "a slim CN folder (tables/ + names.txt): pass --slim, or make one with node scripts/gen_cn_slim.cjs")
    const record = path.join(slim, "preview_art.txt")
    need(fs.existsSync(record), `${record} (the slim CN folder has no skill preview art yet: start the server, or run node scripts/gen_cn_slim.cjs)`)
    const [artVersion, artCount] = fs.readFileSync(record, "utf8").split(/\r?\n/).map(Number)
    // the art is what in tables/ isn't a table (scripts/gen_cn_slim.cjs keeps only real tables there besides the art)
    addTree(".cdn/cn/tables", path.join(slim, "tables"))
    const art = files.splice(0).filter(([, file]) => !isTable(fs.readFileSync(file)))
    files.push(...art)
    if (art.length !== artCount) console.log(`Note: ${art.length} art files found, preview_art.txt says ${artCount}.`)
    addFile(".cdn/cn/preview_art.txt", record)
    marker = { name: "starpoint-art-pack.json", info: { kind: "starpoint-art-pack", version: 1, artVersion } }
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
    // files.json lists every table the translation touched (the game-language switch re-sends them all,
    // scripts/cn_language.cjs translatedPaths); a translation step's folder holds only its own tables and points to
    // the rest in earlier steps' folders ("from"), which go in too (as src/routes/companion.ts sends them)
    const listed = path.join(translated, "files.json")
    if (fs.existsSync(listed)) {
        const have = new Set(files.map(([name]) => name))
        for (const f of JSON.parse(fs.readFileSync(listed, "utf8"))) {
            const at = `.cdn/cn_text/${f.path ?? f}`
            if (!have.has(at) && f.from) need(addFile(at, f.from), f.from)
            have.add(at)
        }
    } else {
        const tables = files.filter(([name]) => name.startsWith(".cdn/cn_text/production/")).map(([name]) => ({ path: name.slice(".cdn/cn_text/".length) }))
        const made = path.resolve(out) + ".files.json"
        fs.writeFileSync(made, JSON.stringify(tables))
        process.on("exit", () => fs.rmSync(made, { force: true }))
        files.push([".cdn/cn_text/files.json", made])
    }
    const patches = path.join(cdn, "cn_patches")
    need(fs.existsSync(path.join(patches, "patches.json")), `${patches}/patches.json`)
    // the updates up to the OBB's game files version (OBB_VERSION) are in the OBB itself, so they stay out (~2 GB):
    // patches.json keeps one empty entry for that version, so a game with the OBB is up to date before the server's
    // first own update is built, and the server numbers its updates after it. (The old single OBB, game files
    // 1.4.203, needed them: it isn't supported by the data pack any more.)
    const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0 }
    const allPatches = JSON.parse(fs.readFileSync(path.join(patches, "patches.json"), "utf8")).sort((a, b) => cmp(a.version, b.version))
    const inObb = allPatches.filter(p => cmp(p.version, OBB_VERSION) <= 0)
    need(inObb.some(p => p.version === OBB_VERSION), `an update ${OBB_VERSION} (the OBB's game files version) in ${patches}/patches.json`)
    const kept = allPatches.filter(p => cmp(p.version, OBB_VERSION) > 0)
    for (const p of kept) for (const a of p.archives) need(addFile(`.cdn/cn_patches/${a.file}`, path.join(patches, a.file)), path.join(patches, a.file))
    for (const entry of fs.readdirSync(patches, { withFileTypes: true }))
        if (entry.isFile() && entry.name !== "patches.json") addFile(`.cdn/cn_patches/${entry.name}`, path.join(patches, entry.name))
    const listFile = path.resolve(out) + ".patches.json"
    fs.writeFileSync(listFile, JSON.stringify([{ version: OBB_VERSION, from: inObb[0].from, files: 0, archives: [], inObb: true }, ...kept]))
    process.on("exit", () => fs.rmSync(listFile, { force: true }))
    files.push([".cdn/cn_patches/patches.json", listFile])
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
