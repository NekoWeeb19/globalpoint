// Tests the co-op partners picked on the dashboard (player page, src/nya/coopPartnerPicks.ts): picked parties come
// before the "NPC"-named and strongest ones (src/lib/coop.ts pickPartnerParties), a picked party that's in use, empty
// or gone is skipped, and saving refuses parties the save doesn't have or that have no units.
//   npx tsc
//   node scripts/test_coop_partner_picks.mjs
import fs from "fs"
import os from "os"
import path from "path"

const out = new URL("../out/", import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "coop-partner-picks-"))
process.chdir(temp) // the save goes in <working folder>/.database

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

let getDatabase
try {
    const { pickPartnerParties } = await import(new URL("lib/coop.js", out))

    // --- pure order
    const party = (partyId, name, strength = 0, units = [1, null, null]) => ({ partyId, name, characterIds: units, strength })
    const parties = [party(1, "Party A", 900), party(2, "Water NPC", 10), party(3, "NPC", 20), party(4, "Party D", 800), party(5, "Party E", 700), party(6, "Empty", 0, [null, null, null])]
    const pick = (...args) => JSON.stringify(pickPartnerParties(...args))
    check("no picks: the old order (NPC parties)", pick(parties, 1, 1) === "[2,3]", pick(parties, 1, 1))
    check("two picks: those two, in the picked order", pick(parties, 1, 1, [5, 4]) === "[5,4]", pick(parties, 1, 1, [5, 4]))
    check("one pick: it, then the usual first (Water NPC on a water stage)", pick(parties, 1, 1, [4]) === "[4,2]", pick(parties, 1, 1, [4]))
    check("a picked party in use is skipped", pick(parties, 4, 1, [4, 5]) === "[5,2]", pick(parties, 4, 1, [4, 5]))
    check("an empty picked party is skipped", pick(parties, 1, 1, [6, 5]) === "[5,2]", pick(parties, 1, 1, [6, 5]))
    check("a picked party the save doesn't have is skipped", pick(parties, 1, undefined, [99, 4]) === "[4,2]", pick(parties, 1, undefined, [99, 4]))
    check("the same party picked twice counts once", pick(parties, 1, undefined, [4, 4]) === "[4,2]", pick(parties, 1, undefined, [4, 4]))

    // --- saved picks on a real save
    getDatabase = (await import(new URL("data/index.js", out))).default.default
    const W = await import(new URL("data/wdfpData.js", out))
    const P = await import(new URL("nya/coopPartnerPicks.js", out))
    const C = await import(new URL("nya/coop.js", out))
    const db = getDatabase(0 /* Database.WDFP_DATA */)
    const now = new Date().toISOString()
    const accountId = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
        VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(now, now, now).lastInsertRowid)
    const playerId = W.insertDefaultPlayerSync(accountId).id
    for (const id of [111001, 111002, 111003]) W.insertDefaultPlayerCharacterSync(playerId, id)
    const setParty = (slot, unit) => db.prepare("UPDATE players_parties SET character_id_1 = ? WHERE player_id = ? AND slot = ? AND category = 1").run(unit, playerId, slot)
    setParty(2, 111001); setParty(3, 111002); setParty(12, 111003)
    db.prepare("UPDATE players_parties SET character_id_1 = NULL, character_id_2 = NULL, character_id_3 = NULL WHERE player_id = ? AND slot = 5 AND category = 1").run(playerId)

    const choices = P.coopPartnerChoicesSync(playerId)
    check("the dashboard lists the save's parties", choices.parties.length >= 20 && choices.parties.some(p => p.partyId === 12), choices.parties.length)
    check("no picks at first", choices.picks.length === 0, choices.picks)
    check("an empty party can't be picked", P.setCoopPartnerPicksSync(playerId, [5, null]).ok === false)
    check("a party the save doesn't have can't be picked", P.setCoopPartnerPicksSync(playerId, [3000, null]).ok === false)
    check("the same party twice is refused", P.setCoopPartnerPicksSync(playerId, [2, 2]).ok === false)
    const saved = P.setCoopPartnerPicksSync(playerId, [12, 3])
    check("picks 12 and 3 are saved", saved.ok && JSON.stringify(saved.picks) === "[12,3]", saved)
    check("...and read back", JSON.stringify(P.getCoopPartnerPicksSync(playerId)) === "[12,3]", P.getCoopPartnerPicksSync(playerId))
    const partners = C.partnerParties(playerId, 1).map(p => p.partyId)
    check("a co-op room gets parties 12 and 3 as partners", JSON.stringify(partners) === "[12,3]", partners)
    const inUse = C.partnerParties(playerId, 12).map(p => p.partyId)
    check("playing with party 12: 3 first, then another party with units", inUse[0] === 3 && inUse.length === 2 && !inUse.includes(12), inUse)
    const cleared = P.setCoopPartnerPicksSync(playerId, [null, null])
    check("Clear removes the picks", cleared.ok && P.getCoopPartnerPicksSync(playerId).length === 0)
} catch (error) {
    console.error(error)
    failures++
} finally {
    try { getDatabase?.(0).close() } catch { }
    process.chdir(os.tmpdir())
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch (e) { console.log(`temp folder left: ${temp} (${e.code})`) }
}

console.log(failures === 0 ? "All co-op partner pick tests passed." : `${failures} co-op partner pick test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
