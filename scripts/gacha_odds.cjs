// The summon rates on the in-game Rates screen: the dashboard's Summon rates (.database/gacha_rates.json,
// src/nya/gachaRates.ts) written into the game's rarity tables in the CN update by scripts/gen_cn_event_schedule.cjs,
// so the screen shows what the server really draws.
//
// A banner row names its rarity table in column 11 (master/gacha/gacha.orderedmap); each table is
// master/gacha_odds/<name>.orderedmap with one row per rarity, "<name>/<n>" = "<rarity>,<weight>" (the screen shows
// weight / total). Three of them follow the dashboard's rows:
//   normal_rarity            every unit banner        (dashboard "normal",   base 5 / 25 / 70)
//   fes_rarity               Star Fest / Meteor Fest. (dashboard "fes",      base 7.5 / 25 / 67.5)
//   equipment_normal_rarity  armament portals         (dashboard "armament", base 5 / 25 / 70)
// The 4&5-star, guaranteed-5-star and tutorial tables (rare_rarity, rearity_5_guarantee_rarity, tutorial_rarity) are
// fixed by design and left alone. Weights are written out of 1000, so 0.1% steps show exactly.
const fs = require("fs")
const path = require("path")

const FILE = "gacha_rates.json"
const TABLE_OF = { normal: "normal_rarity", fes: "fes_rarity", armament: "equipment_normal_rarity" }
const TABLES = Object.values(TABLE_OF).map(name => `master/gacha_odds/${name}.orderedmap`)
/** the base game's rates (as src/nya/gachaRates.ts DEFAULT_GACHA_RATES) */
const DEFAULTS = { normal: { star5: 5, star4: 25 }, fes: { star5: 7.5, star4: 25 }, armament: { star5: 5, star4: 25 } }

const okRate = v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 && Math.abs(Math.round(v * 10) - v * 10) < 1e-9
const okKind = r => !!r && okRate(r.star5) && okRate(r.star4) && r.star5 + r.star4 <= 100 + 1e-9

/** The saved rates per kind (the base game's for a kind unset or unusable), as gachaRates.ts reads them. */
function readGachaRates(dataDir) {
    let saved = {}
    try { saved = JSON.parse(fs.readFileSync(path.join(dataDir, FILE), "utf8")) ?? {} } catch { }
    const out = {}
    for (const kind of Object.keys(DEFAULTS)) out[kind] = okKind(saved[kind]) ? { star5: saved[kind].star5, star4: saved[kind].star4 } : { ...DEFAULTS[kind] }
    return out
}
const isDefault = rates => Object.keys(DEFAULTS).every(k => rates[k].star5 === DEFAULTS[k].star5 && rates[k].star4 === DEFAULTS[k].star4)

/** The rows of one rarity table for a kind's rates: { "<name>/0": "5,<w>", "/1": "4,<w>", "/2": "3,<w>" } (weights out of 1000). */
function rowsFor(name, r) {
    const w5 = Math.round(r.star5 * 10), w4 = Math.round(r.star4 * 10)
    return { [`${name}/0`]: `5,${w5}`, [`${name}/1`]: `4,${w4}`, [`${name}/2`]: `3,${1000 - w5 - w4}` }
}

/** Writes the rates into one rarity table (a cdn_rows tree, identified by its logical name). Returns the rows changed. */
function writeTree(tree, logical, rates, R) {
    const kind = Object.keys(TABLE_OF).find(k => logical === `master/gacha_odds/${TABLE_OF[k]}.orderedmap`)
    if (!kind) return 0
    const rows = rowsFor(TABLE_OF[kind], rates[kind])
    let n = 0
    for (const { path: keys, leaf } of R.leaves(tree)) {
        const key = keys.join("/")
        if (rows[key] === undefined) continue
        const end = leaf.text.endsWith("\n") ? "\n" : ""
        if (leaf.text.replace(/\n$/, "") === rows[key]) continue
        R.setLeafText(leaf, rows[key] + end)
        n++
    }
    return n
}

module.exports = { FILE, TABLE_OF, TABLES, DEFAULTS, readGachaRates, isDefault, rowsFor, writeTree }
