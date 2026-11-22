// Lists each CN summon banner's own tickets (CN master/gacha/gacha: column 27 = single-pull ticket,
// 28 = 10-pull ticket, 45 = "crazy" 10-pull ticket) for gacha/exec: the CN client pulls with those
// tickets using draw kinds 3, 4 and 14, which global doesn't have.
// Also writes assets/cn_general_ticket_banners.json: the regular unit and armament banners (kind 0) with tickets of their
// own or their general-ticket column off (unit 20, armament 26), Launch Gala (banner 1) left out. The client offers the general
// tickets (999001/999003 unit, 999004/999005 armament) only on banners without their own and with that column on, so a player in the 2019-2022 part of the schedule could use them on no banner (player
// report 2026-11-22). The update builder (scripts/gen_cn_event_schedule.cjs) clears these banners' own tickets, and /load
// turns a save's tickets for them into general ones (src/nya/generalTickets.ts): { banners: [ids], swap: { ticket: general } }.
//
//   node scripts/gen_cn_gacha_tickets.cjs     -> assets/cn_gacha_tickets.json { gachaId: { once, ten, crazy } }
const fs = require("fs")
const path = require("path")
const { readCnTable } = require("./cn_read.cjs")
const { recordsOf } = require("./gen_cn_text.cjs")

;(async () => {
    const rows = await readCnTable("master/gacha/gacha.orderedmap")
    if (!rows) throw new Error("master/gacha/gacha is not in the CN game files")
    const id = v => v === undefined || v === "" || v === "(None)" ? undefined : Number(v)
    const out = {}
    for (const [key, text] of Object.entries(rows)) {
        const cells = recordsOf(String(text))[0] ?? []
        const tickets = { once: id(cells[27]), ten: id(cells[28]), crazy: id(cells[45]) }
        if (tickets.once || tickets.ten || tickets.crazy) out[key.split("/")[0]] = tickets
    }
    const file = path.join(__dirname, "..", "assets", "cn_gacha_tickets.json")
    fs.writeFileSync(file, JSON.stringify(out, null, 1))
    const banners = [], swap = {}
    for (const [key, text] of Object.entries(rows)) {
        const id = key.split("/")[0], c = recordsOf(String(text))[0] ?? []
        const set = v => v !== undefined && v !== "" && v !== "(None)"
        const unit = set(c[14]), armament = !unit && set(c[22])
        // own tickets, or the general-ticket column off (unit banners 20, armament banners 26): the client wants it on too
        // (e.g. 9090, New Year 2020 without tickets)
        if (id === "1" || c[4] !== "0" || !(unit || armament) || !(set(c[27]) || set(c[28]) || c[unit ? 20 : 26] !== "true")) continue
        banners.push(Number(id))
        if (set(c[27])) swap[c[27]] = unit ? 999003 : 999005
        if (set(c[28])) swap[c[28]] = unit ? 999001 : 999004
    }
    // a ticket shared with a kept banner (Launch Gala's) stays
    for (const t of [c1(rows, 27), c1(rows, 28)]) delete swap[t]
    const generalFile = path.join(__dirname, "..", "assets", "cn_general_ticket_banners.json")
    fs.writeFileSync(generalFile, JSON.stringify({ banners: banners.sort((a, b) => a - b), swap }, null, 1))
    console.log(`${banners.length} banners take the general tickets instead of their own -> ${generalFile}`)
    console.log(`${Object.keys(out).length} banners with their own tickets -> ${file}`)
})()

// Launch Gala's (banner 1) own ticket in a column
function c1(rows, column) {
    const key = Object.keys(rows).find(k => k.split("/")[0] === "1")
    return key ? recordsOf(String(rows[key]))[0]?.[column] : undefined
}
