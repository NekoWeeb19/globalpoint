// Enemy strength (dashboard first tab, .database/enemy_settings.json): every enemy's HP and attack multiplied,
// written into the CN game update by scripts/gen_cn_event_schedule.cjs.
//
// How the CN 1.8.1 client gets an enemy's numbers (EnemySourceBase; table parsers BossLevelValues,
// ZakoLevelValues, FunnelLevelValues, all one layout):
//   column 0  HP kind: "0" hit-based, "1" fixed
//   hit:   HP = 375 x party ATK curve x HP curve x hits (column 2) x correction (column 3) x ...
//   fixed: HP = HP curve x base HP (column 5) x correction (column 6) x ...
//   attack = 645 x party HP curve x ATK curve x ... x correction (column 9) x ...
// Every factor multiplies, so scaling column 3 or 6 scales HP and column 9 scales attack by exactly that.
// The shared curves (battle/enemy/...) are bundled in the app (empty in the download), so they aren't used here.
// Quest-level corrections exist only for some quest kinds; these per-enemy rows cover every battle.
// Bosses, regular enemies ("zako") and boss summons ("funnel"); breakable blocks are left alone.
const fs = require("fs")
const path = require("path")

const TABLES = ["master/battle/boss/boss_level.orderedmap", "master/battle/zako/zako_level.orderedmap", "master/battle/boss/funnel_level.orderedmap"]
const FILE = "enemy_settings.json"
const MIN = 0.1, MAX = 10
const HIT_HP = 3, FIX_HP = 6, ATK = 9

const valid = v => typeof v === "number" && Number.isFinite(v) && v >= MIN && v <= MAX

/** The saved multipliers ({ hp, atk }, 1 when unset or unreadable). */
function readEnemyScaling(dataDir) {
    try {
        const j = JSON.parse(fs.readFileSync(path.join(dataDir, FILE), "utf8"))
        return { hp: valid(j.hp) ? j.hp : 1, atk: valid(j.atk) ? j.atk : 1 }
    } catch {
        return { hp: 1, atk: 1 }
    }
}
const isDefault = s => s.hp === 1 && s.atk === 1

// a number as the tables write them (no float noise: 2.7 x 1.5 = 4.05, not 4.050000000000001)
const fmt = n => String(Number(n.toPrecision(12)))
const times = (text, k) => { const n = Number(text); return text === "" || !Number.isFinite(n) ? text : fmt(n * k) }

/** One enemy row's columns with the multipliers applied (a new array). */
function scaleColumns(cols, s) {
    const c = [...cols]
    if (c[0] === "0") c[HIT_HP] = times(c[HIT_HP] ?? "", s.hp)
    else if (c[0] === "1") c[FIX_HP] = times(c[FIX_HP] ?? "", s.hp)
    c[ATK] = times(c[ATK] ?? "", s.atk)
    return c
}

/** Applies the multipliers to every row of one enemy table (a cdn_rows tree). Returns the rows changed. */
function scaleTree(tree, s, R) {
    let n = 0
    for (const { leaf } of R.leaves(tree)) {
        const end = leaf.text.endsWith("\n") ? "\n" : ""
        const lines = R.splitCsvLines(leaf.text.replace(/\n$/, ""))
        const cols = R.splitCsv(lines[0])
        if (cols.length < 10) continue
        lines[0] = scaleColumns(cols, s).map(R.csvField).join(",")
        R.setLeafText(leaf, lines.join("\n") + end)
        n++
    }
    return n
}

module.exports = { TABLES, FILE, MIN, MAX, readEnemyScaling, isDefault, scaleColumns, scaleTree, valid }
