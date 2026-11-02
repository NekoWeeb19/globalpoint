// The CN client's passes ("The Way of Practice", a monthly pass: pass missions give pass points, and
// every level of points unlocks a free reward and a premium one). From CN's tables, the newest copy
// the CN client has (the dashboard schedule's files first, so a pass moved on the Events tab has its
// new dates). Dates are turned from China time (UTC+8) into UTC.
//
//   master/pass_card/pass_card_event: 0 dev name, 1 name, 2 banner, 4 point cap, 5 points per level,
//     8 start, 9 end, 10 when its rewards stop being claimable
//   master/pass_card/pass_card_reward: 0 pass, 1 level, 2..7 free reward, 8..13 premium reward
//     (each: kind, amount, item, unit, armament, title; kinds as in mission rewards)
//
//   node --env-file=.env scripts/gen_cn_pass_card.cjs   -> assets/pass_card_cn.json
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { hashed, readCn } = require("./cn_read.cjs")

const ROOT = path.join(__dirname, "..")
const { cdnDir, generatedDir } = require("./cn_archives.cjs")
const OUT = path.join(generatedDir(), "pass_card_cn.json")
const SCHEDULED = path.join(cdnDir(), "cn_schedule_files")
const TRANSLATED = require("./cn_archives.cjs").cnTextDir()

const NONE = v => v === undefined || v === "" || v === "(None)"
const int = v => (NONE(v) ? undefined : Number(v))
const utc = v => {
    if (NONE(v)) return null
    const ms = Date.parse(v.replace(" ", "T") + "Z")
    return isNaN(ms) ? null : new Date(ms - 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ")
}

async function cnTable(logical) {
    const file = hashed(logical)
    const listFile = path.join(TRANSLATED, "files.json")
    const translatedFrom = new Map(fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, "utf8")).map(f => [f.path, f.from]) : [])
    let buf = null
    for (const p of [path.join(SCHEDULED, file), translatedFrom.get(file), path.join(TRANSLATED, file)]) {
        if (p && fs.existsSync(p)) { buf = fs.readFileSync(p); break }
    }
    buf ??= await readCn(logical)
    if (buf === null) throw new Error(`CN table not found: ${logical}`)
    const out = {}
    for (const { path: keys, leaf } of R.leaves(R.decodeFile(buf))) out[keys.join("/")] = R.splitCsv(leaf.text.replace(/\n$/, ""))
    return out
}

function reward(c, at) {
    const kind = int(c[at])
    if (kind === undefined) return null
    const out = { kind, amount: int(c[at + 1]) ?? 0 }
    const [itemId, characterId, equipmentId, degreeId] = [int(c[at + 2]), int(c[at + 3]), int(c[at + 4]), int(c[at + 5])]
    if (itemId !== undefined) out.itemId = itemId
    if (characterId !== undefined) out.characterId = characterId
    if (equipmentId !== undefined) out.equipmentId = equipmentId
    if (degreeId !== undefined) out.degreeId = degreeId
    return out
}

;(async () => {
    const passes = {}
    for (const [id, c] of Object.entries(await cnTable("master/pass_card/pass_card_event.orderedmap"))) {
        passes[id] = { dev: c[0], pointCap: int(c[4]) ?? 0, levelPoints: int(c[5]) ?? 1, start: utc(c[8]), end: utc(c[9]), close: utc(c[10]) }
    }
    const rewards = {}
    for (const [id, c] of Object.entries(await cnTable("master/pass_card/pass_card_reward.orderedmap"))) {
        const free = reward(c, 2), premium = reward(c, 8)
        if (free === null && premium === null) continue
        rewards[id] = { pass: int(c[0]), level: int(c[1]), free, premium }
    }
    // pass point packs sold for beads in the special pack shop (shop type 3): column 9 price kind
    // (0 beads), 10 price, 23 buy limit, 27/28/29 product (kind 6 = pass points, amount in 29)
    const pointPacks = {}
    for (const [id, c] of Object.entries(await cnTable("master/shop/special_pack_shop.orderedmap"))) {
        if (c[9] !== "0" || c[27] !== "6") continue
        pointPacks[id] = { name: c[3], beads: int(c[10]) ?? 0, points: int(c[29]) ?? 0, limit: int(c[23]) ?? null }
    }
    fs.writeFileSync(OUT, JSON.stringify({ passes, rewards, pointPacks }))
    const open = Object.entries(passes).filter(([, p]) => p.end > "2026").map(([id, p]) => `${id} (${p.start} - ${p.end})`)
    console.log(`Wrote ${OUT}: ${Object.keys(passes).length} passes, ${Object.keys(rewards).length} rewards, ${Object.keys(pointPacks).length} point packs; open past 2026: ${open.join(", ") || "none"}`)
})().catch(e => { console.error(e); process.exit(1) })
