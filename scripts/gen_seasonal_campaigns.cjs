// Builds assets/seasonal_campaigns.json for the yearly seasonal campaigns (src/lib/campaignSchedule.ts):
//  - each seasonal login bonus's original dates (Japan time) and background picture;
//  - every free pull campaign row of master/gacha/gacha_campaign (the seasonal ones are copied
//    every year; the others are needed so a copy never lands on top of one of them).
// Pictures are copied to .cdn/dashboard_images like the event catalog's.
//
//   npx tsc
//   node scripts/gen_seasonal_campaigns.cjs

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const unzipper = require("unzipper")
const { ROOT, readTable, parseCsvLine } = require("./cdn_master.cjs")
const { SEASONAL_LOGIN_BONUSES, SEASONAL_FREE_PULLS } = require("../out/lib/campaignSchedule.js")

const SALT = "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy"
const OUT = path.join(ROOT, "assets", "seasonal_campaigns.json")
const IMAGES_OUT = path.join(ROOT, ".cdn", "dashboard_images")
const CDN_DIR = path.join(ROOT, ".cdn", "en")
const LOGIN_TABLE = "master/bonus/login_bonus.orderedmap"
const FREE_PULL_TABLE = "master/gacha/gacha_campaign.orderedmap"

const hashed = logical => {
    const h = crypto.createHash("sha1").update(logical + SALT).digest("hex")
    return `production/upload/${h.slice(0, 2)}/${h.slice(2)}`
}

// hashed path -> its newest copy, for the wanted pictures only
async function pictureEntries(wanted) {
    const csv = fs.readdirSync(path.join(CDN_DIR, "entities")).filter(f => f.endsWith(".csv")).sort().pop()
    const versions = new Map(fs.readFileSync(path.join(CDN_DIR, "entities", csv), "utf8").split(/\r?\n/).map(line => { const p = line.split(","); return [p[0], p[1]] }))
    const found = new Map()
    for (const dir of fs.readdirSync(CDN_DIR).filter(d => d.startsWith("archive-"))) {
        for (const file of fs.readdirSync(path.join(CDN_DIR, dir)).filter(f => f.endsWith(".zip"))) {
            const archive = await unzipper.Open.file(path.join(CDN_DIR, dir, file))
            for (const entry of archive.files) {
                const key = "production/" + entry.path.split(String.fromCharCode(92)).join("/").replace(/^production\//, "")
                if (!wanted.has(key) || found.has(key) || !file.includes(`-${versions.get(key)}-`)) continue
                found.set(key, entry)
            }
        }
    }
    return found
}

/** Copies a picture for the dashboard (fixing the game's "\x89png" header); returns its id, or null. */
async function copyImage(entries, logical) {
    const key = hashed(logical + ".png")
    const entry = entries.get(key)
    if (entry === undefined) return null
    const id = key.split("/").slice(-2).join("")
    const out = path.join(IMAGES_OUT, `${id}.png`)
    if (!fs.existsSync(out)) {
        const data = await entry.buffer()
        if (data.length < 8 || data[0] !== 0x89 || data.toString("latin1", 1, 4).toUpperCase() !== "PNG") return null
        data.write("PNG", 1, "latin1")
        fs.mkdirSync(IMAGES_OUT, { recursive: true })
        fs.writeFileSync(out, data)
    }
    return id
}

async function main() {
    const bonuses = await readTable(LOGIN_TABLE, true)
    const loginBonuses = {}
    for (const id of Object.keys(SEASONAL_LOGIN_BONUSES)) {
        const days = bonuses[id]
        if (days === undefined) throw new Error(`login bonus ${id} is missing`)
        const first = parseCsvLine(days[Object.keys(days)[0]])
        loginBonuses[id] = { start: first[40], end: first[41], background: first[1], days: Object.keys(days).length }
    }
    const pictures = await pictureEntries(new Set(Object.values(loginBonuses).map(b => hashed(b.background + ".png"))))
    for (const bonus of Object.values(loginBonuses)) {
        bonus.image = await copyImage(pictures, bonus.background)
        delete bonus.background
    }

    const rows = await readTable(FREE_PULL_TABLE, false)
    const freePulls = Object.entries(rows).map(([id, row]) => {
        const f = parseCsvLine(row)
        return { id: Number(id), name: f[1], kind: Number(f[2]), start: f[3], end: f[4], banners: f[5].split(",").filter(Boolean).map(Number) }
    })
    for (const id of Object.keys(SEASONAL_FREE_PULLS)) if (!freePulls.some(c => c.id === Number(id))) throw new Error(`free pull campaign ${id} is missing`)

    const out = { loginBonusFile: hashed(LOGIN_TABLE), freePullFile: hashed(FREE_PULL_TABLE), loginBonuses, freePulls }
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n")
    console.log(`Wrote ${path.relative(ROOT, OUT)}: ${Object.keys(loginBonuses).length} login bonuses (${Object.values(loginBonuses).filter(b => b.image).length} pictures), ${freePulls.length} free pull campaigns.`)
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1) })
