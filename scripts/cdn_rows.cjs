// Reads and writes CDN "orderedmap" files at any nesting depth, by their hashed path
// (production/upload/xx/yyyy...). Leaf rows are zlib'd CSV text; an inner row is another orderedmap,
// stored as is. The format is the one scripts/cdn_master.cjs reads (the Chinese fork's
// src/content/sync/ordered-map.ts).
//
// decodeFile(buf) -> node, where a node is { kind: "map", entries: [{ key, node }] } or
// { kind: "leaf", raw: Buffer (as stored), text: string }. encodeFile(node) -> Buffer. A leaf whose
// text is unchanged keeps its stored bytes, so an untouched file encodes back byte for byte.

const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const unzipper = require("unzipper")

const ROOT = path.join(__dirname, "..")
const CDN = path.join(ROOT, ".cdn", "en")

function tryMap(buf) {
    if (buf.length < 8) return null
    const indexLength = buf.readUInt32LE(0)
    if (indexLength < 4 || 4 + indexLength > buf.length) return null
    let index
    try { index = zlib.inflateSync(buf.subarray(4, 4 + indexLength)) } catch { return null }
    const count = index.readUInt32LE(0)
    if (4 + count * 8 > index.length) return null
    const keyBlob = index.subarray(4 + count * 8)
    const body = buf.subarray(4 + indexLength)
    const entries = []
    let keyStart = 0, rowStart = 0
    for (let i = 0; i < count; i++) {
        const keyEnd = index.readUInt32LE(4 + i * 8), rowEnd = index.readUInt32LE(8 + i * 8)
        if (keyEnd < keyStart || keyEnd > keyBlob.length || rowEnd < rowStart || rowEnd > body.length) return null
        entries.push({ key: keyBlob.subarray(keyStart, keyEnd).toString("utf8"), raw: Buffer.from(body.subarray(rowStart, rowEnd)) })
        keyStart = keyEnd
        rowStart = rowEnd
    }
    if (rowStart !== body.length) return null
    return entries
}

/** Decodes one file into a tree of maps and leaves. */
function decodeFile(buf) {
    const entries = tryMap(buf)
    if (entries === null) throw new Error("Not an orderedmap file.")
    return { kind: "map", source: buf, entries: entries.map(({ key, raw }) => ({ key, node: decodeValue(raw) })) }
}

function decodeValue(raw) {
    if (raw.length === 0) return { kind: "leaf", raw, text: "" }
    try { return { kind: "leaf", raw, text: zlib.inflateSync(raw).toString("utf8") } } catch { }
    return { ...decodeFile(raw), raw }
}

// a map is changed when a leaf in it was edited, or when entries were added or removed (node.dirty)
const changed = node => node.kind === "leaf" ? node.original !== undefined : node.dirty === true || node.entries.some(e => changed(e.node))

function encodeValue(node) {
    if (node.kind === "map") return node.raw !== undefined && !changed(node) ? node.raw : encodeFile(node)
    if (node.raw !== undefined && node.original === undefined) return node.raw
    return node.text === "" ? Buffer.alloc(0) : zlib.deflateSync(Buffer.from(node.text, "utf8"))
}

/** Encodes a tree back into file bytes (an untouched file comes back as it was read). */
function encodeFile(node) {
    if (node.source !== undefined && !changed(node)) return node.source
    const values = node.entries.map(e => encodeValue(e.node))
    const keys = node.entries.map(e => Buffer.from(e.key, "utf8"))
    const head = Buffer.alloc(4 + node.entries.length * 8)
    head.writeUInt32LE(node.entries.length, 0)
    let keyEnd = 0, rowEnd = 0
    node.entries.forEach((_, i) => {
        keyEnd += keys[i].length
        rowEnd += values[i].length
        head.writeUInt32LE(keyEnd, 4 + i * 8)
        head.writeUInt32LE(rowEnd, 8 + i * 8)
    })
    const index = zlib.deflateSync(Buffer.concat([head, ...keys]))
    const length = Buffer.alloc(4)
    length.writeUInt32LE(index.length, 0)
    return Buffer.concat([length, index, ...values])
}

/** Sets a leaf's text (marking it changed so it is recompressed). */
function setLeafText(leaf, text) {
    if (leaf.original === undefined) leaf.original = leaf.text
    leaf.text = text
}

/** Every leaf with its key path. */
function leaves(node, keyPath = []) {
    if (node.kind === "leaf") return [{ path: keyPath, leaf: node }]
    return node.entries.flatMap(e => leaves(e.node, [...keyPath, e.key]))
}

/** Splits a CSV row into fields (quoted fields may hold commas, quotes and newlines). */
function splitCsv(line) {
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

/** Writes one CSV field, quoting it when it holds a comma, quote or newline. */
function csvField(value) {
    return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

let indexCache = null
function cdnIndex() {
    if (indexCache) return indexCache
    const csvFile = fs.readdirSync(path.join(CDN, "entities")).filter(f => f.endsWith(".csv")).sort().pop()
    indexCache = new Map(fs.readFileSync(path.join(CDN, "entities", csvFile), "utf8").split(/\r?\n/).map(line => {
        const p = line.split(",")
        return [p[0], p[1]]
    }))
    return indexCache
}

/** The newest copy of a hashed file ("production/upload/xx/yyyy...") from the common archives. */
async function readHashedFile(hashed) {
    const version = cdnIndex().get(hashed)
    if (!version) throw new Error(`${hashed} is not in the CDN index.`)
    const shortKey = hashed.replace("production/", "")
    for (const dir of ["archive-common-diff", "archive-common-full"]) {
        const dirPath = path.join(CDN, dir)
        if (!fs.existsSync(dirPath)) continue
        for (const file of fs.readdirSync(dirPath).filter(f => f.endsWith(".zip") && f.includes(`-${version}-`))) {
            const zip = await unzipper.Open.file(path.join(dirPath, file))
            const entry = zip.files.find(e => e.path.split("\\").join("/").endsWith(shortKey))
            if (entry) return entry.buffer()
        }
    }
    throw new Error(`${hashed} (version ${version}) was not found in any archive.`)
}

module.exports = { ROOT, CDN, decodeFile, encodeFile, setLeafText, leaves, splitCsv, csvField, readHashedFile }
