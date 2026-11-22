// Tests CN's rank cap by date (src/lib/rankCap.ts): the CN app's rank points stop at the cap rank's total of the
// server date, the global app isn't capped, a save above the cap keeps its rank, the next raise lets it rank up
// again, and the Game settings switch turns it off. On a throwaway save in a temp folder.
//
//   npx tsc
//   node scripts/test_rank_cap.mjs
import fs from "fs"
import os from "os"
import path from "path"

const out = new URL("../out/", import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rank-cap-"))
process.chdir(temp) // the settings go in <working folder>/.database

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

try {
    const R = await import(new URL("lib/rankCap.js", out))
    const { givePlayerRankPoint, getRankByPt } = await import(new URL("nya/player.js", out))
    const { setServerTime } = await import(new URL("utils.js", out))
    const { runInCnContext } = await import(new URL("lib/cnClient.js", out))
    const { setServerSettings, getServerSettings } = await import(new URL("nya/serverSettings.js", out))
    const cn = fn => { let r; runInCnContext(true, () => { r = fn() }); return r }
    const at = iso => setServerTime(new Date(iso))
    const player = rp => ({ id: 1, rankPoint: rp, stamina: 10, staminaHealTime: new Date() })
    const rankOf = p => getRankByPt(p.rankPoint).rank

    // the dates (UTC = CN time - 8 h)
    const caps = [["2020-05-01T00:00:00Z", 100], ["2021-10-26T03:00:00Z", 100], ["2021-12-16T03:59:00Z", 100], ["2021-12-16T04:00:00Z", 125],
        ["2022-06-09T04:00:00Z", 125], ["2022-06-16T04:00:00Z", 150], ["2023-02-02T04:00:00Z", 175], ["2024-05-09T04:00:00Z", 250], ["2030-01-01T00:00:00Z", 250]]
    const wrong = caps.filter(([iso, cap]) => R.cnRankCapAt(Date.parse(iso)) !== cap)
    check("CN's caps by date: 100 (and before launch), 125, 150 (06-16, not 06-09), 175, 250", wrong.length === 0, wrong)

    check("the cap is on by default", getServerSettings().cnRankCap === true)

    // a save near rank 100 in 2022-01 (cap 125) and 2021-11 (cap 100)
    at("2021-11-15T00:00:00Z")
    const cap100 = R.rankTotalPoints(100)
    let p = player(cap100 - 10)
    cn(() => givePlayerRankPoint(p, 100000))
    check("the CN app stops at the cap rank's total", p.rankPoint === cap100 && rankOf(p) === 100, [p.rankPoint, rankOf(p)])
    cn(() => givePlayerRankPoint(p, 5000))
    check("... and gains nothing more at the cap (nothing saved up)", p.rankPoint === cap100)
    let g = player(cap100 - 10)
    givePlayerRankPoint(g, 100000)
    check("the global app isn't capped", g.rankPoint === cap100 - 10 + 100000 && rankOf(g) > 100, [g.rankPoint, rankOf(g)])

    // a save already past the cap keeps its rank
    let high = player(R.rankTotalPoints(180))
    cn(() => givePlayerRankPoint(high, 1000))
    check("a save above the cap keeps its rank (gains nothing, loses nothing)", high.rankPoint === R.rankTotalPoints(180) && rankOf(high) === 180, [high.rankPoint, rankOf(high)])

    // the next raise: ranking up carries on
    at("2021-12-17T00:00:00Z")
    cn(() => givePlayerRankPoint(p, 5000))
    check("after the 125 raise, ranking up carries on from the cap", p.rankPoint === cap100 + 5000 && rankOf(p) >= 100, [p.rankPoint, rankOf(p)])
    cn(() => givePlayerRankPoint(p, 99_999_999))
    check("... up to 125", rankOf(p) === 125 && p.rankPoint === R.rankTotalPoints(125), [p.rankPoint, rankOf(p)])

    at("2024-06-01T00:00:00Z")
    const top = player(R.rankTotalPoints(249))
    cn(() => givePlayerRankPoint(top, 99_999_999))
    check("from 2024-05-09 there's no cap below 250", rankOf(top) === 250)

    // the switch
    at("2021-11-15T00:00:00Z")
    setServerSettings({ cnRankCap: false })
    let off = player(cap100 - 10)
    cn(() => givePlayerRankPoint(off, 100000))
    check("turned off: the CN app ranks past the cap", off.rankPoint === cap100 - 10 + 100000, off.rankPoint)
    check("the switch is saved", getServerSettings().cnRankCap === false)
    setServerSettings({ cnRankCap: true })
    check("... and turns back on", getServerSettings().cnRankCap === true)
} finally {
    process.chdir(os.tmpdir())
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { }
}

console.log(failures ? `\n${failures} rank cap test(s) failed.` : "\nAll rank cap tests passed.")
process.exit(failures ? 1 : 0)
