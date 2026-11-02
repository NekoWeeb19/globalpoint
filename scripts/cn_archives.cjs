// The CN game files' zip archives (CN_CDN_DIR, default .cdn/cn in this repo) in the order to read
// them so the newest copy of a file wins: full archives first, then updates by version NUMBER
// ("pinball-1.4.9-1.4.10" is older than "pinball-1.4.53-1.4.54"; sorting names gets that wrong).
// iOS archives are skipped.
const fs = require("fs")
const path = require("path")

// scripts run by hand get the repo's .env too (variables already set win, as with node --env-file)
try { process.loadEnvFile(path.join(__dirname, "..", ".env")) } catch { }

const ver = n => (n.match(/-(\d+\.\d+\.\d+)-\d+-[0-9a-f]+\.zip$/) || [])[1] || "0"
const cmp = (a, b) => a.split(".").map(Number).reduce((r, x, i) => r || x - Number(b.split(".")[i] || 0), 0)

/** The CN game files folder: CN_CDN_DIR (relative paths are from the repo folder), else .cdn/cn. */
function cnDir() {
    return path.resolve(path.join(__dirname, ".."), process.env.CN_CDN_DIR || path.join(".cdn", "cn"))
}

/** The translated (English) CN tables: CN_TRANSLATED_DIR (relative to the repo folder), else .cdn/cn_text. */
function cnTextDir() {
    return path.resolve(path.join(__dirname, ".."), process.env.CN_TRANSLATED_DIR || path.join(".cdn", "cn_text"))
}

/** Zip file paths, oldest first. */
function cnZips(dir = cnDir()) {
    const zips = []
    for (const sub of fs.readdirSync(dir)) {
        if (!sub.startsWith("archive-") || sub.includes("ios")) continue
        for (const z of fs.readdirSync(path.join(dir, sub))) if (z.endsWith(".zip")) zips.push({ file: path.join(dir, sub, z), full: sub.endsWith("-full"), v: ver(z) })
    }
    zips.sort((a, b) => (a.full === b.full ? cmp(a.v, b.v) : a.full ? -1 : 1))
    return zips.map(z => z.file)
}

module.exports = { cnZips, cnDir, cnTextDir }
