// RESEARCH proof of concept (docs/research/new-units.md): a NEW unit in the CN app from game data only,
// by cloning an existing CN unit under a new id and a new string id. Every table row the unit needs is
// copied to the new keys, and every file of the unit (art, voices, animations) is copied to new file
// names, so the result exercises the same path a hand-made unit would. Verified on the emulator
// (2026-11-03): mail, unit list, detail page, skill preview battle with its skill script, Mana Board.
//
//   node scripts/research/clone_cn_unit.cjs <out dir> [--files list.txt] [--newer <dir>]...
//     --files   logical paths of the source unit's own files (scripts/research/unit_files.cjs prints them)
//     --newer   a folder of update zips (pinball-*.zip) newer than this PC's .cdn/cn_patches, e.g. a phone's
//               own schedule builds; repeatable, oldest first. Tables are taken from the newest copy.
//   then: node scripts/build_cn_patch.cjs 1.4.9xx <device's last version> <out dir>/files.json
//         (with CDN_DIR pointing somewhere else than the real .cdn while testing)
//   <out dir>/server.json: the assets/character.json entry and assets/mana_node_cn.json board for the server.
//
// Limits (see the doc): the schedule rebuild ships 7 of these tables again WITHOUT the new rows, so a
// real feature needs these rows added inside scripts/gen_cn_event_schedule.cjs; this script is the test.
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const unzipper = require("unzipper")
const R = require("../cdn_rows.cjs")
const A = require("../amf3.cjs")
const { cnZips, cnDir, cdnDir } = require("../cn_archives.cjs")
const { uploadPath } = require("../cdn_hash.cjs")

// edit these for another unit
const SRC = { id: "111069", dev: "suzumiya_haruhi" }
const NEW = { id: "111907", dev: "gp_test_haruhi", name: "Haruhi (GP Test)", leaderName: "Clone of a Hero" }

// Mana node ids are unit * 2000 + board * 200 + index: the game finds a node's row from its id
// (GeneralManaNodeLogic.get_values: board = id / 200 % 10, index = id % 200).
const node = n => String(Number(n) - Number(SRC.id) * 2000 + Number(NEW.id) * 2000)
const devRe = new RegExp(SRC.dev, "g")

function csvMap(text, colFn) {
    const end = text.endsWith("\n") ? "\n" : ""
    return R.splitCsvLines(text.replace(/\n$/, "")).map((l, i) => {
        const c = R.splitCsv(l); colFn(c, i); return c.map(R.csvField).join(",")
    }).join("\n") + end
}

// Every per-unit table (stored path without production/ -> [old top key, new top key, row text change]).
// Found by scanning all 3,895 CN tables for the unit's id and string id (docs/research/new-units.md).
const TABLES = {
    "upload/2d/5cb9b28d18f984a51b345a4d7aab03d77bddfc": [[SRC.id, NEW.id, t => csvMap(t, c => { // master/character/character
        c[0] = NEW.dev; c[8] = NEW.dev; c[17] = NEW.id; c[18] = NEW.leaderName
        for (let i = 0; i < 6; i++) if (c[19 + i] !== "(None)") c[19 + i] = NEW.id + (i + 1)
        if (c[27] !== "(None)") c[27] = NEW.id
    })]],
    "upload/8b/035728b2151de044fb245988ec5f33ebb544ab": [[SRC.id, NEW.id, t => csvMap(t, c => { c[0] = NEW.name })]], // character_text
    "upload/5c/6a4f0e2ceb1dbcf60f9b306b0f7bfd0eca55c9": [[SRC.id, NEW.id, t => t]], // character_status
    "upload/b4/a28679b8eeefdbdcbe6071fd4f2ff85e5b3415": [[SRC.id, NEW.id, t => t]], // character_speech
    "upload/1e/664c1cc8d80f4f9a69aae2c49ae8c01d1c4001": [1, 2, 3, 4, 5, 6].map(n => [SRC.id + n, NEW.id + n, t => t.replace(devRe, NEW.dev)]), // ability
    "upload/ff/84353774cb95e8d7dc90c679f96a5bca7f42e5": [[SRC.id, NEW.id, t => t.replace(devRe, NEW.dev)]], // leader_ability
    "upload/91/79892d704f88d98191c00548bce106402ad5b5": [[SRC.dev, NEW.dev, t => t.replace(devRe, NEW.dev)]], // action_skill (col 7 = skill script)
    "upload/aa/abdd2e178d62dba4997034aab8c236a4422154": [[SRC.id, NEW.id, t => t]], // skill_preview_character
    "upload/d7/50c2f94f83dd053bfc79039a709f1ec6f766cb": [[SRC.id, NEW.id, t => t]], // stance_detail
    "upload/b9/132d27178d27f9d91df89fc47e106bbaf2d5b5": [[SRC.id, NEW.id, t => t]], // full_shot_image_attribute
    "upload/3e/b411841802398d5b21d422579f2eaa65d30c0e": [[SRC.id, NEW.id, t => t]], // character_image
    "upload/57/8872ecbc78561807e6846b3980c5dea980d8ce": [[SRC.id, NEW.id, t => t]], // upskill
    "upload/ac/b038c35f3048ba7ca07a6a84307b2fb10c041c": [[SRC.id, NEW.id, t => t]], // battle sound effects by frame
    "upload/1d/222e5126fc7ebe3f22c7efe87325f73742eb4f": [[SRC.id, NEW.id, t => csvMap(t, c => { c[0] = node(c[0]) })]], // mana_node
    "upload/27/7b65484214436114201ae654fefa60fdc822ea": [[SRC.id, NEW.id, t => csvMap(t, c => { // generated/mana_board
        c[0] = node(c[0]); if (c[5] && c[5] !== "(None)") c[5] = c[5].split(",").map(node).join(",")
    })]],
    "upload/61/408ec4cc67e1bcf9b4d74722f57ee2f95bd995": [["1" + SRC.id, "1" + NEW.id, t => csvMap(t, c => { // encyclopedia
        c[0] = c[0].replace(SRC.id, NEW.id); c[1] = "character_" + NEW.dev; c[5] = NEW.id; c[6] = NEW.dev
    })]],
    "upload/92/dcd1cc81f29794f0606ffe39f68d4e8740c8fa": [[SRC.dev, NEW.dev, t => csvMap(t, c => { // story_character
        c[0] = NEW.name; for (let i = 2; i < c.length; i++) c[i] = c[i].replace(devRe, NEW.dev)
    })]],
    "upload/bc/0bc800f482670f3ec8a7f2fee9b9deeeca3a04": [[SRC.id, NEW.id, t => t]], // mana_board2_open_condition
    // trimmed_image: keyed by picture path, one row per story/ui picture
    "upload/fb/ab4344a7456dca88f3ce06f01208922f37e395": "paths",
}

async function newestFiles(newer) {
    const map = new Map()
    const add = async file => {
        for (const e of (await unzipper.Open.file(file)).files)
            if (e.type === "File") map.set(e.path.split(String.fromCharCode(92)).join("/").replace(/^production\//, ""), e)
    }
    for (const z of cnZips()) await add(z)
    const pc = path.join(cdnDir(), "cn_patches") // StarPoint's own updates (translations, art) on this PC
    if (fs.existsSync(path.join(pc, "patches.json")))
        for (const p of JSON.parse(fs.readFileSync(path.join(pc, "patches.json"), "utf8")))
            for (const a of p.archives) if (fs.existsSync(path.join(pc, a.file))) await add(path.join(pc, a.file))
    for (const dir of newer) for (const z of fs.readdirSync(dir).filter(f => f.endsWith(".zip"))) await add(path.join(dir, z))
    return map
}

function clone(n, fn) {
    return n.kind === "leaf" ? { kind: "leaf", text: fn(n.text) } : { kind: "map", entries: n.entries.map(e => ({ key: e.key, node: clone(e.node, fn) })) }
}

/** An .amf3.deflate file with the old string id replaced inside (frame "name" fields, atlas names). */
function renameInside(data) {
    let raw = false, plain
    try { plain = zlib.inflateSync(data) } catch { plain = zlib.inflateRawSync(data); raw = true }
    const deep = v => typeof v === "string" ? v.replace(devRe, NEW.dev) : Array.isArray(v) ? v.map(deep)
        : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(devRe, NEW.dev), deep(x)])) : v
    const before = A.readAmf3(plain), after = deep(before)
    if (JSON.stringify(before) === JSON.stringify(after)) return data
    const enc = A.writeAmf3(after)
    return raw ? zlib.deflateRawSync(enc) : zlib.deflateSync(enc)
}

async function main() {
    const args = process.argv.slice(2)
    const out = args[0]
    if (!out) throw new Error("usage: clone_cn_unit.cjs <out dir> [--files list.txt] [--newer <dir>]...")
    const newer = [], opt = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1] }
    args.forEach((a, i) => { if (a === "--newer") newer.push(args[i + 1]) })
    const files = await newestFiles(newer)
    const list = []
    const server = { character: { [NEW.id]: null }, manaNodes: {} }

    for (const [file, rule] of Object.entries(TABLES)) {
        const entry = files.get(file)
        if (!entry) throw new Error("no table " + file)
        const tree = R.decodeFile(await entry.buffer())
        const rules = rule === "paths"
            ? tree.entries.filter(e => e.key.startsWith(`character/${SRC.dev}/`)).map(e => [e.key, e.key.replace(devRe, NEW.dev), t => t])
            : rule
        for (const [oldKey, newKey, fn] of rules) {
            const src = tree.entries.find(e => e.key === oldKey)
            if (!src) { console.log(`  (no row ${oldKey} in ${file})`); continue }
            tree.entries = tree.entries.filter(e => e.key !== newKey)
            tree.entries.push({ key: newKey, node: clone(src.node, fn) })
            tree.dirty = true
            if (file.startsWith("upload/1d/")) for (const b of src.node.entries) for (const n of b.node.entries) {
                const c = R.splitCsv(n.node.text.replace(/\n$/, ""))
                const ids = c[2].split(","), counts = c[3].split(","), items = {}
                ids.forEach((id, i) => { items[id] = Number(counts[i]) })
                ;(server.manaNodes[b.key] ??= {})[node(c[0])] = { items, manaCost: Number(c[4]), field1: c[1], field5: c[5], field6: c[6] }
            }
            if (file.startsWith("upload/2d/")) {
                const c = R.splitCsv(src.node.text.replace(/\n$/, ""))
                server.character[NEW.id] = { name: "", rarity: Number(c[2]), element: Number(c[3]), skill_count: 6, cn: true }
            }
        }
        const dest = path.join(out, "production", file)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, R.encodeFile(tree))
        list.push({ path: "production/" + file, from: dest })
    }
    console.log(`tables: ${list.length}`)

    // the unit's own files under the new string id (same folder kind: upload / medium_upload)
    const listFile = opt("--files")
    if (listFile) {
        const csv = fs.readdirSync(path.join(cnDir(), "entities")).find(f => /android_medium\.csv$/.test(f))
        const index = new Set(fs.readFileSync(path.join(cnDir(), "entities", csv), "utf8").split(/\r?\n/).map(l => l.split(",")[0]))
        let copied = 0
        for (const logical of fs.readFileSync(listFile, "utf8").split(/\r?\n/).filter(Boolean)) {
            const folder = ["upload", "medium_upload", "android_upload"].find(f => index.has(uploadPath(logical, f)))
            const entry = folder && files.get(uploadPath(logical, folder).replace(/^production\//, ""))
            if (!entry) { console.log("  not in CN:", logical); continue }
            let data = await entry.buffer()
            if (logical.startsWith("character/") && logical.endsWith(".amf3.deflate")) data = renameInside(data)
            const to = uploadPath(logical.replace(devRe, NEW.dev), folder)
            const dest = path.join(out, to)
            fs.mkdirSync(path.dirname(dest), { recursive: true })
            fs.writeFileSync(dest, data)
            list.push({ path: to, from: dest })
            copied++
        }
        console.log(`files: ${copied}`)
    }
    fs.writeFileSync(path.join(out, "files.json"), JSON.stringify(list, null, 1))
    fs.writeFileSync(path.join(out, "server.json"), JSON.stringify(server, null, 1))
}

main().catch(e => { console.error(e); process.exit(1) })
