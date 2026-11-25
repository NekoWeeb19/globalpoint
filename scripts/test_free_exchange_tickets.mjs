// Tests the free exchange campaigns' tickets (src/nya/exchangeCampaigns.ts issueFreeExchangeTicketsSync): CN issued the
// ticket of a price-0 campaign directly, once per player while it ran (the 2024-07 Dream Armament Exchange Ticket Promo,
// the Gift Unit Exchange Ticket promos); without it the exchange page opened with Trade greyed out. Paid campaigns
// aren't given away. On a throwaway save in a temp folder.
//
//   npx tsc
//   node scripts/test_free_exchange_tickets.mjs
import fs from "fs"
import os from "os"
import path from "path"

const out = new URL("../out/", import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "free-exchange-"))
process.chdir(temp)
delete process.env.CN_ACCOUNT_ID

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

try {
    const getDatabase = (await import(new URL("data/index.js", out))).default.default
    const { insertDefaultPlayerSync, getPlayerItemSync } = await import(new URL("data/wdfpData.js", out))
    const { setServerTime } = await import(new URL("utils.js", out))
    const { issueFreeExchangeTicketsSync, specialExchangeListSync } = await import(new URL("nya/exchangeCampaigns.js", out))
    const db = getDatabase(0)
    const stamp = new Date().toISOString()
    const newPlayer = () => {
        const account = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
            VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(stamp, stamp, stamp).lastInsertRowid)
        return insertDefaultPlayerSync(account).id
    }
    const status = (p, id) => specialExchangeListSync(p).find(c => c.campaign_id === id)?.status

    // 2024-07-15: Dream Armament Exchange Ticket Promo 1012 (free, ticket 999006) and Scouting 1011 (1,500 paid beads)
    setServerTime(new Date("2024-07-15T12:00:00Z"))
    const A = newPlayer()
    const given = issueFreeExchangeTicketsSync(A)
    check("the free Dream Armament campaign's ticket is given", JSON.stringify(given) === "[1012]" && (getPlayerItemSync(A, 999006) ?? 0) === 1, { given, owned: getPlayerItemSync(A, 999006) })
    check("its campaign shows the ticket held (status 2), so Trade works", status(A, 1012) === 2, status(A, 1012))
    check("the paid Scouting campaign isn't given away", (getPlayerItemSync(A, 999002) ?? 0) === 0 && status(A, 1011) === 1)
    check("given once only", issueFreeExchangeTicketsSync(A).length === 0 && getPlayerItemSync(A, 999006) === 1)

    // after the campaign: no new tickets, and a ticket kept is still listed (CN's game sends its holder to the exchange)
    setServerTime(new Date("2024-08-20T12:00:00Z"))
    const B = newPlayer()
    check("nothing given outside a free campaign's window", issueFreeExchangeTicketsSync(B).length === 0 && (getPlayerItemSync(B, 999006) ?? 0) === 0)
    check("a ticket kept past the end is still listed for trading", status(A, 1012) === 2)

    // 2025-02-10: Gift Unit Exchange Ticket promo 50014 (free, ticket 999009)
    setServerTime(new Date("2025-02-10T12:00:00Z"))
    const C = newPlayer()
    check("the Gift Unit Exchange Ticket is given during its promo", issueFreeExchangeTicketsSync(C).includes(50014) && getPlayerItemSync(C, 999009) === 1)
    setServerTime(null)
} catch (error) {
    console.log("FAIL", error)
    failures++
} finally {
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { }
}

console.log(failures ? `\n${failures} free exchange ticket test(s) failed.` : "\nAll free exchange ticket tests passed.")
process.exit(failures ? 1 : 0)
