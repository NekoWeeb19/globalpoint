// The Unit editor's skill preview art on a server with only the slim CN folder (the phone companion): a unit's
// pixel sprite and a skill effect read from <slim>/tables/<hashed name>, where scripts/gen_cn_slim.cjs writes them.
// Before 2026-11-21 the slim folder had no art and the preview's sprite and effects were 404 on phones.
// Builds a small slim-style folder with made-up files; no game files needed.
//   node scripts/test_skill_preview_art_slim.mjs
import fs from "fs"
import os from "os"
import path from "path"
import zlib from "zlib"
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const slim = fs.mkdtempSync(path.join(os.tmpdir(), "slim-cn-art-"))
process.env.CN_CDN_DIR = slim
process.env.CN_GAME_APK = path.join(slim, "none.apk") // no game APK either

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

try {
    const { writeAmf3 } = require("./amf3.cjs")
    const { uploadPath: hashed } = require("./cdn_hash.cjs")
    // a slim folder: CN's file index (entities) and tables/, no archives
    fs.mkdirSync(path.join(slim, "entities"))
    fs.writeFileSync(path.join(slim, "entities", "1.4.0_android_medium.csv"), "")
    fs.writeFileSync(path.join(slim, "names.txt"), "")
    const put = (logical, buf) => { const f = path.join(slim, "tables", hashed(logical)); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf) }
    const amf = value => zlib.deflateRawSync(writeAmf3(value))
    const png = Buffer.concat([Buffer.from([0x89]), Buffer.from("png\r\n\x1a\n", "latin1"), Buffer.alloc(16)]) // the game's lowercase signature

    put("character/testunit/pixelart/sprite_sheet.atlas.amf3.deflate", amf([{ n: "skill_ready_0001", x: 0, y: 0, w: 8, h: 8 }]))
    put("character/testunit/pixelart/pixelart.timeline.amf3.deflate", amf({ sequences: [{ name: "skill_ready" }] }))
    put("character/testunit/pixelart/sprite_sheet.png", png)
    const E = "battle/effect/test/boom"
    put(`${E}.parts.amf3.deflate`, amf({ i: [{ p: `${E}/.gen/boom_0001` }] }))
    put(`${E}.atlas.amf3.deflate`, amf([{ n: "boom_0001", x: 0, y: 0, w: 4, h: 4 }]))
    put(`${E}.png`, png)
    // a shared effect (one copy per colour), as the game app's built-in ones are: not in CN's file index, only in tables/
    const S = "battle/effect/test/shared", SR = `${S}/shared_red/shared_red`
    put(`${SR}.parts.amf3.deflate`, amf({ i: [{ p: `${SR}/.gen/shared_0001` }] }))
    put(`${SR}.atlas.amf3.deflate`, amf([{ n: "shared_0001", x: 0, y: 0, w: 4, h: 4 }]))
    put(`${SR}.png`, png)

    const SE = require("./skill_editor.cjs")
    const sprite = await SE.unitSprite("testunit")
    check("a unit's sprite reads from the slim folder", sprite?.atlas?.[0]?.n === "skill_ready_0001" && sprite?.timeline?.sequences?.[0]?.name === "skill_ready", sprite)
    const image = await SE.unitSpriteImage("testunit")
    check("...and its picture, as a PNG", image?.subarray(1, 4).toString("latin1") === "PNG", image?.subarray(0, 4))
    const effect = await SE.effectFiles(E)
    check("a skill effect reads from the slim folder", effect?.parts?.i?.[0]?.p === `${E}/.gen/boom_0001` && effect?.atlas?.[0]?.n === "boom_0001", effect)
    const sheet = await SE.effectImage(effect?.sheet ?? E)
    check("...and its sheet, as a PNG", sheet?.subarray(1, 4).toString("latin1") === "PNG", sheet?.subarray(0, 4))
    const shared = await SE.effectFiles(S)
    check("a shared effect's colours are found in the slim folder", JSON.stringify(shared?.colours) === '["red"]' && shared?.base === SR, shared && { colours: shared.colours, base: shared.base })
    check("a unit with no sprite is still none", (await SE.unitSprite("nobody")) === null)
    check("an effect the folder doesn't have is still none", (await SE.effectFiles("battle/effect/test/none")) === null)
} catch (error) {
    console.error(error)
    failures++
} finally {
    try { fs.rmSync(slim, { recursive: true, force: true }) } catch { }
}

console.log(failures === 0 ? "All slim-folder skill preview art tests passed." : `${failures} slim-folder skill preview art test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
