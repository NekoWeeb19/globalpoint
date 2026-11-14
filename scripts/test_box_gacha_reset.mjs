// Tests box_gacha/reset (src/routes/api/boxGacha.ts): a reset box is full and open again, its reset count goes up,
// the other boxes are untouched, and the reply has every box (all_box_info) as the client reads it. Was a 404
// (U0000 when a player reset the last box of box gacha 2, player log 2026-11-14).
//
//   npx tsc
//   node scripts/test_box_gacha_reset.mjs
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"

const out = new URL("../out/", import.meta.url)
const require = createRequire(import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "box-gacha-reset-"))
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
    const boxRoutes = (await import(new URL("routes/api/boxGacha.js", out))).default
    const fastify = require("fastify")()
    fastify.addHook("onSend", async (request, reply, payload) => payload && typeof payload === "object" && !Buffer.isBuffer(payload) ? JSON.stringify(payload) : payload)
    await fastify.register(boxRoutes.default ?? boxRoutes)
    await fastify.ready()
    const db = getDatabase(0 /* Database.WDFP_DATA */)

    const now = new Date().toISOString()
    const accountId = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
        VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(now, now, now).lastInsertRowid)
    const playerId = W.insertDefaultPlayerSync(accountId).id
    const viewerId = 987654322
    await W.insertSessionWithToken({ token: String(viewerId), expires: new Date(Date.now() + 864e5), type: 2 /* VIEWER */, accountId })
    const post = (url, payload) => fastify.inject({ method: "POST", url, payload: { viewer_id: viewerId, ...payload } })

    const GACHA = 2, BOX = 4
    const data = A.getBoxGachaSync(GACHA)
    check("box gacha 2 has box 4", data && data.boxes[BOX] !== undefined)
    W.givePlayerItemSync(playerId, data.redeemItemId, 100000)

    let r = await post("/exec", { box_gacha_id: GACHA, box_id: BOX, number: 5, stop_on_featured_rewards: false })
    check("drawing 5 from box 4 works", r.statusCode === 200, r.body)
    await post("/exec", { box_gacha_id: GACHA, box_id: 1, number: 3, stop_on_featured_rewards: false })
    const drawn = (box) => W.getPlayerBoxGachaDrawnRewardsSync(playerId, GACHA, box).reduce((n, x) => n + x.number, 0)
    check("5 drawn from box 4, 3 from box 1", drawn(BOX) === 5 && drawn(1) === 3, [drawn(BOX), drawn(1)])

    r = await post("/reset", { box_gacha_id: GACHA, box_id: BOX })
    check("reset answers 200 (was a 404)", r.statusCode === 200, r.body)
    const info = r.json().data?.all_box_info ?? []
    const box4 = info.find(b => b.box_id === BOX)
    check("the reply lists every box", info.length === Object.keys(data.boxes).length, info.length)
    check("box 4: nothing drawn, open, reset once", box4 && box4.all_drawn_reward_list.length === 0 && box4.is_closed === false && box4.reset_times === 1, box4)
    check("box 1 is untouched", drawn(1) === 3 && info.find(b => b.box_id === 1)?.all_drawn_reward_list.length > 0)
    const row = W.getPlayerBoxGachaSync(playerId, GACHA, BOX)
    check("the saved box is full again", row && row.remainingNumber === data.availableCounts[BOX] && row.isClosed === false, row)

    r = await post("/exec", { box_gacha_id: GACHA, box_id: BOX, number: 2, stop_on_featured_rewards: false })
    check("drawing after the reset counts from a full box", r.statusCode === 200 && drawn(BOX) === 2 && W.getPlayerBoxGachaSync(playerId, GACHA, BOX).remainingNumber === data.availableCounts[BOX] - 2)
    r = await post("/reset", { box_gacha_id: GACHA, box_id: BOX })
    check("a second reset counts 2", r.json().data.all_box_info.find(b => b.box_id === BOX).reset_times === 2)

    r = await post("/reset", { box_gacha_id: GACHA, box_id: 99 })
    check("a box that doesn't exist is refused", r.statusCode === 400)
    r = await post("/reset", { box_gacha_id: 3, box_id: 1 })
    check("a box never drawn from can be reset too (reset once)", r.statusCode !== 200 || r.json().data.all_box_info.find(b => b.box_id === 1).reset_times === 1, r.body)

    await fastify.close()
} finally {
    process.chdir(os.tmpdir())
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { }
}

console.log(failures ? `\n${failures} box gacha reset test(s) failed.` : "\nAll box gacha reset tests passed.")
process.exit(failures ? 1 : 0)
