// Reads the global client's master tables out of the CDN archives (.cdn/en/archive-common-*).
// Used by scripts/gen_missions.cjs and scripts/gen_carnival.cjs.
//
// The CDN file names are SHA1(<logical path> + salt); the tables are "orderedmap" files (a zlib'd
// index of keys, then one zlib'd CSV row per key). Both rules come from the Chinese StarPoint fork
// (src/content/cdn/asset-path-hash.ts and src/content/sync/ordered-map.ts).

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const zlib = require("zlib")
const unzipper = require("unzipper")

const ROOT = path.join(__dirname, "..")
const CDN = path.join(ROOT, ".cdn", "en")
const SALT = "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy"

const hashedPath = logical => {
    const h = crypto.createHash("sha1").update(logical + SALT).digest("hex")
    return `production/upload/${h.slice(0, 2)}/${h.slice(2)}`
}

function parseOrderedMap(raw, compressedRows) {
    const indexLength = raw.readUInt32LE(0)
    const index = zlib.inflateSync(raw.subarray(4, 4 + indexLength))
    const count = index.readUInt32LE(0)
    const keyBlob = index.subarray(4 + count * 8)
    const body = raw.subarray(4 + indexLength)
    const rows = []
    let keyStart = 0, rowStart = 0
    for (let i = 0; i < count; i++) {
        const keyEnd = index.readUInt32LE(4 + i * 8), rowEnd = index.readUInt32LE(8 + i * 8)
        const value = body.subarray(rowStart, rowEnd)
        rows.push([
            keyBlob.subarray(keyStart, keyEnd).toString("utf8"),
            value.length === 0 ? Buffer.alloc(0) : compressedRows ? zlib.inflateSync(value) : Buffer.from(value),
        ])
        keyStart = keyEnd
        rowStart = rowEnd
    }
    return rows
}

/** A flat table is { key: csv text }; a nested one is { key: { key2: csv text } }. */
function decodeTable(raw, nested) {
    if (!nested) return Object.fromEntries(parseOrderedMap(raw, true).map(([k, v]) => [k, v.toString("utf8")]))
    return Object.fromEntries(parseOrderedMap(raw, false).map(([k, v]) =>
        [k, Object.fromEntries(parseOrderedMap(v, true).map(([k2, v2]) => [k2, v2.toString("utf8")]))]))
}

/** Splits one CSV line, keeping quoted fields (which can hold commas) whole. */
function parseCsvLine(line) {
    const out = []
    let current = "", quoted = false
    for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (quoted) {
            if (ch === '"') {
                if (line[i + 1] === '"') { current += '"'; i++ } else quoted = false
            } else current += ch
        } else if (ch === '"') quoted = true
        else if (ch === ",") { out.push(current); current = "" }
        else current += ch
    }
    out.push(current)
    return out
}

const empty = v => v === undefined || v === "" || v === "(None)"
const str = v => empty(v) ? null : v
const int = v => {
    if (empty(v)) return null
    const n = Number(v)
    if (!Number.isSafeInteger(n)) throw new Error(`Not an integer: ${v}`)
    return n
}

let indexCache = null
/** The CDN index: hashed path -> { version }. */
function cdnIndex() {
    if (indexCache) return indexCache
    const csvFile = fs.readdirSync(path.join(CDN, "entities")).filter(f => f.endsWith(".csv")).sort().pop()
    if (!csvFile) throw new Error("No CDN index (.cdn/en/entities/*.csv) found.")
    indexCache = new Map(fs.readFileSync(path.join(CDN, "entities", csvFile), "utf8").split(/\r?\n/).map(line => {
        const p = line.split(",")
        return [p[0], { version: p[1] }]
    }))
    return indexCache
}

let zipCache = null
async function zipEntries() {
    if (zipCache) return zipCache
    zipCache = []
    for (const dir of ["archive-common-diff", "archive-common-full"]) {
        const dirPath = path.join(CDN, dir)
        if (!fs.existsSync(dirPath)) continue
        for (const file of fs.readdirSync(dirPath).filter(f => f.endsWith(".zip"))) {
            const zip = await unzipper.Open.file(path.join(dirPath, file))
            for (const entry of zip.files) zipCache.push({ name: entry.path.replace(/\\/g, "/"), entry, from: `${dir}/${file}` })
        }
    }
    return zipCache
}

// MASTER_SOURCE=cn: the generators read the CN client's tables instead (scripts/gen_cn_merge.cjs
// runs a generator that way and keeps only what global lacks)
let cnCache = null
async function cnFile(logicalPath) {
    if (cnCache === null) {
        const { cnZips } = require("./cn_archives.cjs")
        cnCache = new Map()
        for (const z of cnZips()) for (const e of (await unzipper.Open.file(z)).files) if (e.type === "File") cnCache.set(e.path.split("\\").join("/"), e)
    }
    const entry = cnCache.get(hashedPath(logicalPath))
    if (!entry) throw new Error(`${logicalPath} is not in the CN files.`)
    return entry.buffer()
}
const fromCn = () => process.env.MASTER_SOURCE === "cn"

/** Reads and decodes one master table by its logical path (e.g. "master/mission/daily_mission.orderedmap"). */
async function readTable(logicalPath, nested) {
    if (fromCn()) return decodeTable(await cnFile(logicalPath), nested)
    const key = hashedPath(logicalPath)
    const row = cdnIndex().get(key)
    if (!row) throw new Error(`${logicalPath} is not in the CDN index.`)
    const shortKey = key.replace("production/", "")
    // the newest copy wins: diff archives ending at the indexed version are checked first
    const candidates = (await zipEntries()).filter(e => e.name.endsWith(shortKey))
    if (candidates.length === 0) throw new Error(`${logicalPath} (${key}) was not found in any archive.`)
    const preferred = candidates.find(e => e.from.includes(`-${row.version}-`)) ?? candidates[0]
    console.log(`${logicalPath} <- ${preferred.from}`)
    return decodeTable(await preferred.entry.buffer(), nested)
}


/**
 * Reads a table nested `depth` levels deep (1 = flat) into a list of { path: [keys...], text } rows,
 * innermost rows decompressed (the same rule as decodeTable, extended to more levels).
 */
async function readRows(logicalPath, depth) {
    const key = hashedPath(logicalPath)
    const raw = fromCn() ? await cnFile(logicalPath) : null
    const row = raw ? null : cdnIndex().get(key)
    if (!raw && !row) throw new Error(`${logicalPath} is not in the CDN index.`)
    const shortKey = key.replace("production/", "")
    const candidates = raw ? [] : (await zipEntries()).filter(e => e.name.endsWith(shortKey))
    if (!raw && candidates.length === 0) throw new Error(`${logicalPath} (${key}) was not found in any archive.`)
    const preferred = raw ? null : candidates.find(e => e.from.includes(`-${row.version}-`)) ?? candidates[0]
    const out = []
    const visit = (raw, level, path) => {
        for (const [k, v] of parseOrderedMap(raw, level === depth)) {
            if (level === depth) out.push({ path: [...path, k], text: v.toString("utf8") })
            else if (v.length > 0) visit(v, level + 1, [...path, k])
        }
    }
    visit(raw ?? await preferred.entry.buffer(), 1, [])
    return out
}

module.exports = { ROOT, readTable, readRows, parseCsvLine, empty, str, int }
