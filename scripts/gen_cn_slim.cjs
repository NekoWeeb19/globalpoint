// Builds a slim CN game-files folder for a server that doesn't keep the 10 GB of CN archives (the phone
// companion, once the game has its files): everything the dashboard's schedule changes and the server
// read from CN's files, and the art the Unit editor's skill preview draws, without the rest of the art and sound.
//   <out>/path, <out>/entities/   CN's file list and index (as in the full folder)
//   <out>/tables/production/...   every CN data table (orderedmap), the newest original copy; also the skill
//                                 preview's art (every unit's pixel sprite and the effects the skill scripts
//                                 play, ~35 MB; with the game APK, also the ones built into the app), by the same
//                                 hashed names, so scripts/cn_read.cjs reads them
//   <out>/names.txt               every file in CN's archives as "xx/hash" (folder left out), for picture checks
//   <out>/preview_art.txt         how many art files are in tables/ (src/nya/eventSchedule.ts rebuilds a folder
//                                 made before the art was added)
// Point CN_CDN_DIR at <out>: scripts/cn_read.cjs and scripts/gen_cn_event_schedule.cjs use tables/ and
// names.txt when there are no archives.
//
//   node scripts/gen_cn_slim.cjs <out folder>      (CN_GAME_APK=<game apk> if apk/ has none)
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const unzipper = require("unzipper")
const { cnDir, cnZips } = require("./cn_archives.cjs")
const { uploadPath: hashed } = require("./cdn_hash.cjs")
const { readAmf3 } = require("./amf3.cjs")

const OUT = process.argv[2]
if (!OUT) throw new Error("usage: gen_cn_slim.cjs <out folder>")
const CN = cnDir()
if (path.resolve(OUT) === path.resolve(CN)) throw new Error("write the slim folder somewhere else than the full CN folder")
// preview_art.txt's first line: raise it when the art list changes, so servers rebuild their slim folder
const ART_VERSION = 1
const SCRIPTS_FILE = path.join(__dirname, "..", "assets", "skill_editor", "game_scripts.json")

/** Whether a file is an orderedmap table (the format scripts/cdn_rows.cjs reads), from its first bytes. */
function isTable(buf) {
    if (buf.length < 8) return false
    const indexLength = buf.readUInt32LE(0)
    if (indexLength < 4 || 4 + indexLength > buf.length) return false
    try { zlib.inflateSync(buf.subarray(4, 4 + indexLength)); return true } catch { return false }
}

const amfFile = buf => { let raw; try { raw = zlib.inflateRawSync(buf) } catch { raw = zlib.inflateSync(buf) } return readAmf3(raw) }

/**
 * The logical paths of the skill preview's art (web/pages/unit-editor.html, scripts/skill_editor.cjs): every unit's
 * pixel sprite, and each effect the skill scripts (assets/skill_editor/game_scripts.json) or the preview itself
 * (web/public/js/skill-stage.js: the hit effects, the skill flash) play, as skill_editor.cjs effectFiles finds them.
 * entryOf(logical) gives the archive entry or null.
 */
async function previewArt(entryOf, readTable) {
    const files = new Set()
    const has = logical => entryOf(logical) !== null
    // sprites: character/<internal name>/pixelart
    const chars = await readTable("master/character/character.orderedmap")
    const { parseCsvLine } = require("./cdn_master.cjs")
    for (const text of Object.values(chars ?? {})) {
        const dev = parseCsvLine(String(text))[0]
        if (!/^[a-z0-9_]+$/.test(dev || "")) continue
        for (const f of ["sprite_sheet.atlas.amf3.deflate", "pixelart.timeline.amf3.deflate", "sprite_sheet.png"]) files.add(`character/${dev}/pixelart/${f}`)
    }
    // effects named in the skill scripts, and the ones the preview adds
    const effects = new Set(["battle/common/layer1/hud_skill_flash"])
    const H = "battle/effect/hit/normal_damage/"
    for (const c of ["red", "blue", "yellow", "green", "white", "black", "colorless"]) for (const n of ["fine", "coarse", "slash", "slash_strong"]) effects.add(`${H}${n}/${n}_${c}/${n}_${c}`)
    for (const n of ["dark", "explosion", "fire", "frozen", "shine", "splash", "tornado", "thunder_light", "thunder_small"]) effects.add(`${H}${n}/${n}`)
    if (fs.existsSync(SCRIPTS_FILE)) {
        for (const b64 of Object.values(JSON.parse(fs.readFileSync(SCRIPTS_FILE, "utf8")))) {
            const text = zlib.inflateRawSync(Buffer.from(b64, "base64")).toString("latin1")
            for (const m of text.match(/battle\/(effect|common)\/[\w\/.-]+/g) ?? []) effects.add(m)
        }
    }
    const COLOURS = ["red", "blue", "yellow", "green", "white", "black", "colorless"]
    const sheets = new Set()
    for (const p of effects) {
        const name = p.split("/").pop()
        for (const base of [p, ...COLOURS.map(c => `${p}/${name}_${c}/${name}_${c}`)]) {
            const parts = base + ".parts.amf3.deflate"
            if (!has(parts)) continue
            files.add(parts)
            for (const e of [".timeline.amf3.deflate", ".atlas.amf3.deflate", ".png"]) files.add(base + e)
            if (has(base + ".atlas.amf3.deflate")) continue
            // no sheet of its own: <folder>/<folder name>, or the folder itself (effectFiles)
            let dir = ""
            try { dir = String(amfFile(await entryOf(parts).buffer()).i?.[0]?.p ?? "").split("/.gen/")[0] } catch { }
            if (/^battle\/(effect|common)\//.test(dir)) for (const sheet of [`${dir}/${dir.split("/").pop()}`, dir]) if (has(sheet + ".atlas.amf3.deflate")) { sheets.add(sheet); break }
        }
    }
    for (const s of sheets) for (const e of [".atlas.amf3.deflate", ".png"]) files.add(s + e)
    return [...files].filter(has)
}

;(async () => {
    fs.mkdirSync(path.join(OUT, "entities"), { recursive: true })
    fs.copyFileSync(path.join(CN, "path"), path.join(OUT, "path"))
    for (const f of fs.readdirSync(path.join(CN, "entities"))) fs.copyFileSync(path.join(CN, "entities", f), path.join(OUT, "entities", f))

    const names = new Set()
    const tables = new Map() // path -> entry (newest wins: cnZips is oldest first)
    const entries = new Map() // "upload/xx/hash" (the hashed name without "production/") -> newest entry
    for (const z of cnZips()) {
        const common = path.basename(path.dirname(z)).startsWith("archive-common")
        for (const e of (await unzipper.Open.file(z)).files) {
            if (e.type !== "File") continue
            const p = e.path.split("\\").join("/")
            names.add(p.replace(/^production\/[a-z_]+\//, ""))
            entries.set(p.split("/").slice(-3).join("/"), e)
            // tables are in the common archives, and small; check the format to tell them from art
            if (common && e.uncompressedSize < 64 * 1024 * 1024) tables.set(p, e)
        }
    }
    let kept = 0, bytes = 0
    const tableBufs = new Map()
    for (const [p, e] of tables) {
        const buf = await e.buffer()
        if (!isTable(buf)) continue
        const out = path.join(OUT, "tables", p)
        fs.mkdirSync(path.dirname(out), { recursive: true })
        fs.writeFileSync(out, buf)
        tableBufs.set(p, buf)
        kept++; bytes += buf.length
    }
    fs.writeFileSync(path.join(OUT, "names.txt"), [...names].sort().join("\n"))
    console.log(`${kept} tables (${(bytes / 1e6).toFixed(1)} MB), ${names.size} file names -> ${OUT}`)

    // the skill preview's art, under its hashed name (as scripts/cn_read.cjs slimTable reads it)
    // the update files, else the game app's built-in ones (scripts/cn_app_bundle.cjs: e.g. Alk's effects, the Fine and
    // Coarse hits); those need the game APK (CN_GAME_APK or apk/*.apk)
    const APP = require("./cn_app_bundle.cjs")
    const builtIn = await APP.bundleEntries()
    if (!builtIn.size) console.log("No game APK (CN_GAME_APK or apk/*.apk): the skill preview art built into the game app is left out.")
    const { hashName } = require("./cdn_hash.cjs")
    const entryOf = logical => entries.get(hashed(logical).replace("production/", "")) ?? builtIn.get(hashName(logical)) ?? null
    const art = await previewArt(entryOf, require("./cn_read.cjs").readCnTable)
    let artBytes = 0
    for (const logical of art) {
        const buf = await entryOf(logical).buffer()
        const out = path.join(OUT, "tables", hashed(logical))
        fs.mkdirSync(path.dirname(out), { recursive: true })
        fs.writeFileSync(out, buf)
        artBytes += buf.length
    }
    fs.writeFileSync(path.join(OUT, "preview_art.txt"), `${ART_VERSION}\n${art.length}\n`)
    console.log(`${art.length} skill preview art files (${(artBytes / 1e6).toFixed(1)} MB) -> ${path.join(OUT, "tables")}`)
})().catch(e => { console.error(e); process.exit(1) })
