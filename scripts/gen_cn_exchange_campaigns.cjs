// The CN client's exchange campaigns, for the server (src/nya/exchangeCampaigns.ts):
// - Special Exchange (master/campaign/special_exchange/special_exchange_campaign): buy a selector ticket for paid
//   beads, then trade it for one character (type 0) or armament (type 1) from the campaign's list.
// - Start Dash Exchange (master/campaign/start_dash_exchange/...): a new player's selector ticket for paid beads,
//   traded for a 4★/5★ unit of the new units portal running when their window started (gacha column 21 true).
// Dates are written in UTC (CN's are China time).
//
//   MASTER_SOURCE=cn node scripts/gen_cn_exchange_campaigns.cjs   ->  assets/cn_exchange_campaigns.json
process.env.MASTER_SOURCE = "cn"
const fs = require("fs")
const path = require("path")
const { readTable, parseCsvLine } = require("./cdn_master.cjs")

const OUT = path.join(__dirname, "..", "assets", "cn_exchange_campaigns.json")
const utc = text => {
    if (!text || text === "(None)") return null
    const ms = Date.parse(text.replace(" ", "T") + "+08:00")
    return isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 19).replace("T", " ")
}
const lines = text => String(text ?? "").split("\n").map(l => l.trim()).filter(Boolean)
const ids = text => lines(text).map(l => Number(parseCsvLine(l)[0])).filter(n => n > 0)

;(async () => {
    const campaigns = await readTable("master/campaign/special_exchange/special_exchange_campaign.orderedmap", false)
    const characters = await readTable("master/campaign/special_exchange/special_exchange_campaign_character.orderedmap", false)
    const equipment = await readTable("master/campaign/special_exchange/special_exchange_campaign_equipment.orderedmap", false)
    const special = {}
    for (const [id, line] of Object.entries(campaigns)) {
        const c = parseCsvLine(String(line).split("\n")[0])
        special[id] = {
            name: c[0], scene: Number(c[2]), type: Number(c[3]),
            campaignStart: utc(c[4]), campaignEnd: utc(c[5]), exchangeStart: utc(c[6]), exchangeEnd: utc(c[7]),
            ticketItem: Number(c[9]), obtainSource: Number(c[10]) || 0, price: Number(c[11]) || 0,
            characters: ids(characters[id]), equipment: ids(equipment[id]),
        }
    }
    const dash = await readTable("master/campaign/start_dash_exchange/start_dash_exchange_campaign.orderedmap", false)
    const terms = await readTable("master/campaign/start_dash_exchange/start_dash_exchange_campaign_term.orderedmap", true)
    const exclude = await readTable("master/campaign/start_dash_exchange/start_dash_exchange_campaign_exclude_character.orderedmap", true)
    const startDash = {}
    for (const [id, line] of Object.entries(dash)) {
        const c = parseCsvLine(String(line).split("\n")[0])
        startDash[id] = {
            name: c[0], start: utc(c[2]), end: utc(c[3]), days: Number(c[4]) || 7, ticketItem: Number(c[6]), price: Number(c[7]) || 0,
            terms: Object.values(terms[id] ?? {}).map(v => utc(parseCsvLine(String(v))[0])).filter(Boolean).sort(),
            exclude: Object.fromEntries(Object.entries(exclude[id] ?? {}).map(([term, v]) => [term, ids(v)])),
        }
    }
    // the portals a Start Dash window can be tied to (character portals with column 21 true)
    const gachas = await readTable("master/gacha/gacha.orderedmap", false)
    const startDashGachas = []
    for (const [id, line] of Object.entries(gachas)) {
        const c = parseCsvLine(String(line).split("\n")[0])
        if (c[13] === "0" && c[21] === "true") startDashGachas.push({ id: Number(id), start: utc(c[29]), end: utc(c[30]) })
    }
    startDashGachas.sort((a, b) => a.start < b.start ? -1 : 1)
    fs.writeFileSync(OUT, JSON.stringify({ special, startDash, startDashGachas }, null, 1))
    console.log(`Wrote ${OUT}: ${Object.keys(special).length} special exchange, ${Object.keys(startDash).length} start dash campaigns, ${startDashGachas.length} start dash portals`)
})().catch(e => { console.error(e); process.exit(1) })
