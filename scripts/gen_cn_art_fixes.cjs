// Small art fixes for the CN game that ship with the server code: every server (PC or companion) puts these files
// into its own CN game update (scripts/gen_cn_event_schedule.cjs), so players get them with a normal update, no new
// data pack or OBB. Run here (it needs both CN's and global's game files); the result is in the repo:
//   assets/cn_art_fixes.json      [{ path, from, why }]   path = the file's stored path in the game files
//   assets/cn_art_fixes/<path>    the files themselves
//
// Rules (checked against every unit in CN's character table; CN's files never change again, so the list is final):
//  1. A unit's pixel sprite (pixelart/sprite_sheet or pixelart/special_sprite_sheet) whose CN layout lists other
//     frames than global's while the animation timing file is the same as global's: CN's frames don't fit the timing,
//     and the animation plays out of order with pieces all over the screen (Vagner's summon animation, a player's
//     report, 2026-11-11; the only unit found). Global's picture and layout are used.
//  2. Guest units ("..._assist", e.g. Taiga's 2nd-anniversary guest in a world story event quest) have no square icon
//     in CN's or global's files; a screen that shows it stopped the game with U0000 ("notify_asset_recovery: asset
//     not found character/white_tiger_2anv_assist/ui/square_0.png", a player's crash log, 2026-11-11). The guest gets
//     its normal version's icons (the name without "_assist", else without its last part, e.g. stella_chapter12 ->
//     stella).
//
//   node --env-file=.env scripts/gen_cn_art_fixes.cjs
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const crypto = require("crypto")
const unzipper = require("unzipper")
const R = require("./cdn_rows.cjs")
const { cnZips, cnDir } = require("./cn_archives.cjs")
const { uploadPath: hashed } = require("./cdn_hash.cjs")
const { readCnTable } = require("./cn_read.cjs")
const { readAmf3 } = require("./amf3.cjs")
const { globalFile } = require("./build_cn_patch.cjs")

const ROOT = path.join(__dirname, "..")
const LIST = path.join(ROOT, "assets", "cn_art_fixes.json")
const DIR = path.join(ROOT, "assets", "cn_art_fixes")
const inflate = b => { try { return zlib.inflateRawSync(b) } catch { return zlib.inflateSync(b) } }
const sha = b => crypto.createHash("sha1").update(b).digest("hex")
const key = p => p.replace(/^production\/[a-z_]+\//, "production/upload/")

;(async () => {
    // CN's files by key (production/upload/..), with their stored path (some pictures are under medium_upload)
    const cn = new Map()
    for (const z of cnZips(cnDir())) for (const e of (await unzipper.Open.file(z)).files) {
        const stored = e.path.split("\\").join("/")
        cn.set(key(stored), { entry: e, stored })
    }
    const cnGet = async logical => { const f = cn.get(hashed(logical)); return f ? { data: await f.entry.buffer(), stored: f.stored } : null }
    const globalGet = async logical => { try { return await globalFile(hashed(logical)) } catch { return null } }

    const chars = await readCnTable("master/character/character.orderedmap")
    const devs = [...new Set(Object.values(chars).map(line => R.splitCsv(line.replace(/\n$/, ""))[0]).filter(Boolean))]
    const fixes = []

    // 1. pixel sprites whose frames don't fit the timing
    for (const dev of devs) for (const [sheet, timing] of [["sprite_sheet", "pixelart"], ["special_sprite_sheet", "special"]]) {
        const base = `character/${dev}/pixelart/`
        const [cP, cA, cT] = await Promise.all([cnGet(base + sheet + ".png"), cnGet(base + sheet + ".atlas.amf3.deflate"), cnGet(base + timing + ".timeline.amf3.deflate")])
        if (!cP || !cA || !cT) continue
        const [gP, gA, gT] = await Promise.all([globalGet(base + sheet + ".png"), globalGet(base + sheet + ".atlas.amf3.deflate"), globalGet(base + timing + ".timeline.amf3.deflate")])
        if (!gP || !gA || !gT || sha(cT.data) !== sha(gT)) continue
        const frames = b => readAmf3(inflate(b)).map(f => +f.n.slice(-4)).sort((x, y) => x - y).join(",")
        if (frames(cA.data) === frames(gA)) continue
        for (const [file, data, stored] of [[sheet + ".png", gP, cP.stored], [sheet + ".atlas.amf3.deflate", gA, cA.stored]])
            fixes.push({ path: stored, data, from: "global", why: `${base}${file}: CN's frames don't fit the animation timing` })
    }

    // 2. guest units' square icons, from their normal version: the guests in the unit list, and the ones quests name in
    // their battle_assist_character column (e.g. devil_leader_chapter11_assist in Chapter 11 isn't in the unit list)
    const guests = new Set(devs.filter(d => d.endsWith("_assist")))
    for (const table of ["master/quest/main_quest", "master/quest/ex_quest", "master/quest/character_quest", "master/quest/boss_battle_quest",
        "master/quest/event/advent_event_quest", "master/quest/event/challenge_dungeon_event_quest", "master/quest/event/expert_single_event_quest",
        "master/quest/event/hard_multi_event_quest", "master/quest/event/ranking_event_single_quest", "master/quest/event/story_event_single_quest",
        "master/quest/event/tower_dungeon_event_quest", "master/quest/event/world_story_event_boss_battle_quest", "master/quest/event/world_story_event_quest"]) {
        for (const line of Object.values((await readCnTable(table + ".orderedmap")) ?? {}))
            for (const m of line.matchAll(/(?<=^|,)[a-z0-9_]+_assist(?=,|$)/gm)) guests.add(m[0])
    }
    for (const dev of [...guests].sort()) {
        const names = []
        let name = dev.replace(/_assist$/, "")
        for (;;) { names.push(name); const cut = name.lastIndexOf("_"); if (cut < 0) break; name = name.slice(0, cut) }
        for (const icon of ["square_0.png", "square_1.png"]) {
            const target = `character/${dev}/ui/${icon}`
            if (cn.has(hashed(target))) continue
            for (const from of names) {
                const f = await cnGet(`character/${from}/ui/${icon}`)
                if (!f) continue
                // stored under the same upload folder as the picture it copies (medium_upload for unit icons)
                const folder = f.stored.slice(0, f.stored.indexOf("/", "production/".length) + 1)
                fixes.push({ path: folder + hashed(target).replace(/^production\/upload\//, ""), data: f.data, from: `character/${from}/ui/${icon}`, why: `${target}: missing; the normal version's icon` })
                break
            }
        }
    }

    // 3. boss models whose name no longer matches the boss table. Before some boss battles the game checks that the
    // boss group's name (standard_boss, column "name") equals the name inside the boss's model file
    // (<model>.esdl.amf3.deflate, field bx[1].a), else it stops with F0 ("ボスグループ名...が一致しません"; main
    // story chapter 12 "Cursed Sword", a player's log, 2026-11-12). The translation renamed both
    // (scripts/gen_cn_boss_models.cjs, update 1.4.83), but one Chinese name had two English names (女帝歼灭者:
    // "Modified Purger" in the table, "Purger Empress" in the model), and a later table update (1.4.136) renamed
    // Sticky King Polu in the table only. Bosses whose two names already differ in CN's own files are left alone
    // (the game doesn't check those). Read as the game has them after StarPoint's translation updates (up to
    // 1.4.800, the data pack's; later ones are schedule builds that carry these fixes, so they never feed back).
    {
        const patchDir = path.join(ROOT, ".cdn", "cn_patches")
        const num = v => v.split(".").map(Number).reduce((a, b) => a * 10000 + b, 0)
        const files = new Map([...cn].map(([k, f]) => [k, { entry: f.entry, stored: f.stored }]))
        for (const p of JSON.parse(fs.readFileSync(path.join(patchDir, "patches.json"), "utf8"))) {
            if (num(p.version) > num("1.4.800")) continue
            for (const a of p.archives) for (const e of (await unzipper.Open.file(path.join(patchDir, a.file))).files) {
                if (e.type !== "File") continue
                const stored = e.path.split("\\").join("/")
                files.set(key(stored), { entry: e, stored })
            }
        }
        const BOSS_TABLE = hashed("master/battle/boss/standard_boss.orderedmap")
        const rowsOf = async e => new Map(R.leaves(R.decodeFile(await e.buffer())).map(l => [l.path.join("/"), R.splitCsv(l.leaf.text)]))
        const cnTable = await rowsOf(cn.get(BOSS_TABLE).entry), table = await rowsOf(files.get(BOSS_TABLE).entry)
        const nameIn = data => { const o = readAmf3(data); return Array.isArray(o?.bx) ? o.bx[1]?.a : undefined }
        const literal = s => { const b = Buffer.from(s, "utf8"), n = (b.length << 1) | 1; return Buffer.concat([Buffer.from([0x06]), n < 0x80 ? Buffer.from([n]) : Buffer.from([(n >> 7) | 0x80, n & 0x7f]), b]) }
        const done = new Map() // model -> the name it was given
        for (const [row, c] of table) {
            const modelKey = hashed(c[1] + ".esdl.amf3.deflate"), file = files.get(modelKey), cnFile = cn.get(modelKey)
            if (!file || !cnFile) continue
            if (cnTable.get(row)?.[0] !== nameIn(inflate(await cnFile.entry.buffer()))) continue
            const data = inflate(await file.entry.buffer()), now = nameIn(data)
            if (now === c[0] || typeof now !== "string") continue
            if (done.has(c[1])) { if (done.get(c[1]) !== c[0]) console.log(`boss ${row}: model ${c[1]} already named "${done.get(c[1])}", table says "${c[0]}"`); continue }
            const from = literal(now), parts = []
            let at = 0, i
            while ((i = data.indexOf(from, at)) !== -1) { parts.push(data.subarray(at, i), literal(c[0])); at = i + from.length }
            parts.push(data.subarray(at))
            const fixed = Buffer.concat(parts)
            if (nameIn(fixed) !== c[0]) { console.log(`boss ${row}: renaming ${c[1]} failed; left alone`); continue }
            done.set(c[1], c[0])
            fixes.push({ path: file.stored, data: zlib.deflateRawSync(fixed, { level: 9 }), from: `${c[1]}.esdl.amf3.deflate`, why: `boss name "${now}" -> "${c[0]}", as standard_boss ${row}` })
        }
    }

    fs.rmSync(DIR, { recursive: true, force: true })
    for (const fix of fixes) {
        const out = path.join(DIR, fix.path)
        fs.mkdirSync(path.dirname(out), { recursive: true })
        fs.writeFileSync(out, fix.data)
    }
    fs.writeFileSync(LIST, JSON.stringify(fixes.map(({ path: p, from, why }) => ({ path: p, from, why })), null, 1))
    for (const fix of fixes) console.log(`${fix.path}  ${fix.why}`)
    console.log(`Wrote ${LIST}: ${fixes.length} files, ${(fixes.reduce((n, f) => n + f.data.length, 0) / 1024).toFixed(0)} KB`)
})().catch(e => { console.error(e); process.exit(1) })
