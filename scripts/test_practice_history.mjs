// Tests history/practice_battle (src/routes/api/history.ts): practice battles are saved like Score Attack battles
// (src/nya/scoreAttack.ts, under PRACTICE_HISTORY_EVENT), newest first, the oldest dropped past 50, and never mixed
// with a Score Attack event's history.
//
//   npx tsc
//   node scripts/test_practice_history.mjs
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"

const out = new URL("../out/", import.meta.url)
const require = createRequire(import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "practice-history-"))
process.chdir(temp) // the save goes in <working folder>/.database

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

try {
    const getDatabase = (await import(new URL("data/index.js", out))).default.default
    const W = await import(new URL("data/wdfpData.js", out))
    const SA = await import(new URL("nya/scoreAttack.js", out))
    const historyRoutes = (await import(new URL("routes/api/history.js", out))).default
    const fastify = require("fastify")()
    // the real server sends msgpack (its own serializer); JSON here
    fastify.addHook("onSend", async (request, reply, payload) => payload && typeof payload === "object" && !Buffer.isBuffer(payload) ? JSON.stringify(payload) : payload)
    await fastify.register(historyRoutes.default ?? historyRoutes)
    await fastify.ready()
    const db = getDatabase(0 /* Database.WDFP_DATA */)

    const now = new Date().toISOString()
    const accountId = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
        VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(now, now, now).lastInsertRowid)
    const playerId = W.insertDefaultPlayerSync(accountId).id
    const viewerId = 987654321
    await W.insertSessionWithToken({ token: String(viewerId), expires: new Date(Date.now() + 864e5), type: 2 /* VIEWER */, accountId })
    const practice = () => fastify.inject({ method: "POST", url: "/practice_battle", payload: { viewer_id: viewerId } })

    let r = await practice()
    check("no practice battles yet: an empty history", r.statusCode === 200 && Array.isArray(r.json().data?.history) && r.json().data.history.length === 0, r.body)

    const battle = (questId, score) => SA.recordScoreAttackBattleSync(playerId, SA.PRACTICE_HISTORY_EVENT, {
        categoryId: 26, questId, elapsedTimeMs: 1000, score, clearRank: 3,
        party: { characters: [{ id: 111001 }, null, null] }, zones: [{ damage_deal_total: 500, members: [{ origin_damage: 500 }] }],
    })
    battle(1, 10); battle(2, 20)
    SA.recordScoreAttackBattleSync(playerId, 1, { categoryId: 25, questId: 99, elapsedTimeMs: 1, score: 1, clearRank: 1, party: undefined, zones: [] })
    r = await practice()
    const history = r.json().data.history
    check("two practice battles, newest first", history.length === 2 && history[0].quest_id === 2 && history[1].quest_id === 1, history)
    check("...with the fields the game reads", history[0].character_id_1 === 111001 && history[0].total_damage === 500 && typeof history[0].create_time === "string", history[0])
    check("a Score Attack battle isn't in the practice history", !history.some(h => h.quest_id === 99))

    for (let i = 0; i < 60; i++) battle(100 + i, i)
    r = await practice()
    check("only the newest 50 are kept", r.json().data.history.length === 50 && r.json().data.history[0].quest_id === 159, r.json().data.history.length)
    check("...and the Score Attack history is untouched", SA.getScoreAttackHistorySync(playerId, 1).length === 1)

    await fastify.close()
} finally {
    process.chdir(os.tmpdir())
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { }
}

console.log(failures ? `\n${failures} practice history test(s) failed.` : "\nAll practice history tests passed.")
process.exit(failures ? 1 : 0)
