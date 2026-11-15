// Tests the player page's Story and rank tools (src/nya/saveSetup.ts, /api/server/save/unlockChapters and
// /save/rank in src/routes/web_api/server.ts) on a new save in a temp folder.
//   npx tsc
//   node scripts/test_save_setup_routes.mjs
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"

const out = new URL("../out/", import.meta.url)
const require = createRequire(import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "save-setup-"))
process.chdir(temp)

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

try {
    const getDatabase = (await import(new URL("data/index.js", out))).default.default
    const W = await import(new URL("data/wdfpData.js", out))
    const P = await import(new URL("nya/player.js", out))
    const routes = (await import(new URL("routes/web_api/server.js", out))).default
    const fastify = require("fastify")()
    await fastify.register(routes.default ?? routes)
    await fastify.ready()
    const db = getDatabase(0)
    const now = new Date().toISOString()
    const accountId = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
        VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(now, now, now).lastInsertRowid)
    const playerId = W.insertDefaultPlayerSync(accountId).id
    const post = (url, payload) => fastify.inject({ method: "POST", url, payload })
    const mainTotal = Object.keys(require("../assets/main_quest.json")).length
    const cleared = () => db.prepare("SELECT COUNT(*) AS n FROM players_quest_progress WHERE player_id = ? AND section = 1 AND finished = 1").get(playerId).n

    db.prepare("INSERT INTO players_quest_progress (section, quest_id, finished, high_score, player_id) VALUES (1, ?, 1, 12345, ?)").run(Number(Object.keys(require("../assets/main_quest.json"))[0]), playerId)
    let r = await post("/save/unlockChapters", { playerId })
    check("unlock answers 200", r.statusCode === 200, r.body)
    check("every main stage cleared", cleared() === mainTotal, [cleared(), mainTotal])
    check("an already-cleared stage keeps its score", db.prepare("SELECT high_score FROM players_quest_progress WHERE player_id = ? AND section = 1 AND high_score = 12345").get(playerId) !== undefined)
    r = await post("/save/unlockChapters", { playerId })
    check("a second press says they were already cleared", r.statusCode === 200 && /already/.test(r.json().message), r.body)
    check("unlock refuses an unknown player", (await post("/save/unlockChapters", { playerId: 99999 })).statusCode === 400)

    r = await post("/save/rank", { playerId, rank: 120 })
    check("set rank 120", r.statusCode === 200 && P.getRankByPt(W.getPlayerSync(playerId).rankPoint).rank === 120, r.body)
    r = await post("/save/rank", { playerId, rank: 5 })
    check("set rank down to 5", r.statusCode === 200 && P.getRankByPt(W.getPlayerSync(playerId).rankPoint).rank === 5, r.body)
    for (const bad of [0, 251, 2.5, "x"]) check(`rank ${bad} refused`, (await post("/save/rank", { playerId, rank: bad })).statusCode === 400)
    check("rank refuses an unknown player", (await post("/save/rank", { playerId: 99999, rank: 10 })).statusCode === 400)
    await fastify.close()
} finally {
    process.chdir(os.tmpdir())
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { }
}
console.log(failures ? `\n${failures} save setup test(s) failed.` : "\nAll save setup tests passed.")
process.exit(failures ? 1 : 0)
