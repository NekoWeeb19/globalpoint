// Summon banners with fixed star rates: a CN banner row names its rarity table in column 11
// (master/gacha/gacha.orderedmap -> master/gacha_odds/<name>, "<rarity>,<weight>" rows). Most use normal_rarity,
// fes_rarity or equipment_normal_rarity, which the dashboard's Summon rates drive (src/nya/gachaRates.ts). The others
// are fixed by design: rearity_5_guarantee_rarity (banner 4, the 5★ guaranteed ticket portal: 100% 5★) and
// rare_rarity (banners 2 and 900003, the 4★-or-higher ticket portals: 5% 5★, 95% 4★). Drawing those at the normal
// rates gave 3★ units, and on banner 4 the 5★-guarantee animation then stopped the game (C3032 "result rarity
// mismatch", a player's crash log, 2026-11-10).
//
// -> assets/gacha_rarity_cn.json { banner id: [5★, 4★, 3★] per mille }, used by src/routes/api/gacha.ts (CN app).
//
//   node --env-file=.env scripts/gen_cn_gacha_rarity.cjs
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")

const DASHBOARD_TABLES = new Set(["normal_rarity", "fes_rarity", "equipment_normal_rarity"])

;(async () => {
    const gacha = await readCnTable("master/gacha/gacha.orderedmap")
    const tables = new Map()
    const out = {}
    for (const [id, line] of Object.entries(gacha)) {
        const name = R.splitCsv(line.replace(/\n$/, ""))[11]
        if (!name || name === "(None)" || DASHBOARD_TABLES.has(name)) continue
        if (!tables.has(name)) {
            const t = await readCnTable(`master/gacha_odds/${name}.orderedmap`)
            const weights = { 5: 0, 4: 0, 3: 0 }
            for (const row of Object.values(t ?? {})) { const [rarity, weight] = R.splitCsv(row.replace(/\n$/, "")).map(Number); if (rarity in weights) weights[rarity] = weight }
            const total = weights[5] + weights[4] + weights[3]
            tables.set(name, total > 0 ? [5, 4, 3].map(r => Math.round(weights[r] / total * 1000)) : null)
        }
        const rates = tables.get(name)
        if (rates) { out[id] = rates; console.log(`banner ${id}: ${name} ${rates.map(r => r / 10 + "%").join(" / ")}`) }
        else console.log(`banner ${id}: ${name} has no readable table, left on the normal rates`)
    }
    const file = path.join(__dirname, "..", "assets", "gacha_rarity_cn.json")
    fs.writeFileSync(file, JSON.stringify(out))
    console.log(`Wrote ${file}: ${Object.keys(out).length} banner(s)`)
})().catch(e => { console.error(e); process.exit(1) })
