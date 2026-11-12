// Tests the Grand Gauntlet (rush event) folders through event/rush/* and single_battle_quest/finish
// (src/routes/api/rushEvent.ts, src/routes/api/singleBattleQuest.ts): a won battle uses up its team, a lost one
// doesn't, a folder is cleared by its own last round (Godly has 3 rounds in most events), and a cleared folder leaves
// no team behind, so the next run starts again at boss 1 (a leftover team made the game start it at boss 2).
//
//   npx tsc
//   node scripts/test_rush_event.mjs
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"

const out = new URL("../out/", import.meta.url)
const require = createRequire(import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rush-event-"))
process.chdir(temp) // the save goes in <working folder>/.database

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

try {
    const getDatabase = (await import(new URL("data/index.js", out))).default.default
    const W = await import(new URL("data/wdfpData.js", out))
    const A = await import(new URL("lib/assets.js", out))
    const rushRoutes = (await import(new URL("routes/api/rushEvent.js", out))).default
    const questRoutes = (await import(new URL("routes/api/singleBattleQuest.js", out))).default
    const fastify = require("fastify")()
    // the real server sends msgpack (its own serializer); JSON here
    fastify.addHook("onSend", async (request, reply, payload) => payload && typeof payload === "object" && !Buffer.isBuffer(payload) ? JSON.stringify(payload) : payload)
    await fastify.register(rushRoutes.default ?? rushRoutes, { prefix: "/rush" })
    await fastify.register(questRoutes.default ?? questRoutes, { prefix: "/quest" })
    await fastify.ready()
    const db = getDatabase(0 /* Database.WDFP_DATA */)

    const now = new Date().toISOString()
    const accountId = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
        VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(now, now, now).lastInsertRowid)
    const playerId = W.insertDefaultPlayerSync(accountId).id
    const viewerId = 987654322
    await W.insertSessionWithToken({ token: String(viewerId), expires: new Date(Date.now() + 864e5), type: 2 /* VIEWER */, accountId })

    const eventId = 700007
    const post = (url, payload) => fastify.inject({ method: "POST", url, payload: { viewer_id: viewerId, ...payload } })
    const summary = async () => (await post("/rush/summary", { event_id: eventId })).json().data
    const fight = async (questId, won) => {
        let r = await post("/rush/battle/start", { is_auto_start_mode: false, party_id: 1, play_id: "t", quest_id: questId })
        if (r.statusCode !== 200) throw new Error(`battle/start ${questId}: ${r.body}`)
        r = await post("/quest/finish", {
            is_restored: false, continue_count: 0, elapsed_time_ms: 60000, quest_id: questId, category: 15, score: 0,
            add_mana: 0, is_accomplished: won, api_count: 1,
            statistics: { party: { characters: [{ id: 111001 }, null, null], unison_characters: [null, null, null], equipments: [null, null, null], ability_soul_ids: [null, null, null] } },
        })
        if (r.statusCode !== 200) throw new Error(`finish ${questId}: ${r.body}`)
        return r.json().data.rush_event
    }
    const played = data => Object.keys(data.rush_battle_played_party_list ?? {}).length

    check("folder last rounds come from the quests: Intermediate 2, Godly 3, endless 0",
        A.getRushEventFolderLastRound(eventId, 1) === 2 && A.getRushEventFolderLastRound(eventId, 3) === 3 && A.getRushEventFolderLastRound(eventId, 4) === 0,
        [1, 2, 3, 4].map(f => A.getRushEventFolderLastRound(eventId, f)))
    check("...and an event whose Godly folder has 2 rounds keeps 2", A.getRushEventFolderLastRound(700001, 3) === 2)

    let s = await summary()
    check("a new player has no folder, no teams and nothing cleared", s.active_rush_battle_folder_id === null && played(s) === 0 && s.cleared_folder_id_list.length === 0, s)

    // Intermediate (2 rounds)
    await post("/rush/select_folder", { event_id: eventId, folder_id: 1 })
    let rush = await fight(700007001, true)
    check("boss 1 won: its team is used up", played(rush) === 1, rush)
    rush = await fight(700007002, false)
    s = await summary()
    check("boss 2 lost: nothing is cleared and boss 2 is fought again", played(s) === 1 && s.cleared_folder_id_list.length === 0 && s.active_rush_battle_folder_id === 1, s)
    check("...and a loss pays no clear rewards", rush.rush_battle_reward_list.length === 0, rush)
    rush = await fight(700007002, true)
    check("boss 2 won: Intermediate is cleared and paid", rush.rush_battle_reward_list.length > 0, rush)
    check("...with no team left in the finish reply", played(rush) === 0, rush.rush_battle_played_party_list)
    s = await summary()
    check("the next run starts at boss 1: no teams left, no folder chosen", played(s) === 0 && s.active_rush_battle_folder_id === null, s)
    check("...and Intermediate is marked cleared", JSON.stringify(s.cleared_folder_id_list) === "[1]", s.cleared_folder_id_list)

    // a second Intermediate run behaves the same
    await post("/rush/select_folder", { event_id: eventId, folder_id: 1 })
    await fight(700007001, true)
    rush = await fight(700007002, true)
    s = await summary()
    check("a second Intermediate run clears again and leaves no team", rush.rush_battle_reward_list.length > 0 && played(s) === 0 && s.active_rush_battle_folder_id === null, s)

    // Godly (3 rounds): round 2 isn't the end
    await post("/rush/select_folder", { event_id: eventId, folder_id: 3 })
    await fight(700007005, true)
    rush = await fight(700007006, true)
    s = await summary()
    check("Godly boss 2 won: not cleared yet, no rewards, two teams used", rush.rush_battle_reward_list.length === 0 && played(s) === 2 && s.active_rush_battle_folder_id === 3 && !s.cleared_folder_id_list.includes(3), s)
    rush = await fight(700007007, true)
    s = await summary()
    check("Godly boss 3 won: cleared, paid once, no team left", rush.rush_battle_reward_list.length > 0 && played(s) === 0 && s.active_rush_battle_folder_id === null && s.cleared_folder_id_list.includes(3), s)

    await fastify.close()
} finally {
    process.chdir(os.tmpdir())
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { }
}

console.log(failures ? `\n${failures} rush event test(s) failed.` : "\nAll rush event tests passed.")
process.exit(failures ? 1 : 0)
