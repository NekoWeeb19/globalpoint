// Tests quest/unlock (src/routes/api/quest.ts: CN's world story event big bosses, unlocked once with a Proficiency
// Certificate), the "unlocked" flag in the game's load data and in save files, and score drops for a battle with no
// drop list (a CN-only challenge battle, group 0: the finish used to fail with "scoreRewards is not iterable").
//
//   npx tsc
//   node scripts/test_quest_unlock.mjs
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"

const out = new URL("../out/", import.meta.url)
const require = createRequire(import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "quest-unlock-"))
process.chdir(temp) // the save goes in <working folder>/.database

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

try {
    const getDatabase = (await import(new URL("data/index.js", out))).default.default
    const W = await import(new URL("data/wdfpData.js", out))
    const U = await import(new URL("data/utils.js", out))
    const { givePlayerScoreRewardsSync } = await import(new URL("lib/quest.js", out))
    const { getQuestFromCategorySync } = await import(new URL("lib/assets.js", out))
    const questRoutes = (await import(new URL("routes/api/quest.js", out))).default
    const fastify = require("fastify")()
    // the real server sends msgpack (its own serializer); JSON here
    fastify.addHook("onSend", async (request, reply, payload) => payload && typeof payload === "object" && !Buffer.isBuffer(payload) ? JSON.stringify(payload) : payload)
    await fastify.register(questRoutes.default ?? questRoutes)
    await fastify.ready()
    const db = getDatabase(0 /* Database.WDFP_DATA */)

    const now = new Date().toISOString()
    const accountId = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
        VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(now, now, now).lastInsertRowid)
    const playerId = W.insertDefaultPlayerSync(accountId).id
    const viewerId = 123456789
    await W.insertSessionWithToken({ token: String(viewerId), expires: new Date(Date.now() + 864e5), type: 2 /* VIEWER */, accountId })

    const WORLD_STORY = 18, BIG_BOSS = 400009102, CERTIFICATE = 60001
    const unlock = (questId = BIG_BOSS, category = WORLD_STORY) => fastify.inject({ method: "POST", url: "/unlock", payload: { viewer_id: viewerId, category, quest_id: questId } })
    const progressEntry = () => (U.getClientSerializedData(playerId, { viewerId }).quest_progress[String(WORLD_STORY)] ?? []).find(p => p.quest_id === BIG_BOSS)

    // no certificate: refused, nothing saved
    let r = await unlock()
    check("without a certificate the unlock is refused", r.statusCode === 400, r.body)
    check("...and nothing is saved", progressEntry() === undefined, progressEntry())

    // a quest with no unlock cost is refused
    r = await unlock(400009101)
    check("a battle without an unlock cost is refused", r.statusCode === 400, r.body)

    // with certificates: one is taken, the battle is unlocked
    W.givePlayerItemSync(playerId, CERTIFICATE, 3)
    r = await unlock()
    check("with a certificate the unlock succeeds", r.statusCode === 200, r.body)
    check("...the reply has the new certificate count", r.json().data?.item_list?.[String(CERTIFICATE)] === 2, r.json())
    check("...one certificate is taken", W.getPlayerItemSync(playerId, CERTIFICATE) === 2, W.getPlayerItemSync(playerId, CERTIFICATE))
    check("...the load data marks the battle unlocked, with no \"finished\" (as the game's own unlock)", progressEntry()?.unlocked === true && !("finished" in progressEntry()), progressEntry())
    check("...no quest progress row is made (the first clear still pays)", W.getPlayerSingleQuestProgressSync(playerId, WORLD_STORY, BIG_BOSS) === null)

    // a second unlock (e.g. a retry) takes nothing
    r = await unlock()
    check("unlocking again succeeds without taking another certificate", r.statusCode === 200 && W.getPlayerItemSync(playerId, CERTIFICATE) === 2, [r.body, W.getPlayerItemSync(playerId, CERTIFICATE)])

    // cleared later: one entry, cleared and unlocked
    W.insertPlayerQuestProgressSync(playerId, WORLD_STORY, { questId: BIG_BOSS, finished: true, clearRank: 3, highScore: 100, bestElapsedTimeMs: 1000 })
    const entries = U.getClientSerializedData(playerId, { viewerId }).quest_progress[String(WORLD_STORY)].filter(p => p.quest_id === BIG_BOSS)
    check("after a clear the battle has one entry, cleared and unlocked", entries.length === 1 && entries[0].finished === true && entries[0].unlocked === true, entries)

    // a save file keeps the unlock: export, import into the same save
    db.prepare(`DELETE FROM players_quest_progress WHERE player_id = ?`).run(playerId)
    const saved = JSON.parse(JSON.stringify(U.getClientSerializedData(playerId, { viewerId })))
    W.replacePlayerDataSync(U.deserializePlayerData(playerId, saved))
    check("a save file keeps the unlock", (W.getPlayerQuestUnlocksSync(playerId)[String(WORLD_STORY)] ?? []).includes(BIG_BOSS), W.getPlayerQuestUnlocksSync(playerId))
    check("...without making a quest progress row", W.getPlayerSingleQuestProgressSync(playerId, WORLD_STORY, BIG_BOSS) === null, W.getPlayerSingleQuestProgressSync(playerId, WORLD_STORY, BIG_BOSS))

    // a battle with no drop list
    const challenge = getQuestFromCategorySync(WORLD_STORY, 400012102)
    check("the CN-only challenge battle has no drop list", challenge !== null && challenge.scoreRewardGroup === null, challenge?.scoreRewardGroup)
    let result, error
    try { result = givePlayerScoreRewardsSync(playerId, challenge.scoreRewardGroupId, challenge.scoreRewardGroup) } catch (e) { error = String(e) }
    check("score drops for it give nothing instead of failing", error === undefined && result.drop_score_reward_ids.length === 0, error ?? result)

    await fastify.close()
} finally {
    process.chdir(os.tmpdir())
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { }
}

console.log(failures ? `\n${failures} quest unlock test(s) failed.` : "\nAll quest unlock tests passed.")
process.exit(failures ? 1 : 0)
