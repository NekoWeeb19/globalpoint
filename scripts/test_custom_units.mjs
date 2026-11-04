// Tests custom units (docs/CUSTOM_UNITS.md, scripts/custom_units.cjs) without the game files: the unit file
// checks, adding rows to a table (encoded and read back like the CN schedule build does), and the server
// knowing the unit (src/lib/assets.ts: character, Mana Boards, a summon pool) from the example unit
// docs/examples/custom_units/111907.json.
//
//   npx tsc
//   node scripts/test_custom_units.mjs
import { createRequire } from "module"
import fs from "fs"
import os from "os"
import path from "path"

const require = createRequire(import.meta.url)
const CU = require("./custom_units.cjs")
const R = require("./cdn_rows.cjs")

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const example = JSON.parse(fs.readFileSync(new URL("../docs/examples/custom_units/111907.json", import.meta.url), "utf8"))

// unit file checks
check("the example unit has no problems", CU.unitProblems(example).length === 0, CU.unitProblems(example))
check("Mana Board node ids are unit * 2000 + board * 200 + index", CU.manaNodeId(111907, 1, 1) === 223814201 && CU.manaNodeId(111907, 2, 3) === 223814403)
const badNode = { ...example, manaNodes: { 1: { "222138201": {} } } }
check("a Mana Board node id of another unit is refused", CU.unitProblems(badNode).some(p => p.includes("222138201")))
check("a bad unit id is refused", CU.unitProblems({ ...example, id: "1234" }).length > 0)
check("an id outside the digit pattern is fine when not summoned", CU.unitProblems({ ...example, id: "700050", manaNodes: {}, rows: {} }).length === 0)
check("a summonable unit's first digit must match its rarity", CU.unitProblems({ ...example, id: "211907", banners: ["1613"], manaNodes: {}, rows: {} }).length === 1
    && CU.unitProblems({ ...example, banners: ["1613"] }).length === 0)
check("a table by stored path or logical name", CU.tableFile("upload/2d/5cb9b28d18f984a51b345a4d7aab03d77bddfc") === CU.CHARACTER_TABLE
    && CU.tableFile("master/character/character.orderedmap") === CU.CHARACTER_TABLE)

// rows added to a table, encoded and read back
const original = R.decodeFile(R.encodeFile({ kind: "map", entries: [
    { key: "111069", node: { kind: "map", entries: [{ key: "1", node: { kind: "leaf", text: "100,10\n" } }, { key: "10", node: { kind: "leaf", text: "200,20\n" } }] } },
    { key: "111001", node: { kind: "leaf", text: "vagner,1,5\n" } },
] }))
const tree = R.decodeFile(R.encodeFile(original))
const statusRows = example.rows["upload/5c/6a4f0e2ceb1dbcf60f9b306b0f7bfd0eca55c9"]
check("rows are added", CU.addRows(tree, statusRows) === 1)
CU.addRows(tree, statusRows) // a second time replaces, never doubles
const back = R.decodeFile(R.encodeFile(tree))
check("the new unit's rows read back the same", JSON.stringify(CU.fromNode(back.entries.find(e => e.key === "111907").node)) === JSON.stringify(statusRows["111907"]))
check("added once", back.entries.filter(e => e.key === "111907").length === 1)
check("the table's own rows are unchanged", JSON.stringify(CU.fromNode(back.entries.find(e => e.key === "111069").node)) === JSON.stringify({ 1: "100,10\n", 10: "200,20\n" })
    && back.entries.find(e => e.key === "111001").node.text === "vagner,1,5\n")

// a folder of unit files: problems are listed, never thrown
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "custom-units-"))
fs.writeFileSync(path.join(dir, "111907.json"), JSON.stringify({ ...example, banners: ["1613"] }))
fs.writeFileSync(path.join(dir, "broken.json"), "{ not json")
fs.writeFileSync(path.join(dir, "_notes.json"), "{ ignored")
const read = CU.readCustomUnits(dir)
check("a folder: good units read, broken files listed", read.units.length === 1 && read.problems.length === 1 && read.fingerprint !== "", read.problems)
check("tables a unit touches", CU.unitTables(read.units).length === 19)
check("no folder: no units, no fingerprint", CU.readCustomUnits(path.join(dir, "none")).fingerprint === "")

// the server merges the unit (read at start, so the folder is set before loading)
fs.rmSync(path.join(dir, "broken.json"))
process.env.CUSTOM_UNITS_DIR = dir
const assets = await import("../out/lib/assets.js")
const character = assets.getCharacterDataSync(111907)
check("the server knows the unit", character?.rarity === 5 && character?.cn === true, character)
check("a CN unit is still there", assets.getCharacterDataSync(111069) !== null)
check("Mana Board 1 nodes", assets.getCharacterManaNodeSync(111907, 1, 223814201) !== null)
check("Mana Board 2 nodes", Object.keys(assets.getCharacterManaNodesSync(111907, 2) ?? {}).length > 0)
const gachas = require("../assets/gacha.json")
const tier = assets.getGachaSync(1613).pool["1"]
const sum = list => list.reduce((s, item) => s + item.rarity, 0)
check("the summon pool has the unit", tier.some(item => item.id === 111907))
check("the pool's weights still sum the same", Math.abs(sum(tier) - sum(gachas["1613"].pool["1"])) < 1e-6, [sum(tier), sum(gachas["1613"].pool["1"])])
check("other banners are untouched", assets.getGachaSync(1).pool["1"]?.some(item => item.id === 111907) !== true)

// "Download from PC" (src/routes/companion.ts): the unit files and their index always come along
const { default: Fastify } = await import("fastify")
const app = Fastify()
await app.register((await import("../out/routes/companion.js")).default, { prefix: "/companion" })
const manifest = JSON.parse((await app.inject({ url: "/companion/manifest?save=0&patches=0&images=0&comics=0&schedule=0&game=0" })).body)
const unitPaths = manifest.files.map(f => f.path).filter(p => p.startsWith(".cdn/custom_units/"))
check("the Wi-Fi copy lists the unit file and the index", JSON.stringify(unitPaths) === JSON.stringify([".cdn/custom_units/111907.json", ".cdn/custom_units/_units.json"]), unitPaths)
const index = JSON.parse((await app.inject({ url: "/companion/file?path=.cdn/custom_units/_units.json" })).body)
check("the index names every unit file", JSON.stringify(index.units) === JSON.stringify(["111907.json"]), index)
const sentUnit = (await app.inject({ url: "/companion/file?path=.cdn/custom_units/111907.json" })).body
check("the unit file is sent as it is", sentUnit === fs.readFileSync(path.join(dir, "111907.json"), "utf8"))
fs.rmSync(path.join(dir, "111907.json"))
const emptied = JSON.parse((await app.inject({ url: "/companion/manifest?save=0" })).body).files.map(f => f.path).filter(p => p.startsWith(".cdn/custom_units/"))
check("with no units only the index goes (the phone then removes its copies)", JSON.stringify(emptied) === JSON.stringify([".cdn/custom_units/_units.json"]), emptied)
await app.close()
fs.rmSync(dir, { recursive: true, force: true })

console.log(failures === 0 ? "\nAll custom unit tests passed." : `\n${failures} custom unit test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
