// Tests scripts/cn_promo_entries.cjs: the ways into the promo mission groups the update builder puts in (carousel
// banners for Black Clover and Summer 2020, CN's Z collab banner linked to its own group, the Events badge for the four
// groups with no picture, no home icon under the carousels), and the English lettering of their art fixes. Offline.
//
//   node scripts/test_cn_promo_entries.mjs
import fs from "fs"
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const P = require("./cn_promo_entries.cjs")
let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const cols = (n, set) => { const c = Array(n).fill(""); for (const [i, v] of Object.entries(set)) c[i] = v; return c }

// campaign groups: kind in column 3, header badge 12, home icon 14
const firstAnniv = cols(28, { 3: "2", 12: "(None)", 14: "quest/event/banner/collect_item_event/1stanv_mission_event_001" })
check("a promo group's home icon is cleared (it sits under the carousels)", P.fixGroup("10004", firstAnniv) && firstAnniv[14] === "(None)" && firstAnniv[12] === "(None)")
const newYear = cols(28, { 3: "2", 12: "(None)", 14: "(None)" })
check("a promo group with no picture gets the Events badge", P.fixGroup("80000", newYear) && newYear[12] === P.BADGE)
const rcollab = cols(28, { 3: "2", 12: "(None)", 14: "(None)" })
check("a promo group with a carousel banner is left alone", !P.fixGroup("10013", rcollab) && rcollab[12] === "(None)")
const hunt = cols(28, { 3: "0", 12: "quest/event/banner/collect_item_event/collect_item_event_001", 14: "(None)" })
check("a Treasure Hunt group (kind 0) is left alone", !P.fixGroup("1", hunt))

// second-carousel banners: link kind 6, group 10, picture 26, dates mode 27
const zBanner = cols(35, { 0: "7808", 2: "feature_banner_21", 6: "3", 10: "1", 26: "quest/event/banner/collect_item_event/zcollab_mission_event_001", 27: "2" })
check("CN's Z collab banner links Z collab's promo missions, not Treasure Hunt 1", P.fixBanner("9106", zBanner) && zBanner[10] === "10003")
const other = cols(35, { 6: "3", 10: "1" })
check("other banners keep their link", !P.fixBanner("21", other) && other[10] === "1")
const template = cols(35, { 0: "1009", 1: "27", 2: "1stanv_campaign_mission_sec", 6: "3", 10: "10004", 26: "quest/event/banner/collect_item_event/1stanv_mission_event_001", 27: "2", 33: "(None)" })
const added = P.newBanners(template)
check("two banners added, for Black Clover and Summer 2020", added["913001"]?.[10] === "13001" && added["910002"]?.[10] === "10002" && Object.keys(added).length === 2)
check("they follow their group's dates and use the group's own picture", Object.values(added).every(c => c[6] === "3" && c[27] === "2" && c[33] === "(None)" && c[1] === "27")
    && added["913001"][26].endsWith("b_collabo_mission_event_001"))
check("the template row itself is unchanged", template[10] === "10004")
check("no banners from a template that isn't a campaign banner", Object.keys(P.newBanners(cols(35, { 6: "8" }))).length === 0)

// where it's used
const builder = fs.readFileSync(new URL("./gen_cn_event_schedule.cjs", import.meta.url), "utf8")
check("the update builder applies the group, banner and new-row rules",
    builder.includes("PROMO.fixGroup(key, c)") && builder.includes("PROMO.fixBanner(key, c)") && builder.includes("PROMO.newBanners("))

// the art fixes carry the two pictures with English lettering
const { uploadPath } = require("./cdn_hash.cjs")
const art = JSON.parse(fs.readFileSync(new URL("../assets/cn_art_fixes.json", import.meta.url), "utf8"))
for (const b of P.NEW_BANNERS) {
    const key = uploadPath(b.image + ".png").replace(/^production\/upload\//, "")
    const fix = art.find(f => f.path.endsWith(key))
    check(`${b.image.split("/").pop()}: an English picture in the art fixes`, fix && /English|"Promo Missions"/.test(fix.why) && fs.existsSync(new URL("../assets/cn_art_fixes/" + fix.path, import.meta.url)), fix)
}

// the lettering swap on a made-up picture: the "Japanese" lettering (a red bar) replaced by the "English" (a blue bar)
const { englishLettering } = require("./promo_icon_lettering.cjs")
const W = 200, H = 200
const pic = (bg, bars) => { const px = Buffer.alloc(W * H * 4); for (let p = 0; p < W * H; p++) { const x = p % W, y = (p / W) | 0; let c = bg(x, y); for (const b of bars) if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) c = b.c; px.set([...c, 255], p * 4) } return { w: W, h: H, px } }
const JP = c => ({ x0: 150, x1: 190, y0: 170, y1: 180, c }), EN = { x0: 152, x1: 186, y0: 172, y1: 178, c: [40, 80, 220] }
const orange = [240, 150, 40]
const artA = (x, y) => [x % 50, y % 60, 90], artB = (x, y) => [100, (x * 3) % 90, y % 70], target = (x, y) => [20 + (y % 40), 30, 40 + (x % 30)]
const shifted = b => ({ ...b, y0: b.y0 - 4, y1: b.y1 - 4 })
const out = englishLettering(pic(target, [shifted(JP(orange))]), pic(artA, [JP(orange)]), pic(artA, [EN]), pic(artB, [EN]))
check("the swap finds the lettering 4 pixels higher", out && out.offset.dy === -4 && out.offset.dx === 0, out?.offset)
const at = (x, y) => [...out.px.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)]
check("English lettering drawn where the Japanese was", JSON.stringify(at(160, 170)) === JSON.stringify(EN.c))
check("no orange (Japanese) pixels left", (() => { for (let p = 0; p < W * H; p++) if (out.px[p * 4] === 240 && out.px[p * 4 + 1] === 150) return false; return true })())
check("the art away from the lettering is untouched", JSON.stringify(at(20, 20)) === JSON.stringify(target(20, 20)))
check("no swap when the lettering doesn't line up", englishLettering(pic(target, []), pic(artA, [JP(orange)]), pic(artA, [EN]), pic(artB, [EN])) === null)

console.log(failures ? `\n${failures} promo entry test(s) failed.` : "\nAll promo entry tests passed.")
process.exit(failures ? 1 : 0)
