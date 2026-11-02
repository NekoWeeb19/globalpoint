// Reads a data table or file from the unpacked CN game files (CN_CDN_DIR, default .cdn/cn in this
// repo), by its logical path ("master/ability/ability.orderedmap"). Uses the same name-hashing key and
// file format as global (scripts/cdn_rows.cjs).
//
//   const { readCn, readCnTable } = require("./cn_read.cjs")

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const unzipper = require("unzipper")
const { decodeFile, leaves } = require("./cdn_rows.cjs")
const { cnDir } = require("./cn_archives.cjs")

const SALT = "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy"

const hashed = logical => {
    const h = crypto.createHash("sha1").update(logical + SALT).digest("hex")
    return `production/upload/${h.slice(0, 2)}/${h.slice(2)}`
}

let index = null
function cnIndex() {
    if (index) return index
    index = new Map()
    const csv = fs.readdirSync(path.join(cnDir(), "entities")).find(f => /android_medium\.csv$/.test(f))
    for (const line of fs.readFileSync(path.join(cnDir(), "entities", csv), "utf8").split(/\r?\n/)) {
        const p = line.split(",")
        if (p.length >= 2) index.set(p[0], p[1])
    }
    return index
}

/** A slim CN folder's copy of a table (scripts/gen_cn_slim.cjs), or null. */
function slimTable(key) {
    const file = path.join(cnDir(), "tables", key)
    return fs.existsSync(file) ? fs.readFileSync(file) : null
}

/** The newest copy of a file (by logical path) from the CN archives (or a slim folder's tables), or null. */
async function readCn(logical) {
    const key = hashed(logical)
    const version = cnIndex().get(key)
    if (!version) return slimTable(key)
    const short = key.replace("production/", "")
    for (const dir of ["archive-common-diff", "archive-common-full", "archive-medium-diff", "archive-medium-full", "archive-android-diff", "archive-android-full"]) {
        const full = path.join(cnDir(), dir)
        if (!fs.existsSync(full)) continue
        for (const file of fs.readdirSync(full).filter(f => f.endsWith(".zip") && f.includes(`-${version}-`))) {
            const zip = await unzipper.Open.file(path.join(full, file))
            const entry = zip.files.find(e => e.path.split("\\").join("/").endsWith(short))
            if (entry) return entry.buffer()
        }
    }
    return slimTable(key)
}

/** A data table as { "key/key": csv text }. */
async function readCnTable(logical) {
    const buf = await readCn(logical)
    if (buf === null) return null
    const out = {}
    for (const { path: keys, leaf } of leaves(decodeFile(buf))) out[keys.join("/")] = leaf.text
    return out
}

module.exports = { hashed, cnIndex, readCn, readCnTable }
