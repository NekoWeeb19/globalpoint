// Adds the summon banners only the CN client has to assets/gacha.json, so they can be pulled from the
// CN app (and scheduled from the dashboard's Summons tab). Global's banners are left as they are.
//
// CN gacha row (same layout as global's): 4 payment type, 5/6/7 single/multi/discount cost, 13 kind
// (0 units, 1 armaments), 14/15/16 (units) or 22/23/24 (armaments) the 3/4/5-star odds tables
// (master/gacha_odds/<id>: id, rarity, weight, rate-up...), 17/18 movie names, 29/30 start/end
// (China time; stored as UTC). A pool entry's "rarity" is its share of its star tier in per-mille,
// which is what src/lib/gacha.ts rolls on (checked against global's banner 184: 109 of 545 -> 200).
//
//   node scripts/gen_cn_gacha.cjs [--dry]
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { hashed } = require("F:/WF client/tools/cn_read.cjs")
const unzipper = require("unzipper")
const { cnZips } = require("./cn_archives.cjs")

// every CN file once: hashed path -> newest archive entry (reading table by table re-opens the archives)
let index = null
async function readCnTable(logical) {
    if (index === null) {
        index = new Map()
        for (const z of cnZips()) for (const e of (await unzipper.Open.file(z)).files) if (e.type === "File") index.set(e.path.split(String.fromCharCode(92)).join("/"), e)
    }
    const key = hashed(logical)
    const e = index.get(key) ?? index.get(key.replace(/^production\//, ""))
    if (!e) return null
    const out = {}
    for (const { path: keys, leaf } of R.leaves(R.decodeFile(await e.buffer()))) out[keys.join("/")] = leaf.text
    return out
}

const ROOT = path.join(__dirname, "..")
const DRY = process.argv.includes("--dry")
const OFFSET = 8 * 3600 * 1000
const utc = v => {
    const ms = Date.parse(String(v).replace(" ", "T") + "Z")
    return isNaN(ms) ? null : new Date(ms - OFFSET).toISOString().slice(0, 19).replace("T", " ")
}
const round1 = n => Math.round(n * 10) / 10

async function pool(oddsId) {
    if (!oddsId || oddsId === "(None)") return null
    const t = await readCnTable(`master/gacha_odds/${oddsId}.orderedmap`)
    if (!t) return null
    const rows = Object.values(t).map(l => R.splitCsv(l.replace(/\n$/, "")))
    const total = rows.reduce((s, c) => s + Number(c[2]), 0)
    return rows.map(c => ({ id: Number(c[0]), rank: Number(c[1]), odds: Number(c[2]), isRateUp: c[3] === "true", rarity: round1(Number(c[2]) / total * 1000) }))
}

;(async () => {
    const file = path.join(ROOT, "assets", "gacha.json")
    const gachas = JSON.parse(fs.readFileSync(file, "utf8"))
    const characters = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "character.json"), "utf8"))
    const cn = await readCnTable("master/gacha/gacha.orderedmap")

    // check the conversion on a banner both have
    const check = async id => {
        const c = R.splitCsv(cn[id])
        const p = await pool(c[16])
        const server = gachas[id]?.pool?.["1"]
        return server && p && p.length === server.length && p.every((e, i) => JSON.stringify(e) === JSON.stringify(server[i]))
    }
    console.log(`check banner 184: ${await check("184") ? "same as global" : "DIFFERENT"}`)

    const added = [], skipped = [], missingUnits = new Map()
    for (const [id, line] of Object.entries(cn)) {
        if (gachas[id] !== undefined) continue
        const c = R.splitCsv(line.replace(/\n$/, ""))
        const kind = Number(c[13])
        const cols = kind === 1 ? [24, 23, 22] : [16, 15, 14]
        const pools = []
        for (const col of cols) pools.push(await pool(c[col]))
        if (pools.some(p => p === null || p.length === 0) || !utc(c[29]) || !utc(c[30])) { skipped.push(id); continue }
        if (kind === 0) for (const p of pools) for (const e of p) if (characters[e.id] === undefined) missingUnits.set(e.id, (missingUnits.get(e.id) ?? 0) + 1)
        gachas[id] = {
            type: kind,
            paymentType: Number(c[4]) || 0,
            singleCost: Number(c[5]) || 0,
            multiCost: Number(c[6]) || 0,
            discountCost: Number(c[7]) || 0,
            movieName: c[17],
            guaranteeMovieName: c[18],
            startDate: utc(c[29]),
            endDate: utc(c[30]),
            pool: { 1: pools[0], 2: pools[1], 3: pools[2] },
            cn: true,
        }
        added.push(id)
    }
    if (!DRY) fs.writeFileSync(file, JSON.stringify(gachas))
    console.log(`added ${added.length} CN-only banners (${skipped.length} skipped: no odds or dates)`)
    console.log(`units in their pools the server doesn't know: ${missingUnits.size} -> ${[...missingUnits.keys()].slice(0, 40).join(",")}`)
})().catch(e => { console.error(e); process.exit(1) })
