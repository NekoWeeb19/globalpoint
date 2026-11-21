// Player log 2026-11-21 (companion 0.8.93):
// 1. Bianca (211002): every awake mission claimed and Mana Board 1 complete, yet the Ability Awakening tab said
//    "Complete all Awakening Missions first." until the game restarted. The client reads a unit's awake unlock
//    (mana_board_awake) only from its character_list entry; learn_mana_node sent it at the top of data instead.
//    Now src/nya/manaAwake.ts addManaBoardAwakeToCharacterList puts it in every CN reply's character_list
//    entries (src/server.ts onSend), and learn_mana_node puts it in its own entry.
// 2. item/use_item of 10000069 (a CN-only limited-time stamina potion) answered 400 "Unknown item"
//    (H400, back to the title screen): assets/item_rules.json now has CN's items too (scripts/gen_items.cjs).
//
//   npx tsc
//   node scripts/test_cn_awake_and_items.mjs
import fs from "fs"
import os from "os"
import path from "path"

const out = new URL("../out/", import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cn-awake-items-"))
process.chdir(temp) // the save goes in <working folder>/.database

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

try {
    const getDatabase = (await import(new URL("data/index.js", out))).default.default
    const W = await import(new URL("data/wdfpData.js", out))
    const M = await import(new URL("nya/manaAwake.js", out))
    const I = await import(new URL("lib/item.js", out))
    const itemRules = JSON.parse(fs.readFileSync(new URL("../assets/item_rules.json", import.meta.url), "utf8"))
    const awakeData = JSON.parse(fs.readFileSync(new URL("../assets/mana_awake_cn.json", import.meta.url), "utf8"))
    const db = getDatabase(0 /* Database.WDFP_DATA */)

    // --- items
    const potion = itemRules.items["10000069"]
    check("CN item 10000069 is a 25-stamina item", potion?.effectKind === 2 && potion?.stamina === 25, potion)
    check("global's Staminade Swig (101) is unchanged", itemRules.items["101"]?.name?.trim() === "Staminade Swig" && itemRules.items["101"]?.stamina === 25, itemRules.items["101"])
    const inPeriod = Date.parse("2021-09-08T00:00:00Z")
    const plan = I.planItemUse(itemRules, [{ id: 10000069, count: 25 }], () => 25, 36, inPeriod)
    check("using 25 of 10000069 is planned (was Unknown item)", plan.ok === true && plan.staminaAfter === 36 + 25 * 25, plan)
    const late = I.planItemUse(itemRules, [{ id: 10000069, count: 1 }], () => 1, 36, Date.parse("2026-01-01T00:00:00Z"))
    check("after its end date the game's own out-of-period code is sent", late.ok === false && late.resultCode === I.ITEM_RESULT_CODES.USE_OUT_OF_PERIOD, late)

    // --- awakening
    const now = new Date().toISOString()
    const accountId = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
        VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(now, now, now).lastInsertRowid)
    const playerId = W.insertDefaultPlayerSync(accountId).id
    const BIANCA = 211002, OTHER = 211001
    W.insertDefaultPlayerCharacterSync(playerId, BIANCA)
    W.insertDefaultPlayerCharacterSync(playerId, OTHER)
    const setProgress = (id, progress) => db.prepare(`INSERT INTO players_active_missions (id, progress, player_id) VALUES (?, ?, ?)
        ON CONFLICT (id, player_id) DO UPDATE SET progress = excluded.progress`).run(id, progress, playerId)
    for (const id of [2110021, 2110022, 2110023]) setProgress(id, 60)
    setProgress(2110024, 3) // "Complete all Awakening Missions"

    const list = () => [{ character_id: BIANCA, evolution_level: 1 }, { character_id: OTHER }]
    let reply = list()
    M.addManaBoardAwakeToCharacterList(playerId, reply)
    check("missions done but board 1 not learned: nothing sent", !("mana_board_awake" in reply[0]), reply[0])

    W.insertPlayerCharacterManaNodesSync(playerId, BIANCA, Object.keys(awakeData.nodes[String(BIANCA)]).map(Number))
    reply = list()
    M.addManaBoardAwakeToCharacterList(playerId, reply)
    check("board 1 learned: Bianca's entry gets mana_board_awake {1: 1}", JSON.stringify(reply[0].mana_board_awake) === JSON.stringify({ "1": 1 }), reply[0])
    check("a unit with nothing unlocked is left alone", !("mana_board_awake" in reply[1]), reply[1])
    check("the rest of the entry is kept", reply[0].evolution_level === 1)

    reply = [{ character_id: BIANCA, mana_board_awake: { "1": 2 } }]
    M.addManaBoardAwakeToCharacterList(playerId, reply)
    check("an entry that already has the field keeps it", reply[0].mana_board_awake["1"] === 2, reply[0])

    M.addManaBoardAwakeToCharacterList(playerId, undefined)
    M.addManaBoardAwakeToCharacterList(playerId, [null, 5, { name: "no id" }])
    check("odd lists don't throw", true)

    check("getSessionSync is exported for the reply hook", typeof W.getSessionSync === "function")
} catch (error) {
    console.error(error)
    failures++
} finally {
    process.chdir(os.tmpdir())
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { }
}

console.log(failures === 0 ? "all checks passed" : `${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
