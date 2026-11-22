// Builds assets/cn_comeback_bonuses.json: the CN game's own returning-player login bonuses (master/bonus/
// login_bonus groups of the comeback types), with the columns that say who gets them, for src/nya/comeback.ts.
// CN's rows have 48 columns (scripts/gen_cn_campaigns.cjs): 0 type, 6.. rewards (7 slots of 4), 38/39 the period the
// previous login must fall in, 40 days away, 41/42 open window, 46 linked group, 47 whether beginners count.
// Types (the CN fork startpoint-cn: src/content/converters/login-bonus.ts): 2 Comeback, 3 ComebackAlways,
// 5 ComebackCn, 6 ComebackJp. Times are China time in the table, UTC here.
//
//   node scripts/gen_cn_comeback_bonuses.cjs          (CN_CDN_DIR set: CN's game files)
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")

const TYPES = { 2: "Comeback", 3: "ComebackAlways", 5: "ComebackCn", 6: "ComebackJp" }
const NONE = v => v === undefined || v === "" || v === "(None)"
const toUtc = text => {
    if (NONE(text)) return null
    const ms = Date.parse(text.replace(" ", "T") + "+08:00")
    return isNaN(ms) ? null : new Date(ms).toISOString().replace("T", " ").slice(0, 19)
}
const int = v => (NONE(v) ? null : Number(v))

;(async () => {
    const table = await readCnTable("master/bonus/login_bonus.orderedmap")
    if (!table) throw new Error("no CN login_bonus table (set CN_CDN_DIR)")
    const byGroup = {}
    for (const [key, text] of Object.entries(table)) {
        const [group, day] = key.split("/")
        ;(byGroup[group] ??= {})[day] = R.splitCsv(text.replace(/\n$/, ""))
    }
    const groups = {}
    for (const [id, days] of Object.entries(byGroup)) {
        const lines = Object.keys(days).map(Number).sort((a, b) => a - b).map(d => days[String(d)])
        const first = lines[0], type = TYPES[first[0]]
        if (type === undefined) continue
        groups[id] = {
            type,
            start: toUtc(first[41]),
            end: toUtc(first[42]),
            yearlyFrom: null,
            yearlyUntil: null,
            linkedComeback: NONE(first[46]) ? null : first[46],
            conditionFrom: toUtc(first[38]),
            conditionUntil: toUtc(first[39]),
            daysAway: int(first[40]),
            includeBeginner: NONE(first[47]) ? null : first[47] === "true",
            days: lines.map(c => {
                const rewards = []
                for (let slot = 0; slot < 7; slot++) {
                    const col = 6 + slot * 4, kind = int(c[col])
                    if (kind === null) continue
                    const reward = { kind, amount: Number(c[col + 1]) }
                    if (kind === 1) reward.id = int(c[col + 2])
                    if (kind === 2) reward.id = int(c[col + 3])
                    rewards.push(reward)
                }
                return rewards
            }),
        }
    }
    const out = {
        _note: "CN's own returning-player login bonuses (scripts/gen_cn_comeback_bonuses.cjs from CN's master/bonus/login_bonus), used by src/nya/comeback.ts. Times UTC. conditionFrom/Until: when the previous login must have been; daysAway: how long away.",
        groups,
    }
    const file = path.join(__dirname, "..", "assets", "cn_comeback_bonuses.json")
    fs.writeFileSync(file, JSON.stringify(out, null, 1) + "\n")
    console.log(`${Object.keys(groups).length} groups: ${Object.entries(groups).map(([id, g]) => `${id} (${g.type}, ${g.days.length} days)`).join(", ")}`)
})()
