// Tests The Haunt's floor rewards against the game's own data: every floor's reward group and element as CN's
// table (master/quest/event/tower_dungeon_event_quest, read from the CN game files) has them, the copied months'
// floors (src/lib/towerRotation.ts) the same as the floor they copy, and the rewards the server really gives for
// a clear (on a throwaway save): every reward more than 0, the element materials an item CN's item table has.
//
//   npm run build && node --env-file=.env scripts/test_tower_rewards.mjs
// The CN game files (CN_CDN_DIR) are needed for the table checks; without them those are skipped.
import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
let failed = 0
const check = (label, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok || detail === undefined ? "" : `  -> ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)}`}`)
    if (!ok) failed++
}

// the server keeps its save in the folder it runs in: a throwaway one, before any server code loads
const temp = mkdtempSync(path.join(os.tmpdir(), "tower-rewards-"))
const cwd = process.cwd()
process.chdir(temp)
try {
    const T = require(path.join(root, "out", "lib", "towerRotation.js"))
    const Q = require(path.join(root, "out", "lib", "quest.js"))
    const A = require(path.join(root, "out", "lib", "assets.js"))
    const D = require(path.join(root, "out", "data", "wdfpData.js"))
    const { runInCnContext } = require(path.join(root, "out", "lib", "cnClient.js"))
    const HAUNT = 20
    // the checks run as the CN client's requests do (the server answers CN requests with CN's data)
    const cnCtx = fn => new Promise((resolve, reject) => runInCnContext(true, () => Promise.resolve().then(fn).then(resolve, reject)))
    await cnCtx(async () => {

    // ---- CN's table, read straight from the game files ----
    const { readCnTable } = require(path.join(root, "scripts", "cn_read.cjs"))
    const { splitCsv } = require(path.join(root, "scripts", "cdn_rows.cjs"))
    const table = await readCnTable("master/quest/event/tower_dungeon_event_quest.orderedmap").catch(() => null)
    const items = await readCnTable("master/item/item.orderedmap").catch(() => null)
    const floors = new Map() // quest id -> { group, element } as CN's table has them
    if (table) for (const [key, text] of Object.entries(table)) {
        const c = splitCsv(text.replace(/\n$/, "").split("\n")[0])
        const index = Number(key.split("/").pop())
        floors.set(1000 + index, { id: Number(c[0]), group: Number(c[69]), element: Number(c[70]) })
    }
    if (!table) console.log("SKIP CN table checks: no CN game files (CN_CDN_DIR)")
    else {
        check("CN's table: 480 floors, each row's quest id is 1000 + its key", floors.size === 480 && [...floors].every(([id, f]) => f.id === id))
        const elementWrong = [...floors].filter(([id, f]) => Q.questElement(HAUNT, id) !== f.element)
        check("every CN floor's element is the one in CN's table", elementWrong.length === 0, elementWrong.slice(0, 5).map(([id, f]) => ({ id, table: f.element, server: Q.questElement(HAUNT, id) })))
        const groupWrong = [...floors].filter(([id, f]) => A.getQuestFromCategorySync(HAUNT, id)?.scoreRewardGroupId !== f.group)
        check("every CN floor's reward group is the one in CN's table", groupWrong.length === 0, groupWrong.slice(0, 5).map(([id, f]) => ({ id, table: f.group, server: A.getQuestFromCategorySync(HAUNT, id)?.scoreRewardGroupId })))
        const elements = new Set([...floors.values()].map(f => f.element))
        check("the floors cover all six elements", elements.size === 6, [...elements])
    }

    // ---- the copied months: the same element and rewards as the floor they copy ----
    let copies = 0
    const copyWrong = []
    for (let year = 2019; year <= 2040; year++) for (let month = 1; month <= 12; month++) {
        if (!T.isTowerCopyMonth(year, month)) continue
        const set = T.towerSetForMonth(year, month)
        for (let floor = 1; floor <= 10; floor++) {
            const copy = T.towerCopyQuestId(year, month, floor), original = T.towerQuestId(set, floor)
            copies++
            const qc = A.getQuestFromCategorySync(HAUNT, copy), qo = A.getQuestFromCategorySync(HAUNT, original)
            if (!qc || qc.scoreRewardGroupId !== qo?.scoreRewardGroupId || Q.questElement(HAUNT, copy) !== Q.questElement(HAUNT, original)) copyWrong.push({ year, month, floor, copy, original })
        }
    }
    check(`every copied floor 2020-2040 (${copies}) has its original's element and rewards`, copies > 0 && copyWrong.length === 0, copyWrong.slice(0, 5))
    check("the first copied month (2021-05) is set 37, 2026-05 set 1 again", T.towerSetForMonth(2021, 5) === 37 && T.towerSetForMonth(2026, 5) === 1)
    check("The Haunt opens 2020-01 (set 21); nothing before it", T.isTowerCopyMonth(2020, 1) && !T.isTowerCopyMonth(2019, 12) && T.towerSetForMonth(2020, 1) === 21)
    // 2020-01 to 2021-04 got their own keys later: every key is still unique, and the older months' keys didn't move
    const keys = []
    for (let year = 2020; year <= 2040; year++) for (let month = 1; month <= 12; month++) if (T.isTowerCopyMonth(year, month)) for (let f = 1; f <= 10; f++) keys.push(T.towerCopyKey(year, month, f))
    check("every copy month has its own keys", new Set(keys).size === keys.length, keys.length)
    check("2021-05 and 2026-05 keep their keys (481, 601)", T.towerCopyKey(2021, 5, 1) === 481 && T.towerCopyKey(2026, 5, 1) === 601)

    // ---- a clear on a throwaway save: what the server really gives ----
    const account = await D.insertAccount({ appId: "test", idpAlias: "tower-test", idpCode: "test", idpId: "tower-test", status: "0" })
    const player = D.insertDefaultPlayerSync(account.id)
    const pickPerElement = new Map()
    for (const [id] of floors.size ? floors : new Map([[1001, {}], [1011, {}], [1021, {}], [1031, {}], [1041, {}], [1051, {}]])) {
        const element = Q.questElement(HAUNT, id)
        if (!pickPerElement.has(element)) pickPerElement.set(element, id)
    }
    const knownItem = id => items === null || Object.keys(items).some(k => k.split("/")[0] === String(id))
    for (const [element, id] of [...pickPerElement].sort((a, b) => a[0] - b[0])) {
        // the copy of this floor in a copied month pays the same, so test the copy's id (what the game sends)
        const month = [[2026, 5], [2026, 6], [2026, 7], [2026, 8], [2026, 9], [2026, 10], [2026, 11], [2026, 12], [2027, 1], [2027, 2], [2027, 3], [2027, 4]]
            .find(([y, m]) => T.towerSetForMonth(y, m) === Math.floor((id - 1001) / 10) + 1)
        const questId = month ? T.towerCopyQuestId(month[0], month[1], (id - 1001) % 10 + 1) : id
        const quest = A.getQuestFromCategorySync(HAUNT, questId)
        const before = Object.fromEntries([1, 2, 3].map(t => [t, Q.elementDropItemId(t, element)]).map(([t, item]) => [t, item === undefined ? 0 : (D.getPlayerItemSync(player.id, item) ?? 0)]))
        const result = Q.givePlayerScoreRewardsSync(player.id, quest.scoreRewardGroupId, quest.scoreRewardGroup, false, 1, Q.questElement(HAUNT, questId))
        const shown = result.drop_rare_reward_ids
        const label = `floor ${questId} (CN ${T.towerOriginalQuestId(questId)}, element ${element})`
        check(`${label}: all ${quest.scoreRewardGroup.length} rewards shown with an amount above 0`, shown.length === quest.scoreRewardGroup.length && shown.every(r => r.number > 0), shown)
        for (const [tier, count] of [[1, 60], [2, 15], [3, 5]]) {
            const item = Q.elementDropItemId(tier, element)
            const got = item === undefined ? 0 : (D.getPlayerItemSync(player.id, item) ?? 0) - before[tier]
            check(`${label}: tier ${tier} element material = item ${item} x${count}, an item the game has`, item !== undefined && got === count && knownItem(item), { item, got, inItemTable: item !== undefined && knownItem(item) })
        }
        check(`${label}: 3000 mana and 150 beads`, result.user_info.free_mana >= 3000 && result.user_info.free_vmoney >= 150, result.user_info)
    }
    })
} finally {
    process.chdir(cwd)
    try { rmSync(temp, { recursive: true, force: true }) } catch { }
}
console.log(failed ? `\n${failed} Haunt reward test(s) failed.` : "\nAll Haunt reward tests passed.")
process.exit(failed ? 1 : 0)
