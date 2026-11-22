// Old summon banners take the general tickets (player report 2026-11-22: a general 10-pull ticket showed on no banner in
// the 2019-2020 part of the schedule). assets/cn_general_ticket_banners.json lists the banners whose own tickets the
// update clears, and /load turns a save's tickets for them into general ones (src/nya/generalTickets.ts).
//   npx tsc
//   node scripts/test_general_tickets.mjs
import fs from "fs"
import os from "os"
import path from "path"

const out = new URL("../out/", import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "general-tickets-"))
process.chdir(temp) // the save goes in <working folder>/.database

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

let getDatabase
try {
    const list = JSON.parse(fs.readFileSync(new URL("../assets/cn_general_ticket_banners.json", import.meta.url), "utf8"))
    check("New Year 2020 (8) and armament banner 3 take the general tickets", list.banners.includes(8) && list.banners.includes(3), list.banners)
    check("Launch Gala (1), the 4/5-star portals (2, 4) and later ticket portals keep their own", ![1, 2, 4, 1675, 900003].some(b => list.banners.includes(b)))
    check("Launch Gala's tickets aren't swapped", !("20001" in list.swap) && !("20002" in list.swap))
    check("unit 1-pull -> general 1-pull, 10-pull -> general 10-pull", list.swap["20013"] === 999003 && list.swap["20014"] === 999001, [list.swap["20013"], list.swap["20014"]])
    check("armament tickets -> general armament tickets", list.swap["20005"] === 999005 && list.swap["20006"] === 999004, [list.swap["20005"], list.swap["20006"]])

    getDatabase = (await import(new URL("data/index.js", out))).default.default
    const W = await import(new URL("data/wdfpData.js", out))
    const T = await import(new URL("nya/generalTickets.js", out))
    const db = getDatabase(0 /* Database.WDFP_DATA */)
    const now = new Date().toISOString()
    const accountId = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
        VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(now, now, now).lastInsertRowid)
    const playerId = W.insertDefaultPlayerSync(accountId).id
    const count = id => W.getPlayerItemSync(playerId, id) ?? 0
    const base = { 999001: count(999001), 999003: count(999003), 999004: count(999004), 20002: count(20002) }
    W.givePlayerItemSync(playerId, 20014, 2) // New Year 2020 10-pull
    W.givePlayerItemSync(playerId, 20013, 3) // New Year 2020 1-pull
    W.givePlayerItemSync(playerId, 20006, 1) // armament 10-pull
    W.givePlayerItemSync(playerId, 20002, 1) // Launch Gala 10-pull
    const swapped = T.swapOldBannerTicketsSync(playerId)
    check("6 tickets swapped", swapped === 6, swapped)
    check("the old tickets are gone", count(20014) === 0 && count(20013) === 0 && count(20006) === 0, [count(20014), count(20013), count(20006)])
    check("general 10-pull +2, 1-pull +3, armament 10-pull +1", count(999001) === base[999001] + 2 && count(999003) === base[999003] + 3 && count(999004) === base[999004] + 1)
    check("the Launch Gala ticket stays", count(20002) === base[20002] + 1, count(20002))
    check("a second login swaps nothing", T.swapOldBannerTicketsSync(playerId) === 0)
} catch (error) {
    console.error(error)
    failures++
} finally {
    try { getDatabase?.(0).close() } catch { }
    process.chdir(os.tmpdir())
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch (e) { console.log(`temp folder left: ${temp} (${e.code})`) }
}

console.log(failures === 0 ? "All general ticket tests passed." : `${failures} general ticket test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
