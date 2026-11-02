// Summon banners whose list picture is in neither game's files (CN or global), so they'd show up blank
// in game. They stay in the catalog on their own (the dashboard can still schedule one on purpose), but
// nothing brings them along: scripts/gen_event_catalog.cjs doesn't attach them to an event that opened the
// same day, and scripts/gen_cn_campaigns.cjs leaves them out of free pull campaigns.
//   CN: 1523, 1540, 1544, 1552, 1556 (Featured / Spotlight portals), 800100, 800200, 800201, 800205
//       (Star Heroes; also charged as daily paid pulls by StarPoint, unlike CN's 1500-bead guaranteed 5*)
//   global: 89, 127, 143 (New Faces Spotlight portals)
const NO_ART_BANNERS = new Set(["1523", "1540", "1544", "1552", "1556", "800100", "800200", "800201", "800205", "89", "127", "143"])

module.exports = { NO_ART_BANNERS }
