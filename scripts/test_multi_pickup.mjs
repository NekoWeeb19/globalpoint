// Tests CN's Multi Boss Pick-up promos (src/lib/multiPickup.ts, src/routes/api/singleBattleQuest.ts): a co-op clear of
// the day's featured boss pays mana and EXP (and the boss coins) x the promo's rate; solo, another boss, a day outside
// the promo or the global app pay the normal amounts. On a throwaway save in a temp folder.
//
//   npx tsc
//   node scripts/test_multi_pickup.mjs
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"

const out = new URL("../out/", import.meta.url)
const require = createRequire(import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "multi-pickup-"))
process.chdir(temp)
delete process.env.CN_ACCOUNT_ID

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

try {
    const getDatabase = (await import(new URL("data/index.js", out))).default.default
    const W = await import(new URL("data/wdfpData.js", out))
    const { setServerTime } = await import(new URL("utils.js", out))
    const { runInCnContext } = await import(new URL("lib/cnClient.js", out))
    const { multiPickupFor } = await import(new URL("lib/multiPickup.js", out))
    const Q = await import(new URL("routes/api/singleBattleQuest.js", out))
    const bossQuests = require("../assets/boss_battle_quest.json")
    const fastify = require("fastify")()
    fastify.addHook("onRequest", (request, reply, done) => runInCnContext(request.headers["x-test-cn"] === "1", done))
    fastify.addHook("onSend", async (request, reply, payload) => payload && typeof payload === "object" && !Buffer.isBuffer(payload) ? JSON.stringify(payload) : payload)
    await fastify.register(Q.default.default ?? Q.default, { prefix: "/quest" })
    await fastify.ready()
    const db = getDatabase(0)

    const stamp = new Date().toISOString()
    const accountId = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
        VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(stamp, stamp, stamp).lastInsertRowid)
    const playerId = W.insertDefaultPlayerSync(accountId).id
    const viewerId = 987654329
    await W.insertSessionWithToken({ token: String(viewerId), expires: new Date(Date.now() + 864e5), type: 2, accountId })

    // one finished boss battle: { mana, exp } the quest paid
    const finish = async (questId, { coop, cn = true }) => {
        Q.insertActiveQuest(playerId, { questId, category: 2, useBossBoostPoint: false, useBoostPoint: false, isAutoStartMode: false })
        if (coop) Q.markActiveQuestCoop(playerId)
        const r = await fastify.inject({
            method: "POST", url: "/quest/finish", headers: cn ? { "x-test-cn": "1" } : {},
            payload: {
                viewer_id: viewerId, is_restored: false, continue_count: 0, elapsed_time_ms: 60000, quest_id: questId, category: 2,
                score: 0, add_mana: 0, is_accomplished: true, api_count: 1,
                statistics: { party: { characters: [{ id: 111001 }, null, null], unison_characters: [null, null, null], equipments: [null, null, null], ability_soul_ids: [null, null, null] } },
            },
        })
        if (r.statusCode !== 200) throw new Error(`finish ${questId}: ${r.body}`)
        return { mana: findKey(r.json(), "reward_mana"), exp: findKey(r.json(), "reward_pool_exp") }
    }
    const findKey = (o, key) => {
        if (o === null || typeof o !== "object") return undefined
        if (key in o) return o[key]
        for (const v of Object.values(o)) { const f = findKey(v, key); if (f !== undefined) return f }
    }

    // the rules
    const day1 = Date.parse("2021-11-11T12:00:00Z") // promo 1 (x1.5), first day: the boss at chapter 1 node 12
    check("promo 1's first day features node 12, every difficulty", multiPickupFor(day1, 1012001)?.rate === 1.5 && multiPickupFor(day1, 1012004)?.event === 1)
    check("...and not another boss", multiPickupFor(day1, 1003001) === null)
    check("nothing before the promo starts", multiPickupFor(Date.parse("2021-11-11T03:59:00Z"), 1012001) === null)
    check("a x3 promo (2022-11-17, node 12)", multiPickupFor(Date.parse("2022-11-17T12:00:00Z"), 1012001)?.rate === 3)
    check("a featured day outside its promo's window never counts (CN's first-year date gap)", multiPickupFor(Date.parse("2020-12-31T12:00:00Z"), 1020001) === null)

    // the battle finish
    setServerTime(new Date(day1))
    const quest = bossQuests["1012001"]
    const coop = await finish(1012001, { coop: true })
    check("co-op on the featured boss: mana and EXP x1.5", coop.mana === Math.floor(quest.manaReward * 1.5) && coop.exp === Math.floor(quest.poolExpReward * 1.5), { coop, quest })
    const solo = await finish(1012001, { coop: false })
    check("solo on the featured boss: normal", solo.mana === quest.manaReward && solo.exp === quest.poolExpReward, solo)
    const other = await finish(1003001, { coop: true })
    check("co-op on another boss: normal", other.mana === bossQuests["1003001"].manaReward, other)
    const global = await finish(1012001, { coop: true, cn: false })
    check("the global app: normal", global.mana === quest.manaReward, global)
    setServerTime(null)
    await fastify.close()
} catch (error) {
    console.log("FAIL", error)
    failures++
} finally {
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { }
}

console.log(failures ? `\n${failures} multi pick-up test(s) failed.` : "\nAll multi pick-up tests passed.")
process.exit(failures ? 1 : 0)
