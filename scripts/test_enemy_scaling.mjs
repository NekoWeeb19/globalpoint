// Tests the enemy strength setting (scripts/enemy_scaling.cjs) without the game files: the columns it
// multiplies in the CN enemy rows (boss_level, zako_level, funnel_level), the saved file, and that a change
// makes the server rebuild the CN update (schedule fingerprint).
//
//   node scripts/test_enemy_scaling.mjs
import { createRequire } from "module"
import fs from "fs"
import os from "os"
import path from "path"

const require = createRequire(import.meta.url)
const ES = require("./enemy_scaling.cjs")
const { scheduleFingerprint } = require("./schedule_fingerprint.cjs")
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enemy-scaling-"))

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

try {
    // rows as CN has them (2026-11-04)
    const hit = "0,hit_hp_basic_normal,400,2.7,hit_hp_boss,,,atk_basic_normal,13.3,1,atk_single,tp_normal,60".split(",")
    const fix = "1,fix_hp_basic_normal,,,,7,1,atk_basic_normal,1,1,atk_correction_normal,tp_basic_normal,1".split(",")
    const s = { hp: 1.5, atk: 1.2 }

    const h = ES.scaleColumns(hit, s)
    check("hit-based HP: the correction (column 3) is multiplied, nothing else but attack", h[3] === "4.05" && h[2] === "400" && h[9] === "1.2" && h.filter((v, i) => v !== hit[i]).length === 2, h)
    const f = ES.scaleColumns(fix, s)
    check("fixed HP: column 6 is multiplied (base HP in column 5 stays a whole number)", f[6] === "1.5" && f[5] === "7" && f[9] === "1.2", f)
    check("the row given isn't changed", hit[3] === "2.7")
    check("1x changes nothing", ES.scaleColumns(hit, { hp: 1, atk: 1 }).join() === hit.join())

    // the saved file
    check("no file: 1x", JSON.stringify(ES.readEnemyScaling(dir)) === JSON.stringify({ hp: 1, atk: 1 }))
    const before = scheduleFingerprint(dir)
    fs.writeFileSync(path.join(dir, ES.FILE), JSON.stringify({ hp: 1, atk: 1 }))
    check("a saved 1x doesn't change the fingerprint (no rebuild for installs that never set it)", scheduleFingerprint(dir) === before)
    fs.writeFileSync(path.join(dir, ES.FILE), JSON.stringify({ hp: 1.5, atk: 1.2 }))
    check("the file is read", JSON.stringify(ES.readEnemyScaling(dir)) === JSON.stringify({ hp: 1.5, atk: 1.2 }))
    check("a set strength changes the fingerprint (the server rebuilds at start, e.g. after a Wi-Fi copy)", scheduleFingerprint(dir) !== before)
    fs.writeFileSync(path.join(dir, ES.FILE), JSON.stringify({ hp: 50, atk: "x" }))
    check("out-of-range or unreadable values count as 1x", JSON.stringify(ES.readEnemyScaling(dir)) === JSON.stringify({ hp: 1, atk: 1 }))
    check("the tables are boss_level, zako_level and funnel_level", ES.TABLES.map(t => t.split("/").pop()).join() === "boss_level.orderedmap,zako_level.orderedmap,funnel_level.orderedmap")
} finally {
    fs.rmSync(dir, { recursive: true, force: true })
}

console.log(failures === 0 ? "enemy strength: all passed" : `enemy strength: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
