// Tests taking a unit out of a save (src/nya/removeCharacter.ts, dashboard: Players > a player > Remove a unit)
// on a throwaway save in a temp folder: the unit is put everywhere a save can name it, then removed.
//
//   npx tsc
//   node scripts/test_remove_character.mjs
import fs from "fs"
import os from "os"
import path from "path"

const out = new URL("../out/", import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "remove-unit-"))
process.chdir(temp) // the save goes in <working folder>/.database

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

const dataModule = (await import(new URL("data/index.js", out))).default
const getDatabase = dataModule.default
const { insertDefaultPlayerSync } = await import(new URL("data/wdfpData.js", out))
const { removeCharacterFromSaveSync } = await import(new URL("nya/removeCharacter.js", out))
const { SendMail, MAIL_TYPE } = await import(new URL("nya/mail.js", out))
const db = getDatabase(0 /* Database.WDFP_DATA */)

const now = new Date().toISOString()
const accountId = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
    VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(now, now, now).lastInsertRowid)
const playerId = insertDefaultPlayerSync(accountId).id
const UNIT = 111907, OTHER = 111001

const giveUnit = id => db.prepare(`INSERT OR IGNORE INTO players_characters (id, entry_count, evolution_level, over_limit_step, protection, join_time, update_time, exp, stack, mana_board_index, player_id)
    VALUES (?, 1, 0, 0, 0, ?, ?, 0, 0, 1, ?)`).run(id, now, now, playerId)
giveUnit(1); giveUnit(OTHER); giveUnit(UNIT)
db.prepare(`INSERT INTO players_characters_mana_nodes (value, character_id, player_id) VALUES (223814201, ?, ?)`).run(UNIT, playerId)
db.prepare(`INSERT INTO players_characters_bond_tokens (mana_board_index, status, player_id, character_id) VALUES (1, 1, ?, ?)`).run(playerId, UNIT)
db.prepare(`UPDATE players SET leader_character_id = ? WHERE id = ?`).run(UNIT, playerId)
db.prepare(`INSERT OR IGNORE INTO players_party_groups (id, color_id, player_id, category) VALUES (90, 0, ?, 0)`).run(playerId)
db.prepare(`INSERT INTO players_parties (slot, name, character_id_1, character_id_2, unison_character_3, edited, player_id, group_id, category) VALUES (1, 'a', ?, ?, ?, 1, ?, 90, 0)`)
    .run(UNIT, OTHER, UNIT, playerId)
db.prepare(`INSERT INTO players_parties (slot, name, character_id_1, edited, player_id, group_id, category) VALUES (2, 'only it', ?, 1, ?, 90, 0)`).run(UNIT, playerId)
db.prepare(`INSERT INTO players_profile (favorite_party, player_id) VALUES (?, ?)`)
    .run(JSON.stringify({ name: "f", characterIds: [UNIT, null, null], unisonCharacterIds: [null, OTHER, null] }), playerId)
db.prepare(`INSERT INTO players_score_attack_history (event_id, record, player_id) VALUES (1, ?, ?), (1, ?, ?)`)
    .run(JSON.stringify({ party: { character_ids: [UNIT, OTHER] }, score: 100 }), playerId, JSON.stringify({ party: { character_ids: [OTHER] }, score: UNIT }), playerId)
SendMail(playerId, { type: MAIL_TYPE.CHARACTER, type_id: UNIT, number: 1 })
SendMail(playerId, { type: MAIL_TYPE.CHARACTER, type_id: OTHER, number: 1 })

const result = removeCharacterFromSaveSync(playerId, UNIT)
const count = (sql, ...args) => db.prepare(sql).get(...args).n
check("the unit is gone", count(`SELECT COUNT(*) n FROM players_characters WHERE player_id = ? AND id = ?`, playerId, UNIT) === 0)
check("its Mana Board and amity rows are gone", count(`SELECT COUNT(*) n FROM players_characters_mana_nodes WHERE character_id = ?`, UNIT) === 0
    && count(`SELECT COUNT(*) n FROM players_characters_bond_tokens WHERE character_id = ?`, UNIT) === 0)
check("other units stay", count(`SELECT COUNT(*) n FROM players_characters WHERE player_id = ? AND id IN (1, ?)`, playerId, OTHER) === 2)
check("the home unit becomes the hero", result.newLeader === 1 && db.prepare(`SELECT leader_character_id l FROM players WHERE id = ?`).get(playerId).l === 1)
const party = slot => db.prepare(`SELECT * FROM players_parties WHERE player_id = ? AND group_id = 90 AND slot = ?`).get(playerId, slot)
check("its party slots are emptied, others kept", party(1).character_id_1 === null && party(1).character_id_2 === OTHER && party(1).unison_character_3 === null)
check("a party left with no main unit gets the hero", party(2).character_id_1 === 1)
check("no party names it any more", count(`SELECT COUNT(*) n FROM players_parties WHERE ? IN (character_id_1, character_id_2, character_id_3, unison_character_1, unison_character_2, unison_character_3)`, UNIT) === 0)
const favorite = JSON.parse(db.prepare(`SELECT favorite_party f FROM players_profile WHERE player_id = ?`).get(playerId).f)
check("the Favorite Units party drops it", JSON.stringify(favorite.characterIds) === JSON.stringify([1, null, null]) && favorite.unisonCharacterIds[1] === OTHER, favorite)
const records = db.prepare(`SELECT record FROM players_score_attack_history WHERE player_id = ?`).all(playerId).map(r => JSON.parse(r.record))
check("Score Attack records that used it go, others stay (a score equal to its id isn't a unit)", records.length === 1 && records[0].score === UNIT, records)
check("its unclaimed mail goes, others stay", result.mails === 1)
check("a unit the player doesn't have: nothing happens", removeCharacterFromSaveSync(playerId, UNIT) === null)

process.chdir(os.tmpdir())
try { db.close() } catch { }
try { fs.rmSync(temp, { recursive: true, force: true }) } catch { } // Windows may hold the file a moment longer
console.log(failures === 0 ? "\nAll remove-unit tests passed." : `\n${failures} remove-unit test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
