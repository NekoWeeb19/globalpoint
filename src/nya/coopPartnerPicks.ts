// Co-op partners picked on the dashboard (player page): up to two of the save's own parties that join co-op rooms as
// COM partners before any other (src/lib/coop.ts pickPartnerParties). Kept in the save's database, so they move with
// save export/import. A picked party that's empty, gone or in use is skipped and the usual order fills in.

import getDatabase, { Database } from "../data"
import { savedParties } from "./coop"

let tableReady = false
function db() {
    const database = getDatabase(Database.WDFP_DATA)
    if (!tableReady) {
        database.prepare(`CREATE TABLE IF NOT EXISTS players_coop_partner_picks (
            player_id INTEGER NOT NULL PRIMARY KEY,
            party_1 INTEGER,
            party_2 INTEGER,
            FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
        )`).run()
        tableReady = true
    }
    return database
}

/** The save's picked partner parties, in order (0-2 party numbers). */
export function getCoopPartnerPicksSync(playerId: number): number[] {
    const row = db().prepare("SELECT party_1, party_2 FROM players_coop_partner_picks WHERE player_id = ?").get(playerId) as { party_1: number | null, party_2: number | null } | undefined
    if (!row) return []
    return [row.party_1, row.party_2].filter((id): id is number => typeof id === "number")
}

export interface CoopPartnerChoice {
    partyId: number
    name: string
    /** How many main units it has (0 = can't be a partner). */
    units: number
}

/** The save's parties to choose from, and the current picks. */
export function coopPartnerChoicesSync(playerId: number): { parties: CoopPartnerChoice[], picks: number[] } {
    const parties = savedParties(playerId)
        .map(p => ({ partyId: p.partyId, name: p.name, units: p.characterIds.filter(id => id !== null && id !== undefined).length }))
        .sort((a, b) => a.partyId - b.partyId)
    return { parties, picks: getCoopPartnerPicksSync(playerId) }
}

/**
 * Saves the picks (null or missing = no pick for that slot). Refuses a party the save doesn't have, or one with no
 * units. Both empty clears the picks.
 */
export function setCoopPartnerPicksSync(playerId: number, picks: (number | null | undefined)[]): { ok: true, picks: number[] } | { ok: false, message: string } {
    const parties = new Map(savedParties(playerId).map(p => [p.partyId, p]))
    const chosen: number[] = []
    for (const pick of picks.slice(0, 2)) {
        if (pick === null || pick === undefined) continue
        const party = Number.isInteger(pick) ? parties.get(pick) : undefined
        if (party === undefined) return { ok: false, message: `This save has no party ${pick}.` }
        if (!party.characterIds.some(id => id !== null && id !== undefined)) return { ok: false, message: `Party ${pick} (${party.name || "no name"}) has no units.` }
        if (chosen.includes(pick)) return { ok: false, message: "Pick two different parties." }
        chosen.push(pick)
    }
    if (chosen.length === 0) db().prepare("DELETE FROM players_coop_partner_picks WHERE player_id = ?").run(playerId)
    else db().prepare(`INSERT INTO players_coop_partner_picks (player_id, party_1, party_2) VALUES (?, ?, ?)
        ON CONFLICT (player_id) DO UPDATE SET party_1 = excluded.party_1, party_2 = excluded.party_2`).run(playerId, chosen[0], chosen[1] ?? null)
    console.log(`[co-op] Player ${playerId}: partner parties ${chosen.length ? chosen.join(", ") : "cleared"}.`)
    return { ok: true, picks: chosen }
}
