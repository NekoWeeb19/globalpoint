// Each battle stage's element (its "recommended element"), for the element-material drops (score reward
// type 6: id 1-3 = tier, the item depends on the stage, see src/lib/quest.ts), plus the global
// reward_element_map table that names those items.
//
// The element column isn't at the same place in every quest table: it is found per table as the
// column two after the stage's drop group (main quest: drop group 70, element 72), checked to hold 0-5.
//
//   node scripts/gen_quest_elements.cjs  -> assets/quest_elements.json, assets/reward_element_map.json
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")

const ROOT = path.join(__dirname, "..")
const { uploadPath: hashed } = require("./cdn_hash.cjs")

async function rowsOf(logical) {
    const buf = await R.readHashedFile(hashed(logical)).catch(() => null)
    if (!buf) return null
    return R.leaves(R.decodeFile(buf)).map(({ path: keys, leaf }) => ({ keys, f: R.splitCsv(leaf.text) }))
}

;(async () => {
    const out = {}
    for (const file of fs.readdirSync(path.join(ROOT, "assets")).filter(f => f.endsWith("_quest.json"))) {
        const quests = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", file), "utf8"))
        // { questId: { scoreRewardGroup } } (flat) or nested by event id
        const byId = {}
        const walk = (o, key) => {
            if (!o || typeof o !== "object") return
            if (typeof o.scoreRewardGroup === "number") { byId[key] = o.scoreRewardGroup; return }
            for (const [k, v] of Object.entries(o)) walk(v, k)
        }
        walk(quests, null)
        if (Object.keys(byId).length === 0) continue
        const name = file.replace(/\.json$/, "")
        const rows = (await rowsOf(`master/quest/${name}.orderedmap`)) ?? (await rowsOf(`master/quest/event/${name}.orderedmap`))
        if (!rows) { console.log(`${name}: no master table`); continue }
        // the quest id is the first field or the last key; the drop group's column is where it matches
        const idOf = r => byId[r.f[0]] !== undefined ? r.f[0] : String(r.keys[r.keys.length - 1])
        const votes = new Map()
        for (const r of rows) {
            const g = byId[idOf(r)]
            if (g === undefined) continue
            r.f.forEach((v, i) => { if (v === String(g)) votes.set(i, (votes.get(i) ?? 0) + 1) })
        }
        const groupCol = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
        if (groupCol === undefined) { console.log(`${name}: drop group column not found`); continue }
        const col = groupCol + 2
        const found = {}
        let ok = 0, total = 0
        for (const r of rows) {
            const id = idOf(r)
            if (byId[id] === undefined) continue
            total++
            const v = r.f[col]
            if (/^[0-5]$/.test(v)) { found[id] = Number(v); ok++ }
        }
        if (ok / Math.max(total, 1) < 0.8) { console.log(`${name}: column ${col} isn't an element (${ok}/${total})`); continue }
        out[name] = found
        console.log(`${name}: drop group col ${groupCol}, element col ${col}, ${ok}/${total} stages`)
    }
    fs.writeFileSync(path.join(ROOT, "assets", "quest_elements.json"), JSON.stringify(out))

    // reward_element_map: kind (1 element, 2 aether) / tier / enemy element -> item id
    const map = {}
    for (const { keys, f } of await rowsOf("master/reward/reward_element_map.orderedmap")) {
        const [kind, tier, el] = keys.map(String)
        ;((map[kind] ??= {})[tier] ??= {})[el] = Number(f[0])
    }
    fs.writeFileSync(path.join(ROOT, "assets", "reward_element_map.json"), JSON.stringify(map, null, 1))
    console.log("reward_element_map:", JSON.stringify(map).slice(0, 200))
})().catch(e => { console.error(e); process.exit(1) })
