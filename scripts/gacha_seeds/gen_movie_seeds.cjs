// Builds assets/gacha_seeds_by_movie.json: summon seeds for each summon movie, worked out on that movie's own field.
//
// The game rebuilds each pull's ball field from its seed and the movie's field config (gacha/<movie>.gacha) and stops
// with C3032 "result rarity mismatch" when the ball doesn't land on the unit's rarity. The recorded tables
// (assets/gacha_movie_seeds.json, gacha_rate_up_movie_seeds.json) only fit the normal / normal_guarantee fields:
// on the fes field (7 amulets, other odds) 22 of 23 recorded 5★ seeds land wrong, and the rate-up table fits none of
// the CN fields (13 of 14 5★ seeds wrong on normal_guarantee). This runs seeds through the game's own field code
// (transpile.cjs) on every movie the banners use.
//
// First it checks the code against the recorded table (every seed must land on its rarity), then scans.
// Usage (from the repo): node scripts/gacha_seeds/transpile.cjs && node --env-file=.env scripts/gacha_seeds/gen_movie_seeds.cjs
// Layout: { <movie>: { "1"|"2"|"3" (5★/4★/3★): [seeds] } }; a rarity a movie's field can't give is left out
// (e.g. 3★ on normal_guarantee).
const fs = require("fs"), path = require("path")
const { loadConfigs, runField } = require("./field.cjs")
const REPO = path.join(__dirname, "..", "..")
const MOVIES = ["normal", "normal_guarantee", "fes", "fes_guarantee", "rarity_5_guarantee"]
const WANT = { "1": 150, "2": 400, "3": 600 } // seeds per movie and rarity, at most
const starsKey = rarity => String(3 - rarity) // ball rarity 2 (5★) -> "1"

;(async () => {
    const configs = await loadConfigs(MOVIES)
    // the check: the recorded normal seeds (incl. 40 that play the ball movie) must land as recorded
    const recorded = JSON.parse(fs.readFileSync(path.join(REPO, "assets", "gacha_movie_seeds.json"), "utf8"))
    let checked = 0
    for (const [key, byMovie] of Object.entries(recorded)) for (const [type, seeds] of Object.entries(byMovie)) {
        const config = configs[type === "0" ? "normal" : "normal_guarantee"]
        for (const seed of seeds) {
            const { rarity } = runField(seed, config)
            if (starsKey(rarity) !== key) throw new Error(`recorded seed ${seed} lands on ${5 - Number(starsKey(rarity)) + 1}★ here: the converted code is off`)
            checked++
        }
    }
    console.log(`checked ${checked} recorded seeds: all land as recorded`)

    const out = Object.fromEntries(MOVIES.map(m => [m, { "1": [], "2": [], "3": [] }]))
    const SCAN = 300000 // seeds 10000000 on; every movie fills its rarities well before this
    for (let seed = 10000000; seed < 10000000 + SCAN; seed++) {
        let open = false
        for (const movie of MOVIES) {
            const byStars = out[movie]
            if (Object.entries(byStars).every(([k, l]) => l.length >= WANT[k])) continue
            open = true
            // the highest rarity still wanted (ball rarity 2/1/0 = 5★/4★/3★): seeds starting above it skip the movie
            const maxRarity = Math.max(...Object.entries(byStars).filter(([k, l]) => l.length < WANT[k]).map(([k]) => 3 - Number(k)))
            const result = runField(seed, configs[movie], maxRarity)
            if (result.skipped) continue
            const list = byStars[starsKey(result.rarity)]
            const key = Object.keys(byStars).find(k => byStars[k] === list)
            if (list.length < WANT[key]) list.push(seed)
        }
        if (!open) break
    }
    for (const byStars of Object.values(out)) for (const k of Object.keys(byStars)) if (byStars[k].length === 0) delete byStars[k]
    const file = path.join(REPO, "assets", "gacha_seeds_by_movie.json")
    fs.writeFileSync(file, JSON.stringify(out))
    console.log(`wrote ${path.relative(REPO, file)}:\n` + Object.entries(out).map(([m, v]) => `  ${m}: ` + Object.entries(v).map(([k, l]) => `${6 - Number(k)}★ ${l.length}`).join(", ")).join("\n"))
})().catch(e => { console.error(e.message); process.exit(1) })
