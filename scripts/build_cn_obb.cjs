// Writes the CN game files as ONE file (an "OBB") straight from a StarPoint server's files, for players
// who copy the game over USB instead of downloading it. The game (StorageDropoff.as, build 22+) unpacks
// it at first start into its private download folder.
//
//   node scripts/build_cn_obb.cjs <out.obb | out folder | -> [--server <StarPoint folder>] [--version-code 1008001]
//   "-" streams it to stdout, e.g. straight onto a phone with no copy on the PC:
//   node scripts/build_cn_obb.cjs - | adb exec-in "cat > /sdcard/Android/obb/com.leiting.wf/main.1008001.com.leiting.wf.obb"
//
// Out folder: the file is named main.<versionCode>.com.leiting.wf.obb. The phone takes it at
// /sdcard/Android/obb/com.leiting.wf/ (no permission needed there) or /sdcard/StarPoint/game/.
// --server: the StarPoint folder whose files to pack (its .env and scripts/cn_archives.cjs are used);
// default this repo. Needs ~10.2 GB free where the OBB goes; nothing else is written.
//
// Contents, newest copy of each file wins: the CN base zips (no iOS) oldest first, then StarPoint's patch
// zips from <CDN_DIR>/cn_patches/patches.json in version order, then info.json with the newest patch
// version (the server then sends nothing more). Paths are the private folder's: download/production/...
//
// Format: a plain zip, files STORED (the game files are already compressed; storing lets the game copy
// bytes out without inflating), zip64 for the >4 GB offsets and the >65535 entries. Any zip tool can list
// or unpack it. The FIRST entry, starpoint-obb-index.txt, lists every entry's header offset, data offset,
// size and path in fixed-width text, so the game finds everything by reading the file's start: it never
// needs the zip's central directory at the end. That lets the game unpack from the END of the file
// backwards and cut the file shorter as it goes (no 2x free space needed), and pick up again after an
// interruption. info.json is the second entry so it is unpacked last.
//   starpoint-obb-index.txt: "STARPOINT-OBB 1 <entries>\n" then per entry
//     "<header offset, 12 digits> <data offset, 12 digits> <size, 12 digits> <path>\n"
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")

const args = process.argv.slice(2)
const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v }
const SERVER = path.resolve(opt("--server", path.join(__dirname, "..")))
const VERSION_CODE = opt("--version-code", "1008001")
const BASE_URL = opt("--base-url", "http://127.0.0.1:8000/cn/cdn/")
if (args.length !== 1) {
    console.error("usage: node scripts/build_cn_obb.cjs <out.obb | out folder | -> [--server <StarPoint folder>] [--version-code N]")
    process.exit(2)
}
// "-" = write the OBB to stdout (e.g. straight into a phone: | adb exec-in "cat > <path>"), notes to stderr
const TO_STDOUT = args[0] === "-"
let OUT = TO_STDOUT ? "-" : path.resolve(args[0])
if (!TO_STDOUT && !OUT.toLowerCase().endsWith(".obb")) OUT = path.join(OUT, `main.${VERSION_CODE}.com.leiting.wf.obb`)
const log = (...a) => (TO_STDOUT ? console.error : console.log)(...a)

// the server's own settings: its .env, then its archive helpers (they read the env)
try { process.loadEnvFile(path.join(SERVER, ".env")) } catch { }
const archives = require(path.join(SERVER, "scripts", "cn_archives.cjs"))
const cnDir = archives.cnDir ? archives.cnDir() : path.resolve(SERVER, process.env.CN_CDN_DIR || path.join(".cdn", "cn"))
const cdnDir = archives.cdnDir ? archives.cdnDir() : path.resolve(SERVER, process.env.CDN_DIR || ".cdn")
const cmp = (a, b) => a.split(".").map(Number).reduce((r, x, i) => r || x - Number(b.split(".")[i] || 0), 0)

const INDEX_NAME = "starpoint-obb-index.txt"
const U32 = 0xffffffff

// ---- reading the source zips (central directory only; data is read entry by entry) ----
function readCentral(file) {
    const fd = fs.openSync(file, "r")
    const size = fs.fstatSync(fd).size
    const tailLen = Math.min(size, 65557 + 20)
    const tail = Buffer.alloc(tailLen)
    fs.readSync(fd, tail, 0, tailLen, size - tailLen)
    let eocd = -1
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    if (eocd < 0) throw new Error(`${file}: not a zip`)
    let count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16)
    if (count === 0xffff || cdOff === U32) {
        // zip64: the locator sits right before the EOCD
        const loc = eocd - 20
        if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new Error(`${file}: zip64 locator missing`)
        const rec = Buffer.alloc(56)
        fs.readSync(fd, rec, 0, 56, Number(tail.readBigUInt64LE(loc + 8)))
        count = Number(rec.readBigUInt64LE(32)); cdSize = Number(rec.readBigUInt64LE(40)); cdOff = Number(rec.readBigUInt64LE(48))
    }
    const cd = Buffer.alloc(cdSize)
    fs.readSync(fd, cd, 0, cdSize, cdOff)
    const entries = []
    for (let p = 0, n = 0; n < count; n++) {
        if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error(`${file}: bad central directory`)
        const method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16)
        let comp = cd.readUInt32LE(p + 20), size = cd.readUInt32LE(p + 24)
        const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32)
        let local = cd.readUInt32LE(p + 42)
        const name = cd.toString("utf8", p + 46, p + 46 + nameLen).split("\\").join("/")
        // zip64 extra: only the fields that are 0xFFFFFFFF, in this order
        for (let x = p + 46 + nameLen, end = x + extraLen; x + 4 <= end;) {
            const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2)
            if (id === 1) {
                let q = x + 4
                if (size === U32) { size = Number(cd.readBigUInt64LE(q)); q += 8 }
                if (comp === U32) { comp = Number(cd.readBigUInt64LE(q)); q += 8 }
                if (local === U32) { local = Number(cd.readBigUInt64LE(q)); q += 8 }
            }
            x += 4 + len
        }
        if (!name.endsWith("/")) entries.push({ name, method, crc, comp, size, local })
        p += 46 + nameLen + extraLen + commentLen
    }
    return { fd, entries }
}

function readData(src, e) {
    const h = Buffer.alloc(30)
    fs.readSync(src.fd, h, 0, 30, e.local)
    if (h.readUInt32LE(0) !== 0x04034b50) throw new Error(`${src.file}: ${e.name}: bad local header`)
    const raw = Buffer.alloc(e.comp)
    fs.readSync(src.fd, raw, 0, e.comp, e.local + 30 + h.readUInt16LE(26) + h.readUInt16LE(28))
    const data = e.method === 0 ? raw : e.method === 8 ? zlib.inflateRawSync(raw) : null
    if (!data) throw new Error(`${src.file}: ${e.name}: compression method ${e.method}`)
    if (data.length !== e.size || zlib.crc32(data) !== e.crc) throw new Error(`${src.file}: ${e.name}: size or CRC mismatch`)
    return data
}

// ---- writing ----
const DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 11 << 5 | 2

function localHeader(name, size, crc) {
    const n = Buffer.from(name, "utf8")
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8)
    h.writeUInt16LE(DOS_TIME, 10); h.writeUInt16LE(DOS_DATE, 12)
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(size, 18); h.writeUInt32LE(size, 22)
    h.writeUInt16LE(n.length, 26); h.writeUInt16LE(0, 28)
    return Buffer.concat([h, n])
}

function centralHeader(e) {
    const n = Buffer.from(e.path, "utf8")
    const big = e.hdr >= U32
    const extra = big ? Buffer.alloc(12) : Buffer.alloc(0)
    if (big) { extra.writeUInt16LE(1, 0); extra.writeUInt16LE(8, 2); extra.writeBigUInt64LE(BigInt(e.hdr), 4) }
    const h = Buffer.alloc(46)
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(45, 4); h.writeUInt16LE(big ? 45 : 20, 6); h.writeUInt16LE(0x0800, 8)
    h.writeUInt16LE(0, 10); h.writeUInt16LE(DOS_TIME, 12); h.writeUInt16LE(DOS_DATE, 14)
    h.writeUInt32LE(e.crc, 16); h.writeUInt32LE(e.size, 20); h.writeUInt32LE(e.size, 24)
    h.writeUInt16LE(n.length, 28); h.writeUInt16LE(extra.length, 30)
    h.writeUInt32LE(big ? U32 : e.hdr, 42)
    return Buffer.concat([h, n, extra])
}

class Out {
    constructor(file) { this.fd = file === "-" ? 1 : fs.openSync(file, "w"); this.pos = 0; this.bufs = []; this.len = 0 }
    write(b) { this.bufs.push(b); this.len += b.length; this.pos += b.length; if (this.len >= 8 << 20) this.flush() }
    flush() { if (this.len) { const b = Buffer.concat(this.bufs, this.len); let o = 0; while (o < b.length) o += fs.writeSync(this.fd, b, o); this.bufs = []; this.len = 0 } }
    close() { this.flush(); if (this.fd !== 1) fs.closeSync(this.fd) }
}

const pad = n => String(n).padStart(12, "0")

;(async () => {
    const started = Date.now()
    // the newest copy of every file
    const zipFiles = archives.cnZips(cnDir)
    const patchList = JSON.parse(fs.readFileSync(path.join(cdnDir, "cn_patches", "patches.json"), "utf8")).sort((a, b) => cmp(a.version, b.version))
    for (const p of patchList) for (const a of p.archives) zipFiles.push(path.join(cdnDir, "cn_patches", a.file))
    if (patchList.length === 0) throw new Error(`no StarPoint patches in ${path.join(cdnDir, "cn_patches")}`)
    const version = patchList[patchList.length - 1].version
    const sources = []
    const newest = new Map()
    for (const file of zipFiles) {
        const src = { file, ...readCentral(file) }
        sources.push(src)
        for (const e of src.entries) newest.set(e.name, { src, e })
    }
    log(`${zipFiles.length} zips (CN base + ${patchList.length} StarPoint patches to ${version}), ${newest.size} distinct files`)

    // layout: index, info.json, download/.empty, then the files in source order (sequential reads)
    const files = [...newest.entries()].map(([name, v]) => ({ path: "download/" + name, size: v.e.size, crc: v.e.crc, src: v.src, e: v.e }))
    const srcIndex = new Map(sources.map((s, i) => [s, i]))
    files.sort((a, b) => srcIndex.get(a.src) - srcIndex.get(b.src) || a.e.local - b.e.local)
    const totalSize = files.reduce((t, f) => t + f.size, 0)
    const info = Buffer.from(JSON.stringify({
        assetRecoveryInfo: [], totalSize, version, baseUrl: BASE_URL, assetSizeKind: "fulfill",
        latestModifiedTimeOfArchive: new Date().toUTCString(),
    }))
    const empty = Buffer.from("0")
    const entries = [
        { path: "info.json", size: info.length, crc: zlib.crc32(info), data: info },
        { path: "download/.empty", size: empty.length, crc: zlib.crc32(empty), data: empty },
        ...files,
    ]
    // the index's own length is known before the offsets: fixed-width numbers
    const head = `STARPOINT-OBB 1 ${entries.length}\n`
    let indexLen = Buffer.byteLength(head)
    for (const e of entries) indexLen += 39 + Buffer.byteLength(e.path) + 1
    let pos = 30 + INDEX_NAME.length + indexLen
    for (const e of entries) {
        e.hdr = pos
        e.data0 = pos + 30 + Buffer.byteLength(e.path)
        pos = e.data0 + e.size
    }
    const index = Buffer.from(head + entries.map(e => `${pad(e.hdr)} ${pad(e.data0)} ${pad(e.size)} ${e.path}\n`).join(""))
    if (index.length !== indexLen) throw new Error("index length mismatch")
    const indexEntry = { path: INDEX_NAME, size: index.length, crc: zlib.crc32(index), hdr: 0 }
    log(`writing ${OUT}: ${(pos / 2 ** 30).toFixed(2)} GB, version ${version}`)

    if (!TO_STDOUT) fs.mkdirSync(path.dirname(OUT), { recursive: true })
    const tmp = TO_STDOUT ? "-" : OUT + ".part"
    const out = new Out(tmp)
    out.write(localHeader(INDEX_NAME, index.length, indexEntry.crc)); out.write(index)
    let n = 0
    for (const e of entries) {
        if (out.pos !== e.hdr) throw new Error(`${e.path}: offset ${out.pos} != ${e.hdr}`)
        out.write(localHeader(e.path, e.size, e.crc))
        out.write(e.data || readData(e.src, e.e))
        if (++n % 10000 === 0) log(`  ${n}/${entries.length}  ${(out.pos / 2 ** 30).toFixed(2)} GB  ${((Date.now() - started) / 1000).toFixed(0)} s`)
    }
    // central directory (zip64 end records: more than 65535 entries, offsets past 4 GB)
    const cdStart = out.pos
    for (const e of [indexEntry, ...entries]) out.write(centralHeader(e))
    const cdSize = out.pos - cdStart, count = entries.length + 1
    const z64 = Buffer.alloc(56)
    z64.writeUInt32LE(0x06064b50, 0); z64.writeBigUInt64LE(44n, 4); z64.writeUInt16LE(45, 12); z64.writeUInt16LE(45, 14)
    z64.writeBigUInt64LE(BigInt(count), 24); z64.writeBigUInt64LE(BigInt(count), 32)
    z64.writeBigUInt64LE(BigInt(cdSize), 40); z64.writeBigUInt64LE(BigInt(cdStart), 48)
    const z64At = out.pos
    out.write(z64)
    const locator = Buffer.alloc(20)
    locator.writeUInt32LE(0x07064b50, 0); locator.writeBigUInt64LE(BigInt(z64At), 8); locator.writeUInt32LE(1, 16)
    out.write(locator)
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0xffff, 8); eocd.writeUInt16LE(0xffff, 10)
    eocd.writeUInt32LE(Math.min(cdSize, U32), 12); eocd.writeUInt32LE(U32, 16)
    out.write(eocd)
    out.close()
    for (const s of sources) fs.closeSync(s.fd)
    if (!TO_STDOUT) fs.renameSync(tmp, OUT)
    log(`done: ${OUT}`)
    log(`  ${entries.length} entries (${files.length} game files, ${(totalSize / 2 ** 30).toFixed(2)} GB), file ${out.pos} bytes (${(out.pos / 2 ** 30).toFixed(2)} GB), version ${version}, ${((Date.now() - started) / 1000).toFixed(0)} s`)
})().catch(e => { console.error(e); process.exit(1) })
