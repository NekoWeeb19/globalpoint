// Runs one of the global data generators (scripts/gen_*.cjs) on the CN client's tables
// (MASTER_SOURCE=cn, see scripts/cdn_master.cjs) and adds to the server's asset only what global's
// copy doesn't have (CN-only events and their quests and rewards). Global's entries stay as they are.
// The generator's own column checks still run, so a CN table laid out differently stops it.
//
//   node scripts/gen_cn_merge.cjs <generator script> <asset file> [<asset file>...]
//   e.g. node scripts/gen_cn_merge.cjs scripts/gen_ranking.cjs assets/ranking_event.json
const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")

const [generator, ...assets] = process.argv.slice(2)
if (!generator || assets.length === 0) throw new Error("usage: gen_cn_merge.cjs <generator> <asset> [...]")

const globals = assets.map(a => fs.readFileSync(a, "utf8"))
let cnOut
try {
    execFileSync(process.execPath, [generator], { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, MASTER_SOURCE: "cn" } })
    cnOut = assets.map(a => fs.readFileSync(a, "utf8"))
} finally {
    assets.forEach((a, i) => fs.writeFileSync(a, globals[i])) // global's copy back, whatever happened
}

/** Adds keys of `cn` missing from `gl`, down to `depth` levels; returns the added paths. */
function merge(gl, cn, depth, at = "") {
    const added = []
    for (const [k, v] of Object.entries(cn)) {
        if (k === "_note") continue
        if (!(k in gl)) { gl[k] = v; added.push(at + k) }
        else if (depth > 1 && v && typeof v === "object" && !Array.isArray(v) && gl[k] && typeof gl[k] === "object" && !Array.isArray(gl[k]))
            added.push(...merge(gl[k], v, depth - 1, `${at}${k}/`))
    }
    return added
}

assets.forEach((a, i) => {
    const gl = JSON.parse(globals[i]), cn = JSON.parse(cnOut[i])
    // records are either at the top or one level down (e.g. { events: {...}, quests: {...} })
    const nested = Object.values(gl).some(v => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).every(k => /^\d+$/.test(k)) && Object.keys(v).length > 0)
        && !Object.keys(gl).every(k => /^\d+$/.test(k) || k === "_note")
    const added = merge(gl, cn, nested ? 2 : 1)
    const pretty = globals[i].includes("\n ")
    fs.writeFileSync(a, pretty ? JSON.stringify(gl, null, globals[i].includes("\n  ") ? 2 : 1) : JSON.stringify(gl))
    console.log(`${path.basename(a)}: added ${added.length} CN-only entries${added.length ? ` (${added.slice(0, 8).join(", ")}${added.length > 8 ? ", ..." : ""})` : ""}`)
})
