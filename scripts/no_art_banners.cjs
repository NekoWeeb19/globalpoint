// Summon banners that would show up without art in game: their list picture is in neither game's files
// (CN or global), or the CN game has no summon-screen art for them (below). They stay in the catalog on
// their own (the dashboard can still schedule one on purpose), but nothing brings them along: scripts/gen_event_catalog.cjs doesn't attach them to an event that opened the
// same day, and scripts/gen_cn_campaigns.cjs leaves them out of free pull campaigns.
//   CN: 1523, 1540, 1544, 1552, 1556 (Featured / Spotlight portals), 800100, 800200, 800201, 800205
//       (Star Heroes; also charged as daily paid pulls by StarPoint, unlike CN's 1500-bead guaranteed 5*)
//   global: 89, 127, 143 (New Faces Spotlight portals)
//   and banners with no summon-screen art in either game (checked 2026-11-02): 61, 62 (no rows, and no
//   original to borrow from), 70 (its picture is in neither game's files)
// Restored by scripts/gen_cn_banner_art.cjs (CN patch 1.4.195) and so no longer listed: 44, 64, 66, 68,
// 69, 72, 74, 76, 77, 82, 84, 86, 87, 5009, 5013, 5015, 800000, 800002-800005.
const NO_ART_BANNERS = new Set([
    "1523", "1540", "1544", "1552", "1556", "800100", "800200", "800201", "800205", "89", "127", "143",
    "61", "62", "70",
])

module.exports = { NO_ART_BANNERS }
