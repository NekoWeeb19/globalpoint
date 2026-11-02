// English labels drawn into the CN client's sprite sheets (battle HUD "Auto", "Skill Auto", "Time",
// "Score", level-up badges...), taken from global's copy of the same sheet. CN and global pack their
// sheets differently and CN has frames global doesn't, so whole sheets can't be swapped: for every
// frame both sheets have with the same size, rotation and trim, whose pixels clearly differ, global's
// pixels are copied into CN's sheet at CN's position. Frames only CN has are left as they are.
//
// Sheets: <name>.png (or the hashed name) + <name>.atlas.amf3.deflate (frame layout: n, x, y, w, h,
// r rotated, fx fy fw fh trim), read from the CN game files and global's (any archive).
//
// Frames named by a sheet's pattern ("<sheet>:<regex>") whose shape differs (global packed them rotated,
// or its English label is wider) are moved instead: global's frame is added below CN's picture, and
// CN's layout entry for it takes global's size, trim and rotation at the new spot.
//
//   node scripts/gen_cn_sprite_swap.cjs <out dir> <sheet>[:<regex>] [...]
//   -> <out dir>/production/upload/... (the changed sheets), <out dir>/files.json for build_cn_patch.cjs
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const crypto = require("crypto")
const unzipper = require("unzipper")
const { cnZips } = require("./cn_archives.cjs")
const { readAmf3, writeAmf3 } = require("./client_mod/amf3.cjs")

const SALT = "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy"
const GLOBAL_CDN = path.join(__dirname, "..", ".cdn", "en")
const short = logical => { const x = crypto.createHash("sha1").update(logical + SALT).digest("hex"); return `${x.slice(0, 2)}/${x.slice(2)}` }

// every file of a CDN, by its short hashed name ("ab/cdef..."), newest archive last wins; zips are
// archive paths or { buffer } (an app bundle)
async function index(zips) {
    const map = new Map()
    for (const z of zips) for (const e of (typeof z === "string" ? await unzipper.Open.file(z) : await unzipper.Open.buffer(z.buffer)).files) {
        if (e.type !== "File") continue
        const p = e.path.split("\\").join("/")
        map.set(p.split("/").slice(-2).join("/"), { entry: e, path: p.startsWith("production/") ? p : "production/" + p })
    }
    return map
}
function globalZips() {
    const out = []
    for (const d of fs.readdirSync(GLOBAL_CDN).filter(d => d.startsWith("archive-") && !d.includes("small")).sort((a, b) => Number(a.includes("full")) - Number(b.includes("full"))).reverse())
        for (const f of fs.readdirSync(path.join(GLOBAL_CDN, d)).filter(f => f.endsWith(".zip")).sort()) out.push(path.join(GLOBAL_CDN, d, f))
    return out
}

function decodePng(b) {
    let p = 8, w, h, bd, ct, il, plte, trns
    const idat = []
    while (p < b.length) {
        const len = b.readUInt32BE(p), t = b.toString("latin1", p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len)
        if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; il = d[12] }
        else if (t === "IDAT") idat.push(d)
        else if (t === "PLTE") plte = d
        else if (t === "tRNS") trns = d
        else if (t === "IEND") break
        p += 12 + len
    }
    if (bd !== 8 || il) throw new Error(`PNG not supported (bit depth ${bd}, interlace ${il})`)
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct]
    const raw = zlib.inflateSync(Buffer.concat(idat))
    const st = w * ch, out = Buffer.alloc(w * h * 4)
    let prev = Buffer.alloc(st)
    for (let y = 0; y < h; y++) {
        const f = raw[y * (st + 1)], line = Buffer.from(raw.subarray(y * (st + 1) + 1, (y + 1) * (st + 1)))
        for (let x = 0; x < st; x++) {
            const a = x >= ch ? line[x - ch] : 0, u = prev[x], c = x >= ch ? prev[x - ch] : 0
            let v = line[x]
            if (f === 1) v += a
            else if (f === 2) v += u
            else if (f === 3) v += (a + u) >> 1
            else if (f === 4) { const pp = a + u - c, pa = Math.abs(pp - a), pb = Math.abs(pp - u), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? u : c) }
            line[x] = v & 255
        }
        for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4
            if (ct === 6) line.copy(out, o, x * 4, x * 4 + 4)
            else if (ct === 2) { out[o] = line[x * 3]; out[o + 1] = line[x * 3 + 1]; out[o + 2] = line[x * 3 + 2]; out[o + 3] = 255 }
            else if (ct === 3) { const i = line[x]; out[o] = plte[i * 3]; out[o + 1] = plte[i * 3 + 1]; out[o + 2] = plte[i * 3 + 2]; out[o + 3] = trns && i < trns.length ? trns[i] : 255 }
            else if (ct === 0) { out[o] = out[o + 1] = out[o + 2] = line[x]; out[o + 3] = 255 }
            else { out[o] = out[o + 1] = out[o + 2] = line[x * 2]; out[o + 3] = line[x * 2 + 1] }
        }
        prev = line
    }
    return { w, h, px: out }
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc32 = b => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
}
/** RGBA PNG; `lower` keeps the game's "\x89png" signature spelling. */
function encodePng({ w, h, px }, lower) {
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
    const raw = Buffer.alloc((w * 4 + 1) * h)
    for (let y = 0; y < h; y++) px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    if (lower) sig.write("png", 1, "latin1")
    return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))])
}
const asPng = b => { const c = Buffer.from(b); c.write("PNG", 1, "latin1"); return c }

/** Frames by name: { x, y, w, h, r, fx, fy, fw, fh } (w x h is the area the frame takes on the sheet). */
function frames(atlasBuf) {
    const out = new Map()
    for (const f of readAmf3(zlib.inflateRawSync(atlasBuf))) out.set(f.n, f)
    return out
}
/** How much smaller the sheet's picture is than its layout (global stores some at 15/16). */
function scaleOf(png, frameMap) {
    let mx = 0, my = 0
    for (const f of frameMap.values()) { mx = Math.max(mx, f.x + f.w); my = Math.max(my, f.y + f.h) }
    const s = Math.min(1, png.w / mx, png.h / my)
    return s > 0.99 ? 1 : s
}

// the global pixel for a frame's (x, y), on a sheet stored at scale s (nearest pixel: keeps pixel art sharp)
const at = (B, rb, s, x, y) => {
    const gx = Math.min(B.w - 1, Math.floor((rb.x + x + 0.5) * s)), gy = Math.min(B.h - 1, Math.floor((rb.y + y + 0.5) * s))
    return (gy * B.w + gx) * 4
}
// pixels that clearly differ (compression noise is small, a label isn't)
function changed(A, ra, B, rb, w, h, s) {
    let n = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = ((ra.y + y) * A.w + ra.x + x) * 4, j = at(B, rb, s, x, y)
        if (A.px[i + 3] < 16 && B.px[j + 3] < 16) continue
        const d = Math.abs(A.px[i] - B.px[j]) + Math.abs(A.px[i + 1] - B.px[j + 1]) + Math.abs(A.px[i + 2] - B.px[j + 2]) + Math.abs(A.px[i + 3] - B.px[j + 3])
        if (d > 96) n++
    }
    return n
}

;(async () => {
    const [outDir, ...sheets] = process.argv.slice(2)
    if (sheets.length === 0) throw new Error("usage: gen_cn_sprite_swap.cjs <out dir> <sheet> [<sheet> ...]")
    console.log("Indexing the CN and global files...")
    // sheets built into the apps (assets/bundle.zip): CN_BUNDLE (the CN bundle zip to start from) and
    // GL_APK (the global APK); their files keep their bundle paths (production/bundle/...)
    const bundleOf = async apk => ({ buffer: await (await unzipper.Open.file(apk)).files.find(e => e.path === "assets/bundle.zip").buffer() })
    const cnExtra = process.env.CN_BUNDLE ? [{ buffer: fs.readFileSync(process.env.CN_BUNDLE) }] : []
    const glExtra = process.env.GL_APK ? [await bundleOf(process.env.GL_APK)] : []
    const [cn, gl] = [await index([...cnZips(), ...cnExtra]), await index([...globalZips(), ...glExtra])]
    const files = []
    for (const arg of sheets) {
        const [sheet, pattern] = arg.includes(":") ? [arg.slice(0, arg.indexOf(":")), new RegExp(arg.slice(arg.indexOf(":") + 1))] : [arg, null]
        const get = (map, logical) => map.get(short(logical))
        const [cPng, gPng, cAtlas, gAtlas] = [get(cn, sheet + ".png"), get(gl, sheet + ".png"), get(cn, sheet + ".atlas.amf3.deflate"), get(gl, sheet + ".atlas.amf3.deflate")]
        if (!cPng || !gPng || !cAtlas || !gAtlas) { console.log(`${sheet}: missing ${[["CN png", cPng], ["global png", gPng], ["CN layout", cAtlas], ["global layout", gAtlas]].filter(([, v]) => !v).map(([n]) => n).join(", ")}, skipped`); continue }
        const cBuf = await cPng.entry.buffer()
        const C = decodePng(asPng(cBuf)), G = decodePng(asPng(await gPng.entry.buffer()))
        const cList = readAmf3(zlib.inflateRawSync(await cAtlas.entry.buffer()))
        const cf = new Map(cList.map(f => [f.n, f])), gf = frames(await gAtlas.entry.buffer())
        const s = scaleOf(G, gf)
        if (scaleOf(C, cf) !== 1) { console.log(`${sheet}: the CN picture doesn't match its layout, skipped`); continue }
        const swapped = [], skipped = [], moves = []
        for (const [name, a] of cf) {
            const b = gf.get(name)
            if (!b) continue
            // animation frames (".gen/": coffins, flippers, effects) are art CN may have redrawn on
            // purpose; only labels are wanted, so they're left alone unless the sheet's pattern names them
            if (name.includes("/.gen/") && !(pattern && pattern.test(name))) continue
            const sameShape = a.w === b.w && a.h === b.h && !!a.r === !!b.r && (a.fx ?? 0) === (b.fx ?? 0) && (a.fy ?? 0) === (b.fy ?? 0) && (a.fw ?? a.w) === (b.fw ?? b.w) && (a.fh ?? a.h) === (b.fh ?? b.h)
            const [w, h] = [a.w, a.h]
            // the same frame packed the other way round: copied turned back (whichever quarter turn
            // matches CN's picture best), in place
            const turned = a.w === b.h && a.h === b.w && !!a.r !== !!b.r && (a.fx ?? 0) === (b.fx ?? 0) && (a.fy ?? 0) === (b.fy ?? 0) && (a.fw ?? a.w) === (b.fw ?? b.h) && (a.fh ?? a.h) === (b.fh ?? b.w)
            if (!sameShape && turned) {
                const turns = [(x, y) => [y, b.h - 1 - x], (x, y) => [b.w - 1 - y, x]]
                const src = (t, x, y) => { const [gx, gy] = t(x, y); return at(G, b, s, gx, gy) }
                const diff = t => {
                    let n = 0
                    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                        const i = ((a.y + y) * C.w + a.x + x) * 4, j = src(t, x, y)
                        if (C.px[i + 3] < 16 && G.px[j + 3] < 16) continue
                        if (Math.abs(C.px[i] - G.px[j]) + Math.abs(C.px[i + 1] - G.px[j + 1]) + Math.abs(C.px[i + 2] - G.px[j + 2]) + Math.abs(C.px[i + 3] - G.px[j + 3]) > 96) n++
                    }
                    return n
                }
                const [d0, d1] = turns.map(diff)
                const t = d0 <= d1 ? turns[0] : turns[1]
                if (Math.min(d0, d1) < 20) continue
                for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = src(t, x, y); G.px.copy(C.px, ((a.y + y) * C.w + a.x + x) * 4, j, j + 4) }
                swapped.push(name.split("/").slice(-2).join("/") + " (turned)")
                continue
            }
            if (!sameShape) {
                if (pattern && pattern.test(name)) moves.push([name, b])
                else if (w * h > 16) skipped.push(name.split("/").slice(-2).join("/"))
                continue
            }
            if (changed(C, a, G, b, w, h, s) < 20) continue
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) G.px.copy(C.px, ((a.y + y) * C.w + a.x + x) * 4, at(G, b, s, x, y), at(G, b, s, x, y) + 4)
            swapped.push(name.split("/").slice(-2).join("/"))
        }
        // moved frames: put in empty space on CN's picture when there is some (cells of 4px that no
        // frame and no visible pixel use), else below the picture (textures stay within 4096)
        let picture = C
        if (moves.length > 0) {
            const CELL = 2, cw = Math.ceil(C.w / CELL), chh = Math.ceil(C.h / CELL)
            const used = new Uint8Array(cw * chh)
            const mark = (x, y, w, h) => {
                for (let cy = Math.max(0, Math.floor((y - 1) / CELL)); cy <= Math.min(chh - 1, Math.floor((y + h) / CELL)); cy++)
                    for (let cx = Math.max(0, Math.floor((x - 1) / CELL)); cx <= Math.min(cw - 1, Math.floor((x + w) / CELL)); cx++) used[cy * cw + cx] = 1
            }
            // the old spots of the frames being moved are free once they move (cleared, unless another
            // frame shares the spot)
            // a moved frame whose picture CN already has under another (CN-only) name of the group, at the
            // same size: global's name points at CN's copy, nothing to place
            const reused = new Set()
            for (let i = moves.length - 1; i >= 0; i--) {
                const [name, b] = moves[i]
                const same = cList.find(f => pattern && pattern.test(f.n) && !gf.has(f.n) && !reused.has(f.n) && f.w === b.w && f.h === b.h && !!f.r === !!b.r
                    && (f.fx ?? 0) === (b.fx ?? 0) && (f.fy ?? 0) === (b.fy ?? 0) && changed(C, f, G, b, b.w, b.h, s) < 20)
                if (!same) continue
                reused.add(same.n)
                const entry = cList.find(f => f.n === name)
                for (const k of ["w", "h", "r", "fx", "fy", "fw", "fh"]) delete entry[k]
                for (const k of ["x", "y", "w", "h", "r", "fx", "fy", "fw", "fh"]) if (same[k] !== undefined) entry[k] = same[k]
                console.log(`${sheet}: ${name.split("/").slice(-2).join("/")} uses CN's matching ${same.n.split("/").pop()}`)
                moves.splice(i, 1)
            }
            // (also the group's CN-only frames: global's animation for the group doesn't use them)
            const movedNames = new Set([...moves.map(([n]) => n), ...cList.filter(f => pattern && pattern.test(f.n) && !gf.has(f.n) && !reused.has(f.n)).map(f => f.n)])
            const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
            for (const f of cList) {
                if (!movedNames.has(f.n) || cList.some(o => !movedNames.has(o.n) && overlaps(f, o))) continue
                for (let y = f.y; y < f.y + f.h; y++) C.px.fill(0, (y * C.w + f.x) * 4, (y * C.w + f.x + f.w) * 4)
            }
            for (const f of cList) if (!movedNames.has(f.n)) mark(f.x, f.y, f.w, f.h)
            for (const f of cList) if (movedNames.has(f.n) && !moves.some(([n]) => n === f.n)) Object.assign(f, { w: 1, h: 1 }) // unused now
            for (let y = 0; y < C.h; y++) for (let x = 0; x < C.w; x++) if (C.px[(y * C.w + x) * 4 + 3] > 0) used[Math.floor(y / CELL) * cw + Math.floor(x / CELL)] = 1
            // summed-area table for "is this block of cells empty"
            const sat = new Int32Array((cw + 1) * (chh + 1))
            const rebuild = () => { for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) sat[(y + 1) * (cw + 1) + x + 1] = used[y * cw + x] + sat[y * (cw + 1) + x + 1] + sat[(y + 1) * (cw + 1) + x] - sat[y * (cw + 1) + x] }
            rebuild()
            const free = (cx, cy, nw, nh) => sat[(cy + nh) * (cw + 1) + cx + nw] - sat[cy * (cw + 1) + cx + nw] - sat[(cy + nh) * (cw + 1) + cx] + sat[cy * (cw + 1) + cx] === 0
            const spots = [], below = []
            for (const [, b] of moves) {
                const nw = Math.ceil((b.w + 1) / CELL), nh = Math.ceil((b.h + 1) / CELL)
                let spot = null
                for (let cy = 0; cy + nh <= chh && !spot; cy++) for (let cx = 0; cx + nw <= cw; cx++) if (free(cx, cy, nw, nh)) { spot = { x: cx * CELL + CELL, y: cy * CELL + CELL }; break }
                if (spot) { mark(spot.x, spot.y, b.w, b.h); rebuild() }
                spots.push(spot)
                if (!spot) below.push(b)
            }
            // what didn't fit goes below the picture, or (when that would pass 4096) in a column to
            // its right
            let x = 0, y = C.h + 2, row = 0
            for (let i = 0; i < moves.length; i++) {
                if (spots[i]) continue
                const b = moves[i][1]
                if (x + b.w > C.w) { x = 0; y += row + 2; row = 0 }
                spots[i] = { x, y }
                x += b.w + 2; row = Math.max(row, b.h)
            }
            let H = below.length > 0 ? y + row : C.h, W = C.w
            if (H > 4096) {
                let cx = C.w + 2, cy = 0, col = 0
                for (let i = 0; i < moves.length; i++) {
                    const b = moves[i][1]
                    if (!below.includes(b)) continue
                    if (cy + b.h > C.h) { cx += col + 2; cy = 0; col = 0 }
                    spots[i] = { x: cx, y: cy }
                    cy += b.h + 2; col = Math.max(col, b.w)
                }
                H = C.h; W = cx + col
            }
            if (H > 4096 || W > 4096) {
                console.log(`${sheet}: no room for ${below.length} frame(s); the whole group is kept as CN's`)
                moves.length = 0
            } else {
                picture = { w: W, h: H, px: Buffer.alloc(W * H * 4) }
                for (let yy = 0; yy < C.h; yy++) C.px.copy(picture.px, yy * W * 4, yy * C.w * 4, (yy + 1) * C.w * 4)
                moves.forEach(([name, b], i) => {
                    const { x: nx, y: ny } = spots[i]
                    for (let yy = 0; yy < b.h; yy++) for (let xx = 0; xx < b.w; xx++) G.px.copy(picture.px, ((ny + yy) * picture.w + nx + xx) * 4, at(G, b, s, xx, yy), at(G, b, s, xx, yy) + 4)
                    const entry = cList.find(f => f.n === name)
                    for (const k of ["w", "h", "r", "fx", "fy", "fw", "fh"]) delete entry[k]
                    Object.assign(entry, { w: b.w, h: b.h, x: nx, y: ny }, b.r ? { r: true } : {},
                        b.fx !== undefined ? { fx: b.fx, fy: b.fy, fw: b.fw, fh: b.fh } : {})
                })
                const atlasOut = path.join(outDir, cAtlas.path)
                fs.mkdirSync(path.dirname(atlasOut), { recursive: true })
                fs.writeFileSync(atlasOut, zlib.deflateRawSync(writeAmf3(cList), { level: 9 }))
                files.push({ path: cAtlas.path, from: atlasOut })
                console.log(`${sheet}: moved ${moves.length} frames from global (${moves.length - below.length} into free space, ${below.length} below; picture ${picture.w}x${picture.h}): ${moves.map(([n]) => n.split("/").slice(-2).join("/")).join(", ")}`)
            }
        }
        console.log(`${sheet}: ${swapped.length} frames from global (global's picture at scale ${s.toFixed(4)}): ${swapped.join(", ")}`)
        if (skipped.length) console.log(`  differ in shape (kept CN's): ${skipped.slice(0, 40).join(", ")}${skipped.length > 40 ? " ..." : ""}`)
        if (swapped.length === 0 && moves.length === 0) continue
        const out = path.join(outDir, cPng.path)
        fs.mkdirSync(path.dirname(out), { recursive: true })
        fs.writeFileSync(out, encodePng(picture, cBuf.toString("latin1", 1, 4) === "png"))
        files.push({ path: cPng.path, from: out })
    }
    fs.writeFileSync(path.join(outDir, "files.json"), JSON.stringify(files))
    console.log(`Wrote ${files.length} sheet(s) to ${outDir}`)
})().catch(e => { console.error(e); process.exit(1) })
