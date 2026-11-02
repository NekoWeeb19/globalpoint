// Makes the comics pack for the phone companion app ("Comics pack..." in Game data): one zip of the
// server's comics folder (<CDN_DIR>/comics), for phone players without a PC on the same Wi-Fi.
//   node scripts/build_comics_pack.cjs <out.zip> [comics folder]
// The comics folder defaults to <CDN_DIR>/comics (CDN_DIR from the environment or ./.env, relative to
// the server folder; default .cdn). Entries are stored (images don't compress) at the paths the
// companion's data folder needs (.cdn/comics/<kind>/<file>), after a first entry,
// starpoint-comics-pack.json, that marks the zip as a comics pack. Prints its size and SHA-256.
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const zlib = require("zlib")

const MARKER = "starpoint-comics-pack.json"
const repo = path.join(__dirname, "..")

const [out, comicsArg] = process.argv.slice(2)
if (!out) { console.error("usage: node scripts/build_comics_pack.cjs <out.zip> [comics folder]"); process.exit(1) }
if (!comicsArg && !process.env.CDN_DIR && fs.existsSync(".env")) try { process.loadEnvFile(".env") } catch { }
const comics = path.resolve(comicsArg || path.join(path.resolve(repo, process.env.CDN_DIR || ".cdn"), "comics"))
if (!fs.existsSync(comics)) { console.error(`No comics folder at ${comics}`); process.exit(1) }

// every file under the comics folder, sorted, as [zip path, file]
const files = []
;(function walk(dir, at) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(file, `${at}/${entry.name}`)
        else if (entry.isFile()) files.push([`${at}/${entry.name}`, file])
    }
})(comics, ".cdn/comics")
if (files.length === 0) { console.error(`${comics} is empty`); process.exit(1) }
const bytes = files.reduce((n, [, file]) => n + fs.statSync(file).size, 0)

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
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6) // utf-8 names
    local.writeUInt16LE(0, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28)
    central.push({ nameBuf, crc, size: data.length, dosTime, dosDate, at: offset })
    write(local); write(nameBuf); write(data)
}

try {
    add(MARKER, Buffer.from(JSON.stringify({ kind: "starpoint-comics-pack", version: 1, files: files.length, bytes, created: new Date().toISOString() }, null, 1)), Date.now())
    let done = 0
    for (const [name, file] of files) {
        add(name, fs.readFileSync(file), fs.statSync(file).mtimeMs)
        if (++done % 100 === 0) process.stdout.write(`\r${done} / ${files.length} files`)
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
console.log(`\nWrote ${target}`)
console.log(`  ${files.length} comics files from ${comics}`)
console.log(`  size   ${offset} bytes (${(offset / 1048576).toFixed(1)} MB)`)
console.log(`  sha256 ${hash.digest("hex")}`)
