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
const { hashed } = require("./cn_read.cjs")
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

    // page kind 1 (column 4): a 10-pull once per account for paid beads (column 8, e.g. Star Heroes, 1500), with
    // at least column 9 units of column 10's rarity; the server draws it as such (src/routes/api/gacha.ts)
    const perAccount = c => Number(c[4]) === 1
        ? { perAccountCost: Number(c[8]) || 0, guaranteeNumber: Number(c[9]) || 0, guaranteeRarity: Number(c[10]) || 0 }
        : {}
    // banners added by an earlier run get these fields too
    for (const [id, line] of Object.entries(cn)) {
        if (gachas[id] === undefined || gachas[id].cn !== true) continue
        Object.assign(gachas[id], perAccount(R.splitCsv(line.trimEnd())))
    }
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
            ...perAccount(c),
            cn: true,
        }
        added.push(id)
    }
    // banners both have under the same id but that are different banners in CN (e.g. 1574: CN's Haruhi Suzumiya
    // collab spotlight, a global spotlight of other units): CN's own version, used for the CN app's pulls
    // (assets/gacha_cn_shared.json, src/lib/assets.ts getGachaSync); global's stays for the global app
    const shared = {}
    const sharedChanged = []
    const unitPoolKey = g => JSON.stringify([1, 2, 3].map(k => (g.pool?.[k] ?? []).map(e => [e.id, e.isRateUp, e.rarity])))
    for (const [id, line] of Object.entries(cn)) {
        if (gachas[id] === undefined || gachas[id].cn === true) continue
        const c = R.splitCsv(line.replace(/\n$/, ""))
        const kind = Number(c[13])
        const cols = kind === 1 ? [24, 23, 22] : [16, 15, 14]
        const pools = []
        for (const col of cols) pools.push(await pool(c[col]))
        if (pools.some(p => p === null || p.length === 0) || !utc(c[29]) || !utc(c[30])) continue
        const own = {
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
            ...perAccount(c),
        }
        const global = gachas[id]
        const differs = unitPoolKey(own) !== unitPoolKey(global) || own.type !== global.type
            || own.movieName !== global.movieName || own.guaranteeMovieName !== global.guaranteeMovieName
            || own.singleCost !== global.singleCost || own.multiCost !== global.multiCost || own.paymentType !== global.paymentType
        if (!differs) continue
        if (kind === 0) for (const p of pools) for (const e of p) if (characters[e.id] === undefined) missingUnits.set(e.id, (missingUnits.get(e.id) ?? 0) + 1)
        shared[id] = own
        sharedChanged.push(id)
    }
    const sharedFile = path.join(ROOT, "assets", "gacha_cn_shared.json")
    if (!DRY) fs.writeFileSync(file, JSON.stringify(gachas))
    if (!DRY) fs.writeFileSync(sharedFile, JSON.stringify(shared))
    console.log(`added ${added.length} CN-only banners (${skipped.length} skipped: no odds or dates)`)
    console.log(`${sharedChanged.length} banners have the same id as a global one but are different in CN (CN's own version written): ${sharedChanged.slice(0, 60).join(",")}${sharedChanged.length > 60 ? ",..." : ""}`)
    console.log(`units in their pools the server doesn't know: ${missingUnits.size} -> ${[...missingUnits.keys()].slice(0, 40).join(",")}`)
})().catch(e => { console.error(e); process.exit(1) })
