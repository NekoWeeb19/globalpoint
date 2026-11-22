// Tests assets/kit_dates.json (unit kits before global's balance patches) against the patch notes: every unit and
// armament a patch changed has a stage at that patch's date, except the ones listed below with the reason.
// Needs global's game files (.cdn/en) for the unit and armament names.
// Run: node scripts/test_kit_dates.mjs (or node scripts/run_tests_full.cjs <full checkout> kit_dates from a worktree)
import assert from "node:assert/strict"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const R = require("./cdn_rows.cjs")
const { readTable } = require("./cdn_master.cjs")
const { readKits, unitNameLookup } = require("./kit_dates.cjs")

const kitFile = new URL("../assets/kit_dates.json", import.meta.url)
const raw = JSON.parse(require("fs").readFileSync(kitFile, "utf8"))
const kits = readKits(kitFile)
const PATCHES = [
    { file: "../assets/balance_global_2022-05-31.json", until: "2022-04-19 06:00:00" },
    { file: "../assets/balance_global_2023-09-12.json", until: "2023-08-01 06:00:00" },
]
const PATCH_DATES = ["2022-04-19 06:00:00", "2023-08-01 06:00:00", "2024-04-15 06:00:00"]
// changed by a patch, with no stage on purpose
const NO_STAGE = {
    "Adventurous Pup Lou": "the 2022 patch changed only his skill's behavior (its action file); no old copy exists",
}

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log("ok", name) }

const text = await readTable("master/character/character_text.orderedmap", false)
const idOf = unitNameLookup(text, R.splitCsv)
const equipment = await readTable("master/item/equipment.orderedmap", false)
const armamentId = new Map(Object.entries(equipment).map(([id, t]) => [R.splitCsv(t)[1], id]))
const stageAt = (key, until) => Object.values(raw[key]?.stages ?? [raw[key] ?? {}]).find(s => s.until === until)

for (const { file, until } of PATCHES) {
    const note = require(file)
    const units = [...new Set(note.units.map(r => r.unit))]
    check(`${until.slice(0, 10)}: every changed unit (${units.length}) has a stage`, () => {
        const missing = []
        for (const name of units) {
            const id = idOf(name)
            assert.ok(id, `${name}: no unit of that name`)
            if (NO_STAGE[name]) { assert.equal(stageAt(id, until), undefined, `${name} has a stage now: take it off NO_STAGE`); continue }
            const stage = stageAt(id, until)
            if (!stage || Object.keys(stage.rows).length === 0) missing.push(`${name} (${id})`)
        }
        assert.deepEqual(missing, [])
    })
    if (!note.armamentRows) continue
    const armaments = note.armamentRows.filter(r => r[2] === "Before" && r.length === 7).map(r => r[0])
    check(`${until.slice(0, 10)}: every changed armament (${armaments.length}) has a stage`, () => {
        const missing = armaments.filter(name => {
            const id = armamentId.get(name)
            assert.ok(id, `${name}: no armament of that name`)
            return !stageAt(`armament:${id}`, until)
        })
        assert.deepEqual(missing, [])
    })
}

check("every stage ends on one of the three patch dates", () => {
    for (const [key, kit] of Object.entries(raw)) {
        if (key.startsWith("_")) continue
        for (const s of kit.stages ?? [kit]) assert.ok(PATCH_DATES.includes(s.until), `${key}: stage until ${s.until}`)
    }
})

check("an earlier stage carries every row of the unit's later stages (stages are cumulative)", () => {
    for (const [key, stages] of kits) {
        for (let i = 0; i < stages.length; i++)
            for (let j = i + 1; j < stages.length; j++)
                for (const ref of Object.keys(stages[j].rows)) assert.ok(ref in stages[i].rows, `${key}: ${ref} missing from an earlier stage`)
    }
})

check("rows are full row text or a column patch", () => {
    for (const [key, stages] of kits)
        for (const s of stages)
            for (const [ref, row] of Object.entries(s.rows)) {
                assert.match(ref, /^[^#]+#.+$/, `${key}: row key ${ref}`)
                assert.ok(typeof row === "string" ? row.length > 0 : row && typeof row.cols === "object", `${key}: ${ref}`)
            }
})

console.log(`${checks} checks passed`)
