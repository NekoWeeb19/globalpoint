// The pictures (and their sprite layouts) that StarPoint's CN updates put in place of CN's own: global's English art,
// English labels drawn into CN's sheets, and the layouts that had to follow them. With the game set to Chinese
// (scripts/game_language.cjs) and CN's originals at hand (a PC's CN archives, or a phone's Chinese art pack:
// node scripts/build_pack.cjs zh-art), a language switch ships CN's originals of these; back in English, the
// English copies again (scripts/cn_language.cjs, docs/CHINESE.md).
//
// A file is listed when its newest copy in StarPoint's updates isn't a data table, CN's files have the same path and
// the copies differ. Left out, because CN's own copy is broken and the fix isn't about language:
// - the art fixes every update carries (assets/cn_art_fixes.json: Vagner's sprites, guest units' icons...);
// - the summon strip pictures without their halftone band (scripts/gen_cn_strip_band.cjs; the Chinese game app
//   centers the strips too);
// - Razelt's Launch Gala animation (CN's picture is stored turned against its layout; scripts/gen_cn_art_fill.cjs).
// A sheet and its layout go back together: CN's own pair always matches.
//
//   node --env-file=.env scripts/gen_cn_lang_art.cjs     (CN_CDN_DIR with CN's archives) -> assets/cn_lang_art.json
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const unzipper = require("unzipper")
const R = require("./cdn_rows.cjs")
const { cdnDir, cnDir, cnZips } = require("./cn_archives.cjs")
const { readCnOriginals } = require("./cn_language.cjs")

const OUT = path.join(__dirname, "..", "assets", "cn_lang_art.json")
const PATCHES = path.join(cdnDir(), "cn_patches")
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0 }
const isTable = buf => { try { const n = R.decodeFile(buf); return !!(n && n.kind) } catch { return false } }
const sha = buf => crypto.createHash("sha1").update(buf).digest("hex")

// Razelt's Launch Gala animation (gacha/feature_movie/release_gacha/prince_zero, update 1.4.500): CN's own is broken
const RAZELT = ["production/upload/09/551257060354e834dfd42250d7983a8ad382ed", "production/upload/90/69fcf122aeaf3dd9d1425e7a7013201baa4919"]

;(async () => {
    if (cnZips(cnDir()).length === 0) throw new Error("needs CN's archives (CN_CDN_DIR), not a slim folder")
    const keep = new Set(RAZELT)
    for (const fix of JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets", "cn_art_fixes.json"), "utf8"))) keep.add(fix.path)
    const band = path.join(cdnDir(), "cn_work_strip_band", "files.json")
    if (!fs.existsSync(band)) throw new Error(`${band}: the strip band files (scripts/gen_cn_strip_band.cjs) are needed to leave them out`)
    for (const f of JSON.parse(fs.readFileSync(band, "utf8"))) keep.add(f.path ?? f)

    // the newest copy of every file in StarPoint's updates
    const newest = new Map()
    const patches = JSON.parse(fs.readFileSync(path.join(PATCHES, "patches.json"), "utf8")).sort((a, b) => cmp(a.version, b.version))
    for (const p of patches) for (const a of p.archives) {
        for (const e of (await unzipper.Open.file(path.join(PATCHES, a.file))).files) if (e.type === "File") newest.set(e.path.split("\\").join("/"), e)
    }
    const candidates = [...newest.keys()].filter(p => !keep.has(p))
    const originals = await readCnOriginals(cnDir(), candidates)
    const paths = []
    let bytes = 0
    for (const p of candidates) {
        const cn = originals.get(p)
        if (!cn) continue
        const ours = await newest.get(p).buffer()
        if (isTable(ours) || sha(ours) === sha(cn)) continue
        paths.push(p)
        bytes += cn.length
    }
    paths.sort()
    fs.writeFileSync(OUT, JSON.stringify({ _note: "Built by scripts/gen_cn_lang_art.cjs: pictures and sprite layouts StarPoint's CN updates replaced, which go back to CN's own in Chinese. bytes = CN's originals.", bytes, paths }, null, 1) + "\n")
    console.log(`${paths.length} files, CN's originals ${(bytes / 1e6).toFixed(1)} MB (left out: ${keep.size} fixes) -> ${path.relative(process.cwd(), OUT)}`)
})().catch(e => { console.error(e.stack || e.message); process.exit(1) })
