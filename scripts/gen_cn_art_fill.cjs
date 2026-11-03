// Pictures the CN client's tables ask for that CN never shipped, taken from global (and a few fixed CN
// sheets), for one StarPoint patch (scripts/build_cn_patch.cjs):
// - event announcements at login (master/feature_banner/feature_announcement, "TAP SCREEN" pages) and
//   the pop-up dialogs (feature_guide_dialog table): every picture CN and StarPoint's patches lack and
//   global has. Rows whose picture exists nowhere are hidden by scripts/gen_cn_event_schedule.cjs.
// - Razelt's Launch Gala animation (gacha/feature_movie/release_gacha/prince_zero): CN's picture is
//   stored turned against its layout (stripes in game); global's picture and layout are used.
// - The Haunt's screen (scene/tower_dungeon/sprite_sheet): global's "The Haunt" logo frames moved in
//   (scripts/gen_cn_sprite_swap.cjs), and the header strip redrawn from global's with CN's reset day
//   ("Progress is reset every month on the 12th"; global's says the 6th).
//
//   node scripts/gen_cn_art_fill.cjs [out dir]       (default .cdn/cn_work_art_fill)
//   -> <out dir>/production/upload/... (the changed sheets), <out dir>/files.json for build_cn_patch.cjs
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const crypto = require("crypto")
const { execFileSync } = require("child_process")
const unzipper = require("unzipper")
const R = require("./cdn_rows.cjs")
const { cnDir, cnZips } = require("./cn_archives.cjs")
const { readAmf3 } = require("./client_mod/amf3.cjs")
const { globalFile } = require("./build_cn_patch.cjs")

const ROOT = path.join(__dirname, "..")
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, ".cdn", "cn_work_art_fill"))
const SALT = "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy"
const hashed = logical => { const h = crypto.createHash("sha1").update(logical + SALT).digest("hex"); return `production/upload/${h.slice(0, 2)}/${h.slice(2)}` }
const ANNOUNCEMENTS = hashed("master/feature_banner/feature_announcement.orderedmap")
// its logical name isn't known; the stored path of the pop-up dialog table (feature_guide_dialog pictures)
const GUIDE_DIALOGS = "production/upload/f3/5dbdf5b3c941d0a975bd5eabb5652fa411ebf9"
const TOWER = "scene/tower_dungeon/sprite_sheet"
const RAZELT = "gacha/feature_movie/release_gacha/prince_zero/sprite_sheet"
const HEADER_TEXT = "Progress is reset every month on the 12th"
const FONT = process.env.HEADER_FONT ?? "F:/WF client/fonts/Poppins-SemiBold.ttf"

// ---- PNG (RGBA only; CN/global sheets start with "png" in lower case) ----
function decodePng(b) {
    b = Buffer.from(b); b.write("PNG", 1, "latin1")
    let p = 8, w, h, ct; const idat = []
    while (p < b.length) {
        const len = b.readUInt32BE(p), t = b.toString("latin1", p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len)
        if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9] } else if (t === "IDAT") idat.push(d)
        p += 12 + len
    }
    if (ct !== 6) throw new Error("only RGBA pictures")
    const raw = zlib.inflateSync(Buffer.concat(idat)), st = w * 4, out = Buffer.alloc(w * h * 4)
    let prev = Buffer.alloc(st)
    for (let y = 0; y < h; y++) {
        const f = raw[y * (st + 1)], line = Buffer.from(raw.subarray(y * (st + 1) + 1, (y + 1) * (st + 1)))
        for (let x = 0; x < st; x++) {
            const a = x >= 4 ? line[x - 4] : 0, u = prev[x], c = x >= 4 ? prev[x - 4] : 0
            let v = line[x]
            if (f === 1) v += a; else if (f === 2) v += u; else if (f === 3) v += (a + u) >> 1
            else if (f === 4) { const pp = a + u - c, pa = Math.abs(pp - a), pb = Math.abs(pp - u), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? u : c) }
            line[x] = v & 255
        }
        line.copy(out, y * w * 4); prev = line
    }
    return { w, h, px: out }
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc32 = b => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, "latin1"), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]) }
function encodePng({ w, h, px }, lower) {
    const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6
    const raw = Buffer.alloc((w * 4 + 1) * h)
    for (let y = 0; y < h; y++) px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]); if (lower) sig.write("png", 1, "latin1")
    return Buffer.concat([sig, chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))])
}
const inflate = b => { try { return zlib.inflateRawSync(b) } catch { return zlib.inflateSync(b) } }
// a frame's upright pixel (x, y) -> its byte offset in the sheet
const at = (img, f, x, y) => ((f.r ? f.y + x : f.y + y) * img.w + (f.r ? f.x + (f.w - 1 - y) : f.x + x)) * 4
const uprightSize = f => [f.r ? f.h : f.w, f.r ? f.w : f.h]

// ---- names in the CN files and StarPoint's patches ----
async function cnIndex() {
    const map = new Map()
    for (const z of cnZips(cnDir())) for (const e of (await unzipper.Open.file(z)).files) map.set(e.path.split("\\").join("/").replace(/^production\/[a-z_]+\//, "production/upload/"), e)
    return map
}
async function patchNames() {
    const names = new Set()
    const list = path.join(ROOT, ".cdn", "cn_patches", "patches.json")
    if (!fs.existsSync(list)) return names
    for (const p of JSON.parse(fs.readFileSync(list, "utf8"))) for (const a of p.archives) {
        const zf = path.join(path.dirname(list), a.file)
        if (fs.existsSync(zf)) for (const e of (await unzipper.Open.file(zf)).files) names.add(e.path.split("\\").join("/").replace(/^production\/[a-z_]+\//, "production/upload/"))
    }
    return names
}
// global's file index (.cdn/en/entities/*.csv): every file global has, as "production/upload/..." -> its real
// path (pictures like home banners are under production/medium_upload, where the patch must put them too)
const globalNames = (() => {
    const dir = path.join(ROOT, ".cdn", "en", "entities")
    const csv = fs.readdirSync(dir).filter(f => f.endsWith(".csv")).sort().pop()
    return new Map(fs.readFileSync(path.join(dir, csv), "utf8").split("\n").map(l => l.trim().split(",")[0]).filter(Boolean)
        .map(p => [p.replace(/^production\/[a-z_]+\//, "production/upload/"), p]))
})()
const globalHas = p => globalNames.has(p)
const globalPath = p => globalNames.get(p) ?? p

;(async () => {
    fs.mkdirSync(OUT, { recursive: true })
    // 1. The Haunt's logo frames from global (writes OUT/files.json with the changed sheet)
    execFileSync(process.execPath, [path.join(__dirname, "gen_cn_sprite_swap.cjs"), OUT, `${TOWER}:/\\.gen/tower_header/(p|n|o)$`], { stdio: "inherit" })
    const files = JSON.parse(fs.readFileSync(path.join(OUT, "files.json"), "utf8"))

    // 2. The Haunt's header strip: global's strip (same size), its text replaced
    const towerPng = path.join(OUT, hashed(TOWER + ".png")), towerAtlas = path.join(OUT, hashed(TOWER + ".atlas.amf3.deflate"))
    const C = decodePng(fs.readFileSync(towerPng))
    const cFrames = readAmf3(inflate(fs.readFileSync(towerAtlas)))
    const G = decodePng(await globalFile(hashed(TOWER + ".png")))
    const gFrames = readAmf3(inflate(await globalFile(hashed(TOWER + ".atlas.amf3.deflate"))))
    const strip = list => list.find(f => { const [w, h] = uprightSize(f); return w === 579 && h === 46 && f.n.includes("/.gen/tower_header/") })
    const cs = strip(cFrames), gs = strip(gFrames)
    if (!cs || !gs) throw new Error("The Haunt's header strip (579x46) wasn't found in both sheets.")
    const [W, H] = [579, 46]
    const S = Buffer.alloc(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const j = at(G, gs, x, y); G.px.copy(S, (y * W + x) * 4, j, j + 4) }
    // the text: bright pixels inside the band; covered with the band's own colour
    let x0 = W, x1 = -1, y0 = H, y1 = -1
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        if (S[i + 3] > 200 && S[i] > 150 && S[i + 1] > 150 && S[i + 2] > 150) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    }
    if (x1 < 0) throw new Error("No text found in global's header strip.")
    const band = S.subarray(((Math.floor(H / 2)) * W + Math.max(0, x0 - 4)) * 4, ((Math.floor(H / 2)) * W + Math.max(0, x0 - 4)) * 4 + 4)
    const bandColor = Buffer.from(band)
    for (let y = Math.max(0, y0 - 1); y <= Math.min(H - 1, y1 + 1); y++) for (let x = Math.max(0, x0 - 1); x <= Math.min(W - 1, x1 + 1); x++) {
        const i = (y * W + x) * 4
        if (S[i + 3] > 0) bandColor.copy(S, i)
    }
    // the new text, centred where the old one was (a little wider: "12th" is longer than "6th")
    const work = path.join(OUT, "work"); fs.mkdirSync(work, { recursive: true })
    const tw = Math.min(W - 60, x1 - x0 + 1 + 24), th = y1 - y0 + 1 + 6
    fs.writeFileSync(path.join(work, "labels.tsv"), ["tower_header", tw, th, "ffffff", "none", HEADER_TEXT].join("\t"))
    execFileSync("java", [path.join(__dirname, "client_mod", "RenderLabels.java"), path.join(work, "labels.tsv"), work, FONT], { stdio: "inherit" })
    const L = decodePng(fs.readFileSync(path.join(work, "tower_header.png")))
    const lx = Math.round((x0 + x1 + 1) / 2 - tw / 2), ly = Math.round((y0 + y1 + 1) / 2 - th / 2)
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const sx = lx + x, sy = ly + y
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue
        const s = (y * tw + x) * 4, d = (sy * W + sx) * 4, a = L.px[s + 3] / 255
        if (a === 0 || S[d + 3] === 0) continue
        for (let k = 0; k < 3; k++) S[d + k] = Math.round(L.px[s + k] * a + S[d + k] * (1 - a))
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) S.copy(C.px, at(C, cs, x, y), (y * W + x) * 4, (y * W + x) * 4 + 4)
    fs.writeFileSync(towerPng, encodePng(C, true))
    fs.writeFileSync(path.join(work, "tower_header_strip.png"), encodePng({ w: W, h: H, px: S }))
    console.log(`The Haunt: header strip redrawn ("${HEADER_TEXT}")`)

    // 3. pictures from global
    console.log("Indexing the CN files and StarPoint's patches...")
    const cn = await cnIndex(), patched = await patchNames()
    const have = p => cn.has(p) || patched.has(p)
    const added = new Set(files.map(f => f.path))
    const add = p => { if (!added.has(p)) { files.push({ path: globalPath(p), from: "global" }); added.add(p) } }
    const missingEverywhere = []
    const tableRows = async p => R.leaves(R.decodeFile(await cn.get(p).buffer()))
    for (const [table, column] of [[ANNOUNCEMENTS, 1], [GUIDE_DIALOGS, 3]]) {
        let taken = 0
        for (const { leaf } of await tableRows(table)) {
            const pic = R.splitCsv(leaf.text.split("\n")[0])[column]
            if (!pic || pic === "(None)") continue
            const p = hashed(pic + ".png")
            if (have(p) || added.has(p)) continue
            if (globalHas(p)) { add(p); taken++ } else missingEverywhere.push(pic)
        }
        console.log(`${table === ANNOUNCEMENTS ? "announcements" : "pop-up dialogs"}: ${taken} pictures from global`)
    }
    // home banners (master/feature_banner/feature_banner + _secondary): every picture they name; names ending in "_"
    // are completed by the client
    let banners = 0
    for (const table of ["master/feature_banner/feature_banner.orderedmap", "master/feature_banner/feature_banner_secondary.orderedmap"].map(hashed)) {
        for (const { leaf } of await tableRows(table)) {
            for (const pic of new Set(leaf.text.match(/dynamic\/home_banner\/[a-z0-9_\/]*[a-z0-9](?![a-z0-9_\/])/g) ?? [])) {
                const p = hashed(pic + ".png")
                if (have(p) || added.has(p)) continue
                if (globalHas(p)) { add(p); banners++ } else missingEverywhere.push(pic)
            }
        }
    }
    console.log(`home banners: ${banners} pictures from global`)
    // Special Exchange / Start Dash shop headers (column 8 of the campaign rows: dynamic/special_exchange/...)
    let exchange = 0
    for (const table of ["master/campaign/special_exchange/special_exchange_campaign.orderedmap",
        "master/campaign/start_dash_exchange/start_dash_exchange_campaign.orderedmap"].map(hashed)) {
        for (const { leaf } of await tableRows(table)) {
            for (const pic of new Set(leaf.text.match(/dynamic\/[a-z0-9_\/]*[a-z0-9](?![a-z0-9_\/])/g) ?? [])) {
                const p = hashed(pic + ".png")
                if (have(p) || added.has(p)) continue
                if (globalHas(p)) { add(p); exchange++ } else missingEverywhere.push(pic)
            }
        }
    }
    console.log(`exchange shop headers: ${exchange} pictures from global`)
    // Razelt's Launch Gala animation: global's picture and layout together
    for (const ext of [".png", ".atlas.amf3.deflate"]) add(hashed(RAZELT + ext))
    console.log(`Razelt's Launch Gala animation: global's sheet`)

    fs.writeFileSync(path.join(OUT, "files.json"), JSON.stringify(files))
    console.log(`${files.length} files -> ${path.join(OUT, "files.json")}`)
    if (missingEverywhere.length) console.log(`Not in CN, the patches or global (hidden by the schedule): ${[...new Set(missingEverywhere)].map(p => p.split("/").pop()).join(", ")}`)
})().catch(e => { console.error(e.stack || e.message); process.exit(1) })
