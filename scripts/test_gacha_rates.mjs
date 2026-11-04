// Tests the dashboard's summon rates by rarity (src/nya/gachaRates.ts) and the draw that uses them
// (src/lib/gacha.ts drawGachaSync), on a throwaway save folder: defaults, saving, refusing bad values, the
// rates really drawn (many pulls), a 0% rarity never drawn, and the 10-pull's 10th pull never 3★.
//
//   npm run build && node scripts/test_gacha_rates.mjs
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
let failed = 0
const check = (label, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok || detail === undefined ? "" : `  -> ${JSON.stringify(detail)}`}`)
    if (!ok) failed++
}

// the settings file lives in the folder the server runs in: a throwaway one, before the modules load
const temp = mkdtempSync(path.join(os.tmpdir(), "gacha-rates-"))
const cwd = process.cwd()
process.chdir(temp)
try {
    const G = require(path.join(root, "out", "nya", "gachaRates.js"))
    const { drawGachaSync } = require(path.join(root, "out", "lib", "gacha.js"))

    check("base game rates with no setting", JSON.stringify(G.getGachaRates()) === JSON.stringify(G.DEFAULT_GACHA_RATES))
    check("standard 7.5% / 25% / 67.5% out of 1000", JSON.stringify(G.rankRatesFor("standard").normal) === "[75,250,675]")

    // one unit per rarity, so a pull's rarity is its unit
    const pool = { 1: [{ id: 5, rarity: 1000 }], 2: [{ id: 4, rarity: 1000 }], 3: [{ id: 3, rarity: 1000 }] }
    const standard = { type: 0, movieName: "normal", pool }
    const featured = { type: 0, movieName: "rate_up", pool }
    const armament = { type: 1, pool }
    const share = (gacha, pulls) => {
        const counts = { 5: 0, 4: 0, 3: 0 }
        for (let i = 0; i < pulls; i++) for (const [id, n] of drawGachaSync(gacha, 1)) counts[id] += n
        return { 5: counts[5] / pulls * 100, 4: counts[4] / pulls * 100, 3: counts[3] / pulls * 100 }
    }
    const near = (got, want, tol) => Math.abs(got - want) <= tol

    const saved = G.setGachaRates({ standard: { star5: 20, star4: 30 }, featured: { star5: 0, star4: 100 }, armament: { star5: 12.5, star4: 37.5 } })
    check("saved rates come back", saved.standard.star5 === 20 && saved.armament.star4 === 37.5 && existsSync(path.join(temp, ".database", "gacha_rates.json")))

    const s = share(standard, 60000)
    check(`standard pulls follow 20 / 30 / 50 (got ${s[5].toFixed(1)} / ${s[4].toFixed(1)} / ${s[3].toFixed(1)})`, near(s[5], 20, 1) && near(s[4], 30, 1) && near(s[3], 50, 1))
    const a = share(armament, 60000)
    check(`armament pulls follow 12.5 / 37.5 / 50 (got ${a[5].toFixed(1)} / ${a[4].toFixed(1)} / ${a[3].toFixed(1)})`, near(a[5], 12.5, 1) && near(a[4], 37.5, 1) && near(a[3], 50, 1))
    const f = share(featured, 20000)
    check(`a 0% rarity never comes up, 100% always (featured 0 / 100 / 0: got ${f[5]} / ${f[4]} / ${f[3]})`, f[5] === 0 && f[4] === 100 && f[3] === 0)

    // 10-pulls: the 10th is never 3★
    G.setGachaRates({ standard: { star5: 0, star4: 0 }, featured: { star5: 5, star4: 25 }, armament: { star5: 5, star4: 25 } })
    let tenth3 = 0, others3 = 0
    for (let i = 0; i < 2000; i++) {
        const r = drawGachaSync(standard, 10)
        others3 += r.get(3) ?? 0
        if ((r.get(3) ?? 0) > 9) tenth3++
    }
    check("with 0% 5★ and 4★, a 10-pull is 9 3★ + a guaranteed 4★", tenth3 === 0 && others3 === 2000 * 9, { tenth3, others3 })

    for (const [label, bad] of [["over 100% together", { star5: 60, star4: 50 }], ["negative", { star5: -1, star4: 10 }], ["finer than 0.1", { star5: 7.55, star4: 25 }], ["not a number", { star5: "x", star4: 25 }]]) {
        let refused = false
        try { G.setGachaRates({ standard: bad, featured: { star5: 5, star4: 25 }, armament: { star5: 5, star4: 25 } }) } catch { refused = true }
        check(`refuses rates ${label}`, refused)
    }
    check("a refused save leaves the saved rates", G.getGachaRates().standard.star5 === 0)
    check("reset goes back to the base game", JSON.stringify(G.resetGachaRates()) === JSON.stringify(G.DEFAULT_GACHA_RATES) && !existsSync(path.join(temp, ".database", "gacha_rates.json")))
} finally {
    process.chdir(cwd)
    try { rmSync(temp, { recursive: true, force: true }) } catch { }
}
console.log(failed ? `\n${failed} summon rate test(s) failed.` : "\nAll summon rate tests passed.")
process.exit(failed ? 1 : 0)
