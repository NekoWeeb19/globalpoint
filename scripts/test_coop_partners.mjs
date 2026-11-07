// Tests the co-op COM partner fallback (src/nya/coop.ts partnerParties): a room always gets two partners, even when
// the player's other saved parties have no units and the room's party number doesn't match a saved party (a player's
// rooms got no partners, so the battle never started).
//
// Also: parties outside group 1 load as partners (they're saved under the game's party number, 11-20 for group 2).
// Runs on a copy of .database (or of another .database folder, e.g. a player's exported save) in a temp folder; the
// originals aren't touched. Compile first:
//   npx tsc
//   node scripts/test_coop_partners.mjs [playerId] [path/to/.database]
import { cpSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { createRequire } from "module"

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..")
const work = mkdtempSync(path.join(tmpdir(), "coop-partners-"))
cpSync(process.argv[3] ? path.resolve(process.argv[3]) : path.join(repo, ".database"), path.join(work, ".database"), { recursive: true })
process.chdir(work)
const require = createRequire(path.join(repo, "package.json"))
const { partnerParties, savedParties } = require(path.join(repo, "out/nya/coop.js"))
const getDatabase = require(path.join(repo, "out/data/index.js")).default
const Database = require("better-sqlite3")

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const describe = partners => partners.map(p => p.partyId).join(", ")
const hasUnits = partners => partners.every(p => p.party.characters.some(c => c !== null))

try {
    const db = new Database(path.join(work, ".database", "wdfp_data.db"))
    const playerId = Number(process.argv[2]) || db.prepare("SELECT player_id FROM players_parties GROUP BY player_id ORDER BY COUNT(*) DESC LIMIT 1").get().player_id
    const current = savedParties(playerId).find(p => p.characterIds.some(id => id !== null))?.partyId ?? 1
    console.log(`player ${playerId}, party in use ${current}`)

    const normal = partnerParties(playerId, current)
    check("normal: two partners with units", normal.length === 2 && hasUnits(normal), describe(normal))

    // a party outside group 1 is the strongest: it loads as a partner under its own number (group 2's first is 11)
    db.prepare("UPDATE players_parties SET character_id_1 = NULL, character_id_2 = NULL, character_id_3 = NULL WHERE player_id = ? AND category = 1 AND slot != ?").run(playerId, current)
    db.prepare("UPDATE players_parties SET character_id_1 = (SELECT id FROM players_characters WHERE player_id = ? ORDER BY exp DESC LIMIT 1), character_id_2 = (SELECT id FROM players_characters WHERE player_id = ? ORDER BY exp DESC LIMIT 1 OFFSET 1), character_id_3 = (SELECT id FROM players_characters WHERE player_id = ? ORDER BY exp DESC LIMIT 1 OFFSET 2) WHERE player_id = ? AND group_id = 2 AND slot = 11 AND category = 1").run(playerId, playerId, playerId, playerId)
    const group2 = partnerParties(playerId, current)
    check("group 2's first party (11) loads as a partner", group2.some(p => p.partyId === 11) && hasUnits(group2), describe(group2))

    // the player's report: no other party has units, and the room's party number isn't a saved party
    db.prepare("UPDATE players_parties SET character_id_1 = NULL, character_id_2 = NULL, character_id_3 = NULL WHERE player_id = ?").run(playerId)
    const empty = partnerParties(playerId, 999)
    check("no usable party, unknown party number: still two partners", empty.length === 2 && hasUnits(empty), describe(empty))
    check("...made from the strongest units (party 0)", empty.every(p => p.partyId === 0), describe(empty))

    // one other party with units: it's used, and the second slot is filled too
    db.prepare("UPDATE players_parties SET character_id_1 = (SELECT id FROM players_characters WHERE player_id = ? ORDER BY exp DESC LIMIT 1) WHERE player_id = ? AND group_id = 1 AND slot = 2 AND category = 1").run(playerId, playerId)
    const one = partnerParties(playerId, 999)
    check("one usable party: two partners, that party first", one.length === 2 && one[0].partyId === 2 && hasUnits(one), describe(one))
    db.close()
} finally {
    getDatabase(0).close() // the server's own handle on the copy (Database.WDFP_DATA), so the copy can be deleted
    process.chdir(repo)
    rmSync(work, { recursive: true, force: true })
}
console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
