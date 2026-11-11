// Players tab tools for a save (the dashboard's player page): clone, delete, reset the account, reset the parties,
// clear the mailbox.
//
// A save is one row in `players` and rows in every table with a player_id column, all deleted with it (ON DELETE
// CASCADE). Cloning copies every such table, so it also keeps data the save file (Download Save) leaves out
// (profile favorites, login bonus progress, pass cards, ...). The copy gets a new account of its own, never tied to
// a phone (its idp_id is unused), so the game plays it once it's picked under Players > Active account.

import getDatabase, { Database } from "../data"
import { PartyCategory } from "../data/types"
import { deleteAccountSync, getDefaultPlayerPartyGroupsSync, insertDefaultPlayerSync, insertPlayerPartyGroupListSync } from "../data/wdfpData"
import { cnLinkedAccountId } from "../lib/cnClient"
import { chosenAccount } from "./activeAccounts"
import { clearSessionMails } from "./mail"
import { clearScheduledMailsFor, copyScheduledMailState, forgetScheduledMailState } from "./mailSchedule"

const db = () => getDatabase(Database.WDFP_DATA)

/** Tables whose only primary key is an auto-numbered id: the copy's rows get new ids. */
const OWN_ID_TABLES = new Set(["players_receive_history", "players_score_attack_history"])

function playerTables(): { name: string, columns: string[] }[] {
    const tables = db().prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
    const out: { name: string, columns: string[] }[] = []
    for (const { name } of tables) {
        if (name === "players") continue
        const columns = (db().prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map(c => c.name)
        if (columns.includes("player_id")) out.push({ name, columns })
    }
    return out
}

function playerRow(playerId: number): Record<string, unknown> | null {
    return (db().prepare(`SELECT * FROM players WHERE id = ?`).get(playerId) as Record<string, unknown> | undefined) ?? null
}

/** The account ids the apps play on (Players > Active account, or .env). */
function activeAccountIds(): Set<number> {
    const ids = new Set<number>()
    const cn = cnLinkedAccountId()
    if (cn !== null) ids.add(cn)
    const global = chosenAccount("global")
    if (typeof global === "number") ids.add(global)
    return ids
}

/** Copies a save into a new account. Returns the copy's player and account ids. */
export function cloneSaveSync(playerId: number): { playerId: number, accountId: number, name: string } {
    const source = playerRow(playerId)
    if (source === null) throw new Error(`There's no player ${playerId}.`)
    const tables = playerTables()
    const result = db().transaction(() => {
        // rows that point at each other (stages at missions, parties at groups, ...) are checked at the end
        db().pragma("defer_foreign_keys = ON")
        const account = db().prepare(`SELECT * FROM accounts WHERE id = ?`).get(source.account_id) as Record<string, unknown> | undefined
        const now = new Date().toISOString()
        const accountId = Number(db().prepare(`
            INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(account?.app_id ?? "", now, "dashboard copy", "dashboard", `dashboard-copy:${playerId}:${Date.now()}`, now, now, account?.status ?? 0).lastInsertRowid)

        const columns = Object.keys(source).filter(c => c !== "id")
        const name = String(source.name ?? "").slice(0, 8).trim() + " (copy)"
        const values = columns.map(c => c === "account_id" ? accountId : c === "name" ? name : source[c])
        const newId = Number(db().prepare(`INSERT INTO players (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...values).lastInsertRowid)

        for (const table of tables) {
            const cols = table.columns.filter(c => !(c === "id" && OWN_ID_TABLES.has(table.name)))
            const select = cols.map(c => c === "player_id" ? "?" : `"${c}"`).join(", ")
            db().prepare(`INSERT INTO "${table.name}" (${cols.map(c => `"${c}"`).join(", ")}) SELECT ${select} FROM "${table.name}" WHERE player_id = ?`)
                .run(newId, playerId)
        }
        return { playerId: newId, accountId, name }
    })()
    copyScheduledMailState(playerId, result.playerId)
    console.log(`[players] Player ${playerId} copied to player ${result.playerId} (account ${result.accountId}).`)
    return result
}

/** Deletes a save (and its account when that has no other save). The save an app plays on can't be deleted. */
export function deleteSaveSync(playerId: number): { accountDeleted: boolean } {
    const source = playerRow(playerId)
    if (source === null) throw new Error(`There's no player ${playerId}.`)
    const accountId = Number(source.account_id)
    if (activeAccountIds().has(accountId)) {
        throw new Error("This is the save the game plays on (Players > Active account). Pick another save there first.")
    }
    const others = (db().prepare(`SELECT COUNT(*) AS n FROM players WHERE account_id = ? AND id != ?`).get(accountId, playerId) as { n: number }).n
    if (others === 0) deleteAccountSync(accountId)
    else db().prepare(`DELETE FROM players WHERE id = ?`).run(playerId)
    forgetScheduledMailState(playerId)
    clearSessionMails(playerId)
    console.log(`[players] Player ${playerId} deleted${others === 0 ? ` with account ${accountId}` : ""}.`)
    return { accountDeleted: others === 0 }
}

/**
 * Starts a save over: the player is deleted and a brand-new one (tutorial first, like a new install) is made on the
 * same account, so the phone, Players > Active account and the account's sign-in stay as they are. The new player
 * has a new id. Returns it.
 */
export function resetSaveSync(playerId: number): { playerId: number } {
    const source = playerRow(playerId)
    if (source === null) throw new Error(`There's no player ${playerId}.`)
    const accountId = Number(source.account_id)
    const newId = db().transaction(() => {
        db().prepare(`DELETE FROM players WHERE id = ?`).run(playerId)
        return insertDefaultPlayerSync(accountId).id
    })()
    forgetScheduledMailState(playerId)
    clearSessionMails(playerId)
    console.log(`[players] Player ${playerId} reset: account ${accountId} starts over as player ${newId}.`)
    return { playerId: newId }
}

/** Puts a save's normal parties back to the game's default (the hero, or the save's leader, in every party). */
export function resetPartiesSync(playerId: number): number {
    const source = playerRow(playerId)
    if (source === null) throw new Error(`There's no player ${playerId}.`)
    const owns = (id: number) => db().prepare(`SELECT 1 FROM players_characters WHERE player_id = ? AND id = ?`).get(playerId, id) !== undefined
    const leader = Number(source.leader_character_id)
    const first = owns(1) ? 1 : owns(leader) ? leader
        : (db().prepare(`SELECT id FROM players_characters WHERE player_id = ? ORDER BY id LIMIT 1`).get(playerId) as { id: number } | undefined)?.id ?? 1
    const groups = getDefaultPlayerPartyGroupsSync(PartyCategory.NORMAL, [first, null, null])
    db().transaction(() => {
        db().prepare(`DELETE FROM players_party_groups WHERE player_id = ? AND category = ?`).run(playerId, PartyCategory.NORMAL)
        insertPlayerPartyGroupListSync(playerId, groups)
        db().prepare(`UPDATE players SET party_slot = 1 WHERE id = ?`).run(playerId)
    })()
    console.log(`[players] Player ${playerId}: parties reset to the default (unit ${first}).`)
    return first
}

/** Drops a save's unclaimed mails: those sent with Give this session and the delivered scheduled ones. The
 *  never-ending mails come back unless they're switched off on the Game settings tab. */
export function clearMailboxSync(playerId: number): number {
    if (playerRow(playerId) === null) throw new Error(`There's no player ${playerId}.`)
    const count = clearSessionMails(playerId) + clearScheduledMailsFor(playerId)
    console.log(`[players] Player ${playerId}: ${count} unclaimed mail(s) cleared.`)
    return count
}
