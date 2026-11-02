// Picks the global images to put into the "globalized CN" update, from scripts/scan_cn_globalize.cjs
// output: same size as CN's, with pixels that clearly changed (re-encodes are left out), and not used
// by a sprite layout or animation file that changed between CN and global (the image alone could then
// be cut up wrongly). Writes the list for scripts/build_cn_patch.cjs and a summary.
//
//   node scripts/plan_cn_globalize.cjs <scan dir> [min changed pixels, default 20]
//   -> <scan dir>/images.json, <scan dir>/plan_summary.json
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

const SALT = "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy"
const hashed = l => { const x = crypto.createHash("sha1").update(l + SALT).digest("hex"); return `production/upload/${x.slice(0, 2)}/${x.slice(2)}` }

const [scanDir, minArg] = process.argv.slice(2)
const MIN = Number(minArg ?? 20)
const all = []
for (const f of fs.readdirSync(scanDir).filter(f => /^scan_\d+\.json$/.test(f)))
    all.push(...JSON.parse(fs.readFileSync(path.join(scanDir, f), "utf8")))

// images named by changed layout/animation files (each referenced path, its .png, and its folder's
// sprite sheet)
const unsafe = new Set()
for (const r of all) {
    if (!r.refs) continue
    for (const ref of r.refs) {
        const clean = ref.replace(/\.(png|json|atlas)$/, "")
        unsafe.add(hashed(clean + ".png"))
        const dir = clean.split("/").slice(0, -1).join("/")
        if (dir) { unsafe.add(hashed(dir + "/sprite_sheet.png")); unsafe.add(hashed(dir + ".png")) }
    }
}

const counts = {}
const images = []
let bytes = 0
for (const r of all) {
    counts[r.kind] = (counts[r.kind] ?? 0) + 1
    if (r.kind !== "png") continue
    const sameSize = r.cnDims && r.glDims && r.cnDims[0] === r.glDims[0] && r.cnDims[1] === r.glDims[1]
    const reason = !sameSize ? "size" : r.changed === undefined ? "undecoded" : r.changed < MIN ? "unchanged" : unsafe.has(r.k) ? "layout" : "ok"
    counts["png:" + reason] = (counts["png:" + reason] ?? 0) + 1
    if (reason === "ok") { images.push({ path: r.k, from: "global" }); bytes += r.glSize }
}
fs.writeFileSync(path.join(scanDir, "images.json"), JSON.stringify(images))
const summary = { files: all.length, counts, images: images.length, imageMB: Math.round(bytes / 1e6) }
fs.writeFileSync(path.join(scanDir, "plan_summary.json"), JSON.stringify(summary, null, 1))
console.log(summary)
