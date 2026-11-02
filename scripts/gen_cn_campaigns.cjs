// The CN game's campaigns that global's data doesn't have (CN's tables hold every global campaign
// with the same id, plus these): login bonus groups, free pull campaigns, and reward/stamina campaign
// rows. The server uses them for the CN client on top of global's (src/nya/cnCampaigns.ts), and the
// dashboard's Campaigns tab lists the seasonal ones as "CN only".
//
// Dates: CN's master dates are China time (UTC+8); global's master dates are UTC (the same banner
// starts at 12:00 in CN's data and 04:00 in global's), so they're written here in UTC, like global's.
//
// CN's login_bonus rows have 48 columns: global's 47 with one more at 40, so the dates are one column
// later (41/42 open window, 43/44 yearly window, 46 linked comeback group).
//
//   node --env-file=.env scripts/gen_cn_campaigns.cjs   -> assets/campaigns_cn.json
//   (pictures go to .cdn/dashboard_images, like the event catalog's)
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const unzipper = require("unzipper")
const R = require("./cdn_rows.cjs")
const { NO_ART_BANNERS } = require("./no_art_banners.cjs")
const { cnZips } = require("./cn_archives.cjs")
const { readCnTable } = require("F:/WF client/tools/cn_read.cjs")

const ROOT = path.join(__dirname, "..")
const OUT = path.join(ROOT, "assets", "campaigns_cn.json")
const IMAGES_OUT = path.join(ROOT, ".cdn", "dashboard_images")
const SALT = "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy"
const TYPES = ["Normal", "Limited", "Comeback", "ComebackAlways", "ActiveUser"]
const NONE = v => v === undefined || v === "" || v === "(None)"
const str = v => (NONE(v) ? null : v)
const int = v => (NONE(v) ? null : Number(v))

const globalLogin = require("../assets/login_bonus.json").groups
const globalReward = require("../assets/reward_campaign.json").campaigns
const globalStamina = require("../assets/stamina_campaign.json").campaigns
const globalFreePulls = require("../assets/seasonal_campaigns.json").freePulls
const globalGachaCampaign = require("../assets/gacha_campaign.json")

const hashed = logical => {
    const h = crypto.createHash("sha1").update(logical + SALT).digest("hex")
    return `production/upload/${h.slice(0, 2)}/${h.slice(2)}`
}

// "2025-06-19 12:00:00" China time -> the same moment written in UTC / Japan time
const shift = (text, hours) => {
    if (NONE(text)) return null
    const ms = Date.parse(text.replace(" ", "T") + "+08:00") + hours * 3600_000
    if (isNaN(ms)) return text
    return new Date(ms).toISOString().replace("T", " ").slice(0, 19)
}
const toUtc = text => shift(text, 0)
// yearly windows ("MM-DD hh:mm:ss", China time) -> UTC
const yearlyToUtc = text => (NONE(text) ? null : shift(`2001-${text}`, 0)?.slice(5) ?? null)

const rows = async table => Object.entries(await readCnTable(table)).map(([k, v]) => [k, R.splitCsv(v.replace(/\n$/, ""))])

;(async () => {
    // English names from the translated text the CN client gets (falls back to CN's own)
    const textDir = process.env.CN_TRANSLATED_DIR
    const translated = textDir ? new Map(JSON.parse(fs.readFileSync(path.join(textDir, "files.json"), "utf8")).map(f => [f.path, f.from])) : new Map()
    const englishRows = table => {
        const file = translated.get(hashed(table))
        if (!file) return new Map()
        return new Map(R.leaves(R.decodeFile(fs.readFileSync(file))).map(l => [l.path.join("/"), R.splitCsv(l.leaf.text.replace(/\n$/, ""))]))
    }

    // ---- login bonuses ----
    const loginEn = englishRows("master/bonus/login_bonus.orderedmap")
    const byGroup = {}
    for (const [key, c] of await rows("master/bonus/login_bonus.orderedmap")) {
        const [group, day] = key.split("/")
        ;(byGroup[group] ??= {})[day] = c
    }
    const loginBonuses = {}, loginInfo = {}
    for (const [id, days] of Object.entries(byGroup)) {
        if (globalLogin[id] !== undefined) continue
        const lines = Object.keys(days).map(Number).sort((a, b) => a - b).map(d => days[String(d)])
        const first = lines[0]
        const type = TYPES[Number(first[0])]
        if (type === undefined) continue
        loginBonuses[id] = {
            type,
            start: toUtc(first[41]),
            end: toUtc(first[42]),
            yearlyFrom: yearlyToUtc(first[43]),
            yearlyUntil: yearlyToUtc(first[44]),
            linkedComeback: str(first[46]),
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
        loginInfo[id] = { name: loginEn.get(`${id}/1`)?.[3] ?? first[3], background: first[1], start: toUtc(first[41]), end: toUtc(first[42]), days: lines.length }
    }

    // ---- free pulls ----
    const pullEn = englishRows("master/gacha/gacha_campaign.orderedmap")
    const freePulls = [], gachaCampaigns = {}
    for (const [id, c] of await rows("master/gacha/gacha_campaign.orderedmap")) {
        if (globalFreePulls.some(p => p.id === Number(id))) continue
        // (not banners without a picture: scripts/no_art_banners.cjs)
        const banners = (c[5] ?? "").split(",").filter(Boolean).filter(b => !NO_ART_BANNERS.has(b)).map(Number)
        freePulls.push({ id: Number(id), name: pullEn.get(id)?.[1] ?? c[1], kind: Number(c[2]), start: toUtc(c[3]), end: toUtc(c[4]), banners, picture: str(c[6]) })
        // a banner global's data has no free pull for takes this campaign (the newest one wins)
        for (const banner of banners) if (globalGachaCampaign[String(banner)] === undefined) gachaCampaigns[String(banner)] = Number(id)
    }

    // ---- reward / stamina campaigns ----
    const query = v => (NONE(v) ? null : v)
    const rewardCampaigns = [], staminaCampaigns = []
    for (const [id, c] of await rows("master/campaign/reward_campaign.orderedmap")) {
        if (globalReward.some(r => r.id === Number(id))) continue
        rewardCampaigns.push({ id: Number(id), weekly: c[0] === "1", start: toUtc(c[1]), end: toUtc(c[2]), rewardKind: Number(c[5]), rate: Number(c[6]), range: [Number(c[7]), query(c[8]), query(c[9]), query(c[10])] })
    }
    for (const [id, c] of await rows("master/campaign/stamina_campaign.orderedmap")) {
        if (globalStamina.some(r => r.id === Number(id))) continue
        staminaCampaigns.push({ id: Number(id), weekly: c[0] === "1", start: toUtc(c[1]), end: toUtc(c[2]), rate: Number(c[5]), range: [Number(c[6]), query(c[7]), query(c[8]), query(c[9])] })
    }

    // ---- pictures (login bonus backgrounds, free pull share images) from CN's game files ----
    const wanted = new Map()
    for (const info of Object.values(loginInfo)) if (info.background) wanted.set(hashed(info.background + ".png"), info)
    for (const pull of freePulls) if (pull.picture) wanted.set(hashed(pull.picture + ".png"), pull)
    fs.mkdirSync(IMAGES_OUT, { recursive: true })
    let pictures = 0
    for (const zip of cnZips("D:/WF client/.cdn/cn")) {
        for (const entry of (await unzipper.Open.file(zip)).files) {
            const key = "production/" + entry.path.split("\\").join("/").replace(/^production\//, "")
            const owner = wanted.get(key)
            if (!owner || owner.image) continue
            const data = await entry.buffer()
            if (data.length < 8 || data[0] !== 0x89 || data.toString("latin1", 1, 4).toUpperCase() !== "PNG") continue
            data.write("PNG", 1, "latin1")
            const id = key.split("/").slice(-2).join("")
            fs.writeFileSync(path.join(IMAGES_OUT, `${id}.png`), data)
            owner.image = id
            pictures++
        }
    }
    for (const info of Object.values(loginInfo)) { info.image ??= null; delete info.background }
    for (const pull of freePulls) { pull.image ??= null; delete pull.picture }

    fs.writeFileSync(OUT, JSON.stringify({
        _note: "Built by scripts/gen_cn_campaigns.cjs: the CN game's campaigns global's data doesn't have. Dates in UTC, like global's master dates.",
        loginBonuses, loginInfo, freePulls, gachaCampaigns, rewardCampaigns, staminaCampaigns,
    }, null, 1) + "\n")
    console.log(`Wrote ${OUT}: ${Object.keys(loginBonuses).length} login bonuses, ${freePulls.length} free pulls (${Object.keys(gachaCampaigns).length} banners), ${rewardCampaigns.length} reward and ${staminaCampaigns.length} stamina campaign rows, ${pictures} pictures`)
})().catch(e => { console.error(e); process.exit(1) })
