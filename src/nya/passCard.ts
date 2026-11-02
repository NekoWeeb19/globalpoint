// The CN client's pass ("The Way of Practice"): pass missions (mission categories 6, 7 and 8, see
// src/lib/mission.ts) pay pass points into the pass they belong to; every level of points unlocks a
// free reward and a premium one. The premium track is open to everyone (the Chinese fork does the
// same: it was a paid upgrade). Data: assets/pass_card_cn.json (scripts/gen_cn_pass_card.cjs), reread
// when it changes (the CN schedule rebuilds it when a pass is moved on the Events tab).

import { readFileSync, statSync } from "fs"
import { cnGeneratedFile } from "../lib/cnGenerated"
import getDatabase, { Database } from "../data"
import type { MissionReward } from "../lib/mission"

export interface PassDefinition { dev: string, pointCap: number, levelPoints: number, start: string | null, end: string | null, close: string | null }
export interface PassRewardDefinition { pass: number, level: number, free: MissionReward | null, premium: MissionReward | null }
/** A pass point pack sold for beads in the CN special pack shop (shop type 3). */
export interface PassPointPack { name: string, beads: number, points: number, limit: number | null }
interface PassData { passes: Record<string, PassDefinition>, rewards: Record<string, PassRewardDefinition>, pointPacks?: Record<string, PassPointPack> }

const dataFile = () => cnGeneratedFile("pass_card_cn.json")
let cache: { mtimeMs: number, data: PassData } | null = null
function passData(): PassData {
    try {
        const file = dataFile()
        const mtimeMs = statSync(file).mtimeMs
        if (cache === null || cache.mtimeMs !== mtimeMs) cache = { mtimeMs, data: JSON.parse(readFileSync(file, "utf8")) as PassData }
        return cache.data
    } catch {
        return { passes: {}, rewards: {} }
    }
}

export const getPassDefinition = (passId: number): PassDefinition | null => passData().passes[String(passId)] ?? null
export const getPassRewardDefinition = (rewardId: number): PassRewardDefinition | null => passData().rewards[String(rewardId)] ?? null
export const getPassPointPack = (shopItemId: number): PassPointPack | null => passData().pointPacks?.[String(shopItemId)] ?? null

/** The pass that is open at `nowMs` (its start to end, UTC), or null. The latest one wins if several are. */
export function openPassIdSync(nowMs: number): number | null {
    const at = (v: string | null) => v === null ? NaN : Date.parse(v.replace(" ", "T") + "Z")
    let best: { id: number, start: number } | null = null
    for (const [id, pass] of Object.entries(passData().passes)) {
        const start = at(pass.start), end = at(pass.end)
        if (!(start <= nowMs && nowMs < end)) continue
        if (best === null || start > best.start) best = { id: Number(id), start }
    }
    return best?.id ?? null
}

let tablesReady = false
function db() {
    const database = getDatabase(Database.WDFP_DATA)
    if (!tablesReady) {
        database.prepare(`CREATE TABLE IF NOT EXISTS players_pass_cards (
            player_id INTEGER NOT NULL,
            pass_id INTEGER NOT NULL,
            point INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (player_id, pass_id),
            FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
        )`).run()
        database.prepare(`CREATE TABLE IF NOT EXISTS players_pass_card_rewards (
            player_id INTEGER NOT NULL,
            pass_id INTEGER NOT NULL,
            reward_id INTEGER NOT NULL,
            received_1 INTEGER NOT NULL DEFAULT 0,
            received_2 INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (player_id, reward_id),
            FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
        )`).run()
        tablesReady = true
    }
    return database
}

export function getPassPointSync(playerId: number, passId: number): number {
    const row = db().prepare("SELECT point FROM players_pass_cards WHERE player_id = ? AND pass_id = ?").get(playerId, passId) as { point: number } | undefined
    return row?.point ?? 0
}

/** Adds pass points (up to the pass's point cap). Returns the new total. */
export function addPassPointSync(playerId: number, passId: number, amount: number): number {
    const cap = getPassDefinition(passId)?.pointCap ?? Number.MAX_SAFE_INTEGER
    const point = Math.min(getPassPointSync(playerId, passId) + Math.max(0, Math.floor(amount)), cap)
    db().prepare(`INSERT INTO players_pass_cards (player_id, pass_id, point) VALUES (?, ?, ?)
        ON CONFLICT (player_id, pass_id) DO UPDATE SET point = excluded.point`).run(playerId, passId, point)
    return point
}

export interface PassRewardRecord { reward_id: number, is_received_1: number, is_received_2: number }

/** The rewards of a pass the player has taken (all_received_record). */
export function getPassRewardRecordsSync(playerId: number, passId: number): PassRewardRecord[] {
    const rows = db().prepare("SELECT reward_id, received_1, received_2 FROM players_pass_card_rewards WHERE player_id = ? AND pass_id = ? ORDER BY reward_id")
        .all(playerId, passId) as { reward_id: number, received_1: number, received_2: number }[]
    return rows.map(r => ({ reward_id: r.reward_id, is_received_1: r.received_1, is_received_2: r.received_2 }))
}

export function markPassRewardReceivedSync(playerId: number, passId: number, rewardId: number, free: boolean, premium: boolean) {
    db().prepare(`INSERT INTO players_pass_card_rewards (player_id, pass_id, reward_id, received_1, received_2) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (player_id, reward_id) DO UPDATE SET received_1 = MAX(received_1, excluded.received_1), received_2 = MAX(received_2, excluded.received_2)`)
        .run(playerId, passId, rewardId, free ? 1 : 0, premium ? 1 : 0)
}
