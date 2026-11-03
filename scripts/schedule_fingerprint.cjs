// A fingerprint of the saved schedules the CN game update is built from (.database/event_schedule.json
// and campaign_schedule.json). scripts/gen_cn_event_schedule.cjs stores the fingerprint it built from in
// .database/cn_schedule_built.json; the server compares it at start (src/nya/eventSchedule.ts) and rebuilds
// the update when the schedules changed without a dashboard edit (an imported save, a data pack, a copy from a PC).
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

// raised when scripts/gen_cn_event_schedule.cjs changes what it writes, so every install rebuilds its
// update once (2: permanent dungeons kept open; 3: one Launch Gala banner at a time; 4: blank announcements hidden)
const BUILDER_REVISION = 4

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
    return crypto.createHash("sha1").update(JSON.stringify(stable({ events, yearly, builder: BUILDER_REVISION }))).digest("hex")
}

/** What the current CN update was built from, or null (an update built before this was recorded). */
function readBuilt(dataDir) {
    return readJson(path.join(dataDir, "cn_schedule_built.json"))
}

module.exports = { scheduleFingerprint, readBuilt }
