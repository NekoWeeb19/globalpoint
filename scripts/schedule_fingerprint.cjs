// A fingerprint of the saved schedules (and the custom units) the CN game update is built from (.database/event_schedule.json
// and campaign_schedule.json). scripts/gen_cn_event_schedule.cjs stores the fingerprint it built from in
// .database/cn_schedule_built.json; the server compares it at start (src/nya/eventSchedule.ts) and rebuilds
// the update when the schedules changed without a dashboard edit (an imported save, a data pack, a copy from a PC).
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

// raised when scripts/gen_cn_event_schedule.cjs changes what it writes, so every install rebuilds its
// update once (2: permanent dungeons kept open; 3: one Launch Gala banner at a time; 4: blank announcements hidden; 6: column 26 change of revision 5 undone; 7: armament ticket deadlines end with their pull window; 8: own rates copies (tried, removed); 9: test, no ticket items (removed); 10: armament portals keep their rates loaded (freemium flag on); 11: launch units MB2 on later waves; 12: MB2 by JP waves; 13: home banners without a picture hidden; 14: world story banners on their events dates; 16: The Haunt from 2020-01; 17: unit banners without art dated 2011 unless scheduled)
const BUILDER_REVISION = 17

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return null } }

/** Same order of keys everywhere, so formatting doesn't change the fingerprint. */
const stable = value => Array.isArray(value) ? value.map(stable)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]))
    : value

/** The fingerprint of the schedules in a .database folder. Missing files count as empty schedules. */
function scheduleFingerprint(dataDir) {
    const events = readJson(path.join(dataDir, "event_schedule.json"))?.entries ?? []
    const campaigns = readJson(path.join(dataDir, "campaign_schedule.json")) ?? {}
    const yearly = ["yearlyLoginBonuses", "yearlyFreePulls", "yearlyRewardRuns", "yearlyStaminaRuns"]
        .map(key => [key, Array.isArray(campaigns[key]) ? [...campaigns[key]].map(String).sort() : []])
    // custom units (assets/custom_units, scripts/custom_units.cjs): a unit added or changed needs its rows shipped
    // (only counted when there are any, so installs without custom units keep their fingerprint)
    const CU = require("./custom_units.cjs")
    const custom = [CU.readCustomUnits().fingerprint, CU.readUnitChanges().fingerprint].filter(Boolean).join(",")
    // and the kit rows (assets/kit_dates.json): an edited row ships at the next start, not only when a date passes
    let kits = ""
    try { kits = crypto.createHash("sha1").update(fs.readFileSync(path.join(__dirname, "..", "assets", "kit_dates.json"))).digest("hex") } catch { }
    // and the enemy strength (scripts/enemy_scaling.cjs; only when set, so other installs keep their fingerprint)
    const ES = require("./enemy_scaling.cjs"), enemy = ES.readEnemyScaling(dataDir)
    return crypto.createHash("sha1").update(JSON.stringify(stable({ events, yearly, builder: BUILDER_REVISION, ...(custom ? { custom } : {}), ...(kits ? { kits } : {}), ...(ES.isDefault(enemy) ? {} : { enemy }) }))).digest("hex")
}

/** What the current CN update was built from, or null (an update built before this was recorded). */
function readBuilt(dataDir) {
    return readJson(path.join(dataDir, "cn_schedule_built.json"))
}

module.exports = { scheduleFingerprint, readBuilt }
