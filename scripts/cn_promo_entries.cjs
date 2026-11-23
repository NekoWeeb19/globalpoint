// Ways into the round-based "Promo Missions" groups (master/reward/event/collect_item_event, column 3 = "2"). The CN
// game opens a group's mission screen from:
//   - a banner in the home screen's second carousel (master/feature_banner/feature_banner_secondary: column 6 = "3"
//     links a campaign group, 10 = its id, 26 = the picture, 27 = "2" shows it while the group is open). CN gave 24 of
//     the 31 promo groups one; this is the way in the game uses.
//   - the Events screen's header badge (group column 12, "Event Ongoing!"), as Treasure Hunt has.
//   - a home icon (group column 14): only three groups have one, and CN's home layout draws its slot under both
//     carousels, so it shows as a picture behind them that can't be tapped (1st Anniversary on 2022-10-20). Cleared.
// Fixes, applied by scripts/gen_cn_event_schedule.cjs to the tables every update ships:
//   - Black Clover (13001) and Summer 2020 (10002), the two JP-only groups with icon art, get a carousel banner (a copy
//     of 1st Anniversary's, 9108). Their pictures carry English lettering (scripts/gen_cn_art_fixes.cjs rule 5).
//   - CN's Z collab banner (9106) was copied from a Treasure Hunt banner and still linked Treasure Hunt 1: it shows Z
//     collab's picture during Treasure Hunt 1 and opened the hunt, while Z collab's promo missions (10003) had no way in.
//   - The four groups with no picture at all get the Events screen's generic "Event Ongoing!" badge.

const BANNER_TEMPLATE = "9108" // 1st Anniversary's second-carousel banner
const NEW_BANNERS = [
    { key: "913001", imageId: "913001", name: "b_collabo_campaign_mission_sec", group: "13001", image: "quest/event/banner/collect_item_event/b_collabo_mission_event_001" },
    { key: "910002", imageId: "910002", name: "summer_campaign_mission_sec", group: "10002", image: "quest/event/banner/collect_item_event/special_mission_event_001" },
]
const BANNER_LINK_FIXES = { "9106": { from: "1", to: "10003" } }
const BADGE = "quest/event/banner/collect_item_event/material_trader_mini_banner"
// Half Anniversary 2020 (JP only), Summer 2022, New Year 2022, April Fools' 2022: no picture of their own anywhere
const BADGE_GROUPS = ["10001", "10010", "80000", "80001"]

const NONE = "(None)"

/** A campaign group row (columns): home icon cleared on promo groups, the generic badge where they have no way in. */
function fixGroup(key, c) {
    if (c[3] !== "2") return false
    let changed = false
    if (c[14] !== undefined && c[14] !== NONE) { c[14] = NONE; changed = true }
    if (BADGE_GROUPS.includes(key) && c[12] === NONE) { c[12] = BADGE; changed = true }
    return changed
}

/** A second-carousel banner row (columns): CN's Z collab banner linked to its own group. */
function fixBanner(key, c) {
    const fix = BANNER_LINK_FIXES[key]
    if (!fix || c[6] !== "3" || c[10] !== fix.from) return false
    c[10] = fix.to
    return true
}

/** The new carousel banners as { key: columns }, copied from the template banner's columns. */
function newBanners(template) {
    if (!template || template[6] !== "3" || template[27] !== "2") return {}
    return Object.fromEntries(NEW_BANNERS.map(b => {
        const c = [...template]
        c[0] = b.imageId; c[2] = b.name; c[10] = b.group; c[26] = b.image
        return [b.key, c]
    }))
}

module.exports = { BANNER_TEMPLATE, NEW_BANNERS, BANNER_LINK_FIXES, BADGE, BADGE_GROUPS, fixGroup, fixBanner, newBanners }
