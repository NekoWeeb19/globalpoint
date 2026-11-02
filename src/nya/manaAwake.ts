// CN mana node awakening (the "Awake" board): see scripts/gen_cn_mana_awake.cjs for how it works.
// A unit's awake level unlocks when its "complete all" awake mission is done; then each board-1
// node can be awakened to that level (character/awake_mana_node), paying the cost for the unit's
// rarity and the node's slot and pedestal. Node awake levels are saved here; the CN client gets them
// in user_character_mana_node_list ({ multiplied_id, awake_level }) and the unlocked levels in each
// unit's mana_board_awake ({ board: level }).

import getDatabase, { Database } from "../data"
import { getPlayerActiveMissionsSync, getPlayerCharactersManaNodesSync, getPlayerItemSync, getPlayerSync, updatePlayerItemSync, updatePlayerSync } from "../data/wdfpData"
import { manaAwakeData } from "./activeMissionData"
import { claimPlayerActiveMissionsSync } from "./activeMission"

let tableReady = false
function db() {
    const database = getDatabase(Database.WDFP_DATA)
    if (!tableReady) {
        database.prepare(`CREATE TABLE IF NOT EXISTS players_mana_node_awake (
            player_id INTEGER NOT NULL,
            character_id INTEGER NOT NULL,
            node INTEGER NOT NULL,
            awake_level INTEGER NOT NULL,
            PRIMARY KEY (player_id, character_id, node),
            FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
        )`).run()
        tableReady = true
    }
    return database
}

/** Each unit's awakened nodes: unit -> node -> awake level. */
export function nodeAwakeLevelsSync(playerId: number): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {}
    for (const row of db().prepare("SELECT character_id, node, awake_level FROM players_mana_node_awake WHERE player_id = ?").all(playerId) as { character_id: number, node: number, awake_level: number }[])
        (out[String(row.character_id)] ??= {})[String(row.node)] = row.awake_level
    return out
}

/** The awake level each unit has unlocked per board, from its finished "complete all" awake missions. */
export function awakeUnlocksSync(playerId: number): Record<string, Record<string, number>> {
    const data = manaAwakeData()
    const out: Record<string, Record<string, number>> = {}
    if (data === null) return out
    const saved = getPlayerActiveMissionsSync(playerId)
    for (const [id, mission] of Object.entries(data.missions)) {
        if (!mission.unlock) continue
        const needed = Math.max(0, ...Object.values(mission.requirements))
        if ((saved[id]?.progress ?? 0) < needed || needed <= 0) continue
        const levels = out[String(mission.unlock.character)] ??= {}
        levels[String(mission.unlock.board)] = Math.max(levels[String(mission.unlock.board)] ?? 0, mission.unlock.level)
    }
    return out
}

/** mana_board_awake for each unit: the unlocked level, or the highest awakened node if higher. */
export function manaBoardAwakeSync(playerId: number): Record<string, Record<string, number>> {
    const out = awakeUnlocksSync(playerId)
    for (const [unit, nodes] of Object.entries(nodeAwakeLevelsSync(playerId))) {
        const highest = Math.max(0, ...Object.values(nodes))
        if (highest <= 0) continue
        const levels = out[unit] ??= {}
        levels["1"] = Math.max(levels["1"] ?? 0, highest)
    }
    return out
}

/** A unit's learned nodes in the CN client's form, with their awake levels. */
export function cnManaNodeList(nodes: number[], awake: Record<string, number> | undefined) {
    return nodes.map(node => typeof node === "number" ? { multiplied_id: node, awake_level: awake?.[String(node)] ?? 0 } : node)
}

export type AwakeResult = { ok: true, data: Record<string, unknown> } | { ok: false, message: string }

/** Awakens board-1 nodes of a unit to targetLevel, paying for each node not already there. */
export function awakeManaNodesSync(playerId: number, characterId: number, nodeIds: number[], targetLevel: number): AwakeResult {
    const data = manaAwakeData()
    if (data === null) return { ok: false, message: "No awake data." }
    const unit = data.units[String(characterId)]
    const board = data.nodes[String(characterId)]
    if (!unit || !board) return { ok: false, message: "This unit can't be awakened." }
    const unlocked = awakeUnlocksSync(playerId)[String(characterId)]?.["1"] ?? 0
    if (!Number.isSafeInteger(targetLevel) || targetLevel <= 0 || targetLevel > unlocked) return { ok: false, message: "That awake level isn't unlocked." }

    const learned = new Set(getPlayerCharactersManaNodesSync(playerId)[String(characterId)] ?? [])
    if (!Object.keys(board).every(node => learned.has(Number(node)))) return { ok: false, message: "Board 1 isn't complete." }
    const current = nodeAwakeLevelsSync(playerId)[String(characterId)] ?? {}

    // costs of the nodes that aren't at the target level yet
    const items: Record<string, number> = {}
    let mana = 0
    const todo: number[] = []
    for (const node of nodeIds) {
        const info = board[String(node)]
        if (!info) return { ok: false, message: `Node ${node} isn't on board 1.` }
        if ((current[String(node)] ?? 0) >= targetLevel) continue
        const cost = data.costs[String(unit.rarity)]?.[String(info.slot)]?.[String(info.pedestal)]
        if (!cost) return { ok: false, message: `No awake cost for node ${node}.` }
        for (const [id, count] of Object.entries(cost.items)) items[id] = (items[id] ?? 0) + count
        mana += cost.mana
        todo.push(node)
    }
    const player = getPlayerSync(playerId)
    if (player === null) return { ok: false, message: "No player." }
    if (player.freeMana + player.paidMana < mana) return { ok: false, message: "Not enough mana." }
    const itemList: Record<string, number> = {}
    for (const [id, count] of Object.entries(items)) {
        const left = (getPlayerItemSync(playerId, Number(id)) ?? 0) - count
        if (left < 0) return { ok: false, message: `Not enough of item ${id}.` }
        itemList[id] = left
    }

    db().transaction(() => {
        for (const [id, left] of Object.entries(itemList)) updatePlayerItemSync(playerId, Number(id), left)
        const fromFree = Math.min(player.freeMana, mana)
        updatePlayerSync({ id: playerId, freeMana: player.freeMana - fromFree, paidMana: player.paidMana - (mana - fromFree) })
        const upsert = db().prepare(`INSERT INTO players_mana_node_awake (player_id, character_id, node, awake_level) VALUES (?, ?, ?, ?)
            ON CONFLICT (player_id, character_id, node) DO UPDATE SET awake_level = MAX(awake_level, excluded.awake_level)`)
        for (const node of todo) upsert.run(playerId, characterId, node, targetLevel)
    })()

    const after = getPlayerSync(playerId)!
    const awake = nodeAwakeLevelsSync(playerId)[String(characterId)] ?? {}
    return {
        ok: true,
        data: {
            user_info: { free_mana: after.freeMana, paid_mana: after.paidMana },
            item_list: itemList,
            user_character_mana_node_list: { [String(characterId)]: nodeIds.map(node => ({ multiplied_id: node, awake_level: awake[String(node)] ?? 0 })) },
            mana_board_awake: { [String(characterId)]: manaBoardAwakeSync(playerId)[String(characterId)] ?? {} },
        },
    }
}

/** Pays awake mission stages that were reached but never paid (stages unlocked before rewards were automatic). */
export function payPendingAwakeStagesSync(playerId: number) {
    const missions = manaAwakeData()?.missions
    if (!missions) return
    const pending = Object.entries(getPlayerActiveMissionsSync(playerId))
        .filter(([id, mission]) => missions[id] !== undefined && !Array.isArray(mission.stages))
        .map(([id, mission]) => ({ mission_id: Number(id), stages: Object.entries(mission.stages as Record<string, boolean>).filter(([, received]) => !received).map(([stage]) => Number(stage)) }))
        .filter(request => request.stages.length > 0)
    if (pending.length > 0) claimPlayerActiveMissionsSync(playerId, pending)
}

/**
 * The Mission screen's awake missions (category 9) of one unit: { mission_category, mission_id,
 * progress_value, stage }, stage being the first stage not reached yet (the last once all are).
 */
export function awakeMissionProgressListSync(playerId: number, characterId: number) {
    const missions = manaAwakeData()?.missions ?? {}
    const saved = getPlayerActiveMissionsSync(playerId)
    const prefix = String(characterId)
    return Object.entries(missions)
        .filter(([id, mission]) => id.length === prefix.length + 1 && id.startsWith(prefix))
        .map(([id, mission]) => {
            const progress = saved[id]?.progress ?? 0
            const stages = Object.entries(mission.requirements).map(([stage, target]) => ({ stage: Number(stage), target })).sort((a, b) => a.stage - b.stage)
            const current = stages.find(stage => progress < stage.target)?.stage ?? stages[stages.length - 1]?.stage ?? 1
            return { mission_category: 9, mission_id: Number(id), progress_value: progress, stage: current }
        })
}
