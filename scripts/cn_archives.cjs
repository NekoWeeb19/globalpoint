// The CN game files' zip archives (CN_CDN_DIR, default D:\WF client\.cdn\cn) in the order to read
// them so the newest copy of a file wins: full archives first, then updates by version NUMBER
// ("pinball-1.4.9-1.4.10" is older than "pinball-1.4.53-1.4.54"; sorting names gets that wrong).
// iOS archives are skipped.
const fs = require("fs")
const path = require("path")

const ver = n => (n.match(/-(\d+\.\d+\.\d+)-\d+-[0-9a-f]+\.zip$/) || [])[1] || "0"
const cmp = (a, b) => a.split(".").map(Number).reduce((r, x, i) => r || x - Number(b.split(".")[i] || 0), 0)

/** Zip file paths, oldest first. */
function cnZips(dir = process.env.CN_CDN_DIR || "D:/WF client/.cdn/cn") {
    const zips = []
    for (const sub of fs.readdirSync(dir)) {
        if (!sub.startsWith("archive-") || sub.includes("ios")) continue
        for (const z of fs.readdirSync(path.join(dir, sub))) if (z.endsWith(".zip")) zips.push({ file: path.join(dir, sub, z), full: sub.endsWith("-full"), v: ver(z) })
    }
    zips.sort((a, b) => (a.full === b.full ? cmp(a.v, b.v) : a.full ? -1 : 1))
    return zips.map(z => z.file)
}

module.exports = { cnZips }
