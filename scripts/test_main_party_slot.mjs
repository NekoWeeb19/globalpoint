// Player log 2026-11-21 (companion 0.8.94): F1009 in PartyLogic.get_mainCharacters at every home start. The CN game
// starts quests with a guest unit (main story 11-10, 12-4, world story 100411 quest 11, ...) with party 3000; the
// battle start saved that as the main party (players.party_slot), and /load sent a main party the save doesn't have.
// Now the battle start keeps the main party unless the party exists, and /load sends an existing party.
//
//   npx tsc
//   node scripts/test_main_party_slot.mjs [<a save's wdfp_data.db to check too>]
import fs from "fs"
import os from "os"
import path from "path"

const out = new URL("../out/", import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "main-party-slot-"))
const playerSave = process.argv[2]
if (playerSave) {
    // a copy of a real save (the player's): the server opens <working folder>/.database/wdfp_data.db
    fs.mkdirSync(path.join(temp, ".database"))
    fs.copyFileSync(playerSave, path.join(temp, ".database", "wdfp_data.db"))
    fs.writeFileSync(path.join(temp, ".database", "wdfp_data.db.version"), "2")
}
process.chdir(temp)

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

try {
    const getDatabase = (await import(new URL("data/index.js", out))).default.default
    const W = await import(new URL("data/wdfpData.js", out))
    const U = await import(new URL("data/utils.js", out))
    const db = getDatabase(0 /* Database.WDFP_DATA */)

    const groups = { "1": { list: { "1": {}, "2": {} } }, "2": { list: { "11": {} } } }
    check("an existing main party is kept", U.existingPartySlot(11, groups) === 11)
    check("party 3000 (guest quests) becomes the first party", U.existingPartySlot(3000, groups) === 1)
    check("no parties at all: 1", U.existingPartySlot(3000, {}) === 1)

    let playerId
    if (playerSave) {
        playerId = db.prepare("SELECT id FROM players ORDER BY id LIMIT 1").get().id
    } else {
        const now = new Date().toISOString()
        const accountId = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
            VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(now, now, now).lastInsertRowid)
        playerId = W.insertDefaultPlayerSync(accountId).id
        db.prepare("UPDATE players SET party_slot = 3000 WHERE id = ?").run(playerId)
    }
    const saved = W.getPlayerSync(playerId).partySlot
    const data = U.getClientSerializedData(playerId, { viewerId: 1 })
    const sent = data.user_info.party_slot
    const parties = Object.values(data.user_party_group_list).flatMap(group => Object.keys(group.list).map(Number))
    console.log(`saved main party ${saved}, sent ${sent}, the save has ${parties.length} parties`)
    check("/load sends a main party the save has", parties.includes(sent), { saved, sent })
    if (!parties.includes(saved)) check("a missing main party is sent as the first party", sent === Math.min(...parties), sent)
} catch (error) {
    console.error(error)
    failures++
} finally {
    process.chdir(os.tmpdir())
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { }
}

console.log(failures === 0 ? "All main party tests passed." : `${failures} main party test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
