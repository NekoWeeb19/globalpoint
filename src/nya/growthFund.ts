// The CN client's Growth Fund (成长基金): five funds the player bought once (Light's Piggy Bank in
// three rank ranges, the Main Quest Fund, the Hard Quest Fund); each pays a reward when the player
// reaches a rank or clears a chapter. Here every fund counts as bought (like the pass's premium
// track), so the rewards only need the goal reached.
//
// Data: master/growth_fund/growth_fund (CN), read once into assets/growth_fund_cn.json by
// scripts/gen_cn_growth_fund.cjs. Row columns (the CN client's GrowthFundValues): 0 bonus id,
// 4 kind (0 rank in col 5, 1 main chapter in col 6, 2 hard chapter in col 7), 8..10 and 11..13 two
// rewards (0 beads, 1 item id + count), 14 paid beads, 15 free beads.

import { readFileSync, statSync } from "fs"
import path from "path"
import getDatabase, { Database } from "../data"
import type { MissionReward } from "../lib/mission"

export interface FundBonus {
    kind: 0 | 1 | 2
    goal: number
    rewards: MissionReward[]
}

const DATA_FILE = path.join(__dirname, "..", "..", "assets", "growth_fund_cn.json")
let cache: { mtimeMs: number, data: Record<string, FundBonus> } | null = null
export function fundBonuses(): Record<string, FundBonus> {
    try {
        const mtimeMs = statSync(DATA_FILE).mtimeMs
        if (cache === null || cache.mtimeMs !== mtimeMs) cache = { mtimeMs, data: JSON.parse(readFileSync(DATA_FILE, "utf8")) }
        return cache.data
    } catch {
        return {}
    }
}

let tableReady = false
function db() {
    const database = getDatabase(Database.WDFP_DATA)
    if (!tableReady) {
        database.prepare(`CREATE TABLE IF NOT EXISTS players_growth_fund (
            player_id INTEGER NOT NULL,
            bonus_id INTEGER NOT NULL,
            PRIMARY KEY (player_id, bonus_id),
            FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
        )`).run()
        tableReady = true
    }
    return database
}

/** The fund rewards the player has taken (fund_receive_list). */
export function getFundReceiveListSync(playerId: number): number[] {
    return (db().prepare("SELECT bonus_id FROM players_growth_fund WHERE player_id = ? ORDER BY bonus_id").all(playerId) as { bonus_id: number }[]).map(r => r.bonus_id)
}

export function markFundReceivedSync(playerId: number, bonusId: number) {
    db().prepare("INSERT OR IGNORE INTO players_growth_fund (player_id, bonus_id) VALUES (?, ?)").run(playerId, bonusId)
}
