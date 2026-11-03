// English for the CN client's labels drawn as images that global has no art for (bitmap_text frames
// of scene/general/sprite_sheet, in the app's bundle): each is drawn again in English, in the
// frame's own colors (text color and outline taken from CN's picture), by client_mod/RenderLabels.java,
// and written over CN's picture at the frame's spot (turned when the frame is stored turned).
//
//   node scripts/gen_cn_label_images.cjs <sheet png in> <sheet atlas (amf3.deflate)> <out png> <work dir>
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const { execFileSync } = require("child_process")
const { readAmf3 } = require("./amf3.cjs")

const PREFIX = "scene/general/sprite_sheet/"
const LABELS = {
    assistant_text: "Helper", auto_switch_label_party_select: "Auto", bulk_exchange: "Exchange All",
    character_awake: "Awaken", character_awake_gray: "Awaken", character_equipment_change_text: "Show",
    comic: "Comic", encyclopedia_filter_all: "All", encyclopedia_filter_lock: "Locked", encyclopedia_filter_unread: "Unread",
    equipment_exchange: "Exchange", equipped: "Equipped", event: "Event", fans_remove: "Remove\\nFollower",
    howtoplay: "How to Play", main: "Main", party_character_remove: "Remove", party_option_text: "Menu",
    party_participation: "Joined", pass_gift_text: "Level Up", pass_mission: "Missions", player_history_text: "My\\nProfile",
    player_profile_text: "History", pose: "Pause", present: "Gifts", protection: "Locked", reset: "Reset", return: "Back",
    room_number_input: "Enter\\nRoom No.", small_survery_text: "Survey", strengthen: "Upgrade", unachieved: "Not Done", voice: "Voice",
    switch_character_status: "Switch Stats", switching: "Switch", toggle_label_follow: "Follow", toggle_label_follow_remove: "Unfollow",
}
for (const [k, v] of Object.entries({ ...LABELS })) { LABELS["bitmap_text-assets/" + k] = v; delete LABELS[k] }
// frames outside bitmap_text-assets (keys with their folder)
Object.assign(LABELS, {
    "component-assets/switch_button_label_on": "ON", "component-assets/switch_button_label_off": "OFF", "component-assets/switch_button_label_off_locked": "OFF",
})

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
const hex = ([r, g, b]) => [r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("")

const [pngIn, atlasIn, pngOut, work] = process.argv.slice(2)
if (!work) throw new Error("usage: gen_cn_label_images.cjs <sheet png> <sheet atlas> <out png> <work dir>")
fs.mkdirSync(work, { recursive: true })
const inBuf = fs.readFileSync(pngIn)
const C = decodePng(inBuf)
const frames = readAmf3(zlib.inflateRawSync(fs.readFileSync(atlasIn)))
// upright pixel (x, y) of a frame -> its offset in the sheet
const at = (f, x, y) => ((f.r ? f.y + x : f.y + y) * C.w + (f.r ? f.x + (f.w - 1 - y) : f.x + x)) * 4
const todo = []
const tsv = []
for (const f of frames) {
    const key = f.n.startsWith(PREFIX) ? f.n.slice(PREFIX.length) : null
    if (!key || !LABELS[key]) continue
    const W = f.r ? f.h : f.w, H = f.r ? f.w : f.h
    // colors: the darkest third of the solid pixels is the text, the lightest third the outline
    const solid = []
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = at(f, x, y); if (C.px[o + 3] > 200) solid.push([C.px[o], C.px[o + 1], C.px[o + 2]]) }
    solid.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]))
    const avg = list => [0, 1, 2].map(i => list.reduce((s, c) => s + c[i], 0) / Math.max(1, list.length))
    const third = Math.max(1, Math.floor(solid.length / 3))
    const dark = avg(solid.slice(0, third)), light = avg(solid.slice(-third))
    const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
    const outline = lum(light) - lum(dark) > 60 ? hex(light) : "none"
    tsv.push([key.replace(/\//g, "__"), W, H, hex(dark), outline, LABELS[key]].join("\t"))
    todo.push({ f, key, W, H })
}
fs.writeFileSync(path.join(work, "labels.tsv"), tsv.join("\n"))
execFileSync("java", [path.join(__dirname, "client_mod", "RenderLabels.java"), path.join(work, "labels.tsv"), work], { stdio: "inherit" })
for (const { f, key, W, H } of todo) {
    const L = decodePng(fs.readFileSync(path.join(work, key.replace(/\//g, "__") + ".png")))
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) L.px.copy(C.px, at(f, x, y), (y * W + x) * 4, (y * W + x) * 4 + 4)
}
fs.writeFileSync(pngOut, encodePng(C, inBuf.toString("latin1", 1, 4) === "png"))
console.log(`${todo.length} labels drawn in English into ${pngOut}`)
