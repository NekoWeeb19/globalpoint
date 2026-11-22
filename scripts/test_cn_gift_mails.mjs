// Tests CN's own gift mails (assets/cn_gift_mails.json, src/nya/cnGiftMails.ts): the file is sound, the CN app gets
// each gift on CN's date (one mail per item) and the global app doesn't, a gift older than 30 days isn't sent after a
// date jump, claiming gives the items, and the dashboard's switch and Remove work. On a throwaway save in a temp folder.
//
//   npx tsc
//   node scripts/test_cn_gift_mails.mjs
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"

const out = new URL("../out/", import.meta.url)
const require = createRequire(import.meta.url)
const asset = JSON.parse(fs.readFileSync(new URL("../assets/cn_gift_mails.json", import.meta.url), "utf8"))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cn-gift-mails-"))
process.chdir(temp) // the save and the settings go in <working folder>/.database
delete process.env.CN_ACCOUNT_ID

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const DAY = 86_400_000

try {
    // ---- the file ----
    const gifts = asset.mails
    const KINDS = ["beads_free", "mana", "exp", "item", "chara", "equip"]
    check("the file has CN's gifts from launch to the end", gifts.length > 100 && gifts[0].at === "2021-10-26T02:00:00Z" && gifts.at(-1).at < "2025-08-14", [gifts.length, gifts[0]?.at, gifts.at(-1)?.at])
    check("gift ids are unique", new Set(gifts.map(g => g.id)).size === gifts.length)
    check("gifts are in time order, with real times", gifts.every((g, i) => !Number.isNaN(Date.parse(g.at)) && (i === 0 || gifts[i - 1].at <= g.at)))
    const badItem = gifts.flatMap(g => g.items.map(x => [g.id, x])).filter(([, x]) => !KINDS.includes(x.kind) || !Number.isSafeInteger(x.amount) || x.amount < 1
        || (["item", "chara", "equip"].includes(x.kind) ? !Number.isSafeInteger(x.typeId) : x.typeId !== undefined))
    check("every item is a mail kind with an amount (and an id where it needs one)", badItem.length === 0, badItem)
    check("titles and the message fit the game's mail", gifts.every(g => g.title.length > 0 && g.title.length <= 60) && asset.message.length <= 300)
    check("fewer than 100 items per gift (schedule ids)", gifts.every(g => g.items.length < 100))
    // with CN's game files (the full test run): every item, unit and armament is in CN's own tables
    if (process.env.CN_CDN_DIR) {
        const { readCnTable } = require("./cn_read.cjs")
        const tables = { item: "master/item/item.orderedmap", chara: "master/character/character.orderedmap", equip: "master/item/equipment.orderedmap" }
        const missing = []
        for (const [kind, logical] of Object.entries(tables)) {
            const table = await readCnTable(logical, { raw: true })
            for (const g of gifts) for (const x of g.items) if (x.kind === kind && (table?.[x.typeId] === undefined)) missing.push([g.id, kind, x.typeId])
        }
        check("every item, unit and armament exists in CN's tables", missing.length === 0, missing)
    }

    // ---- delivery ----
    const getDatabase = (await import(new URL("data/index.js", out))).default.default
    const { insertDefaultPlayerSync, getPlayerSync, getPlayerItemSync } = await import(new URL("data/wdfpData.js", out))
    const { setServerTime } = await import(new URL("utils.js", out))
    const { runInCnContext } = await import(new URL("lib/cnClient.js", out))
    const { GetMails, ProcessMail, ProcessAllMails } = await import(new URL("nya/mail.js", out))
    const G = await import(new URL("nya/cnGiftMails.js", out))
    const db = getDatabase(0)
    const stamp = new Date().toISOString()
    const newPlayer = () => {
        const account = Number(db.prepare(`INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
            VALUES ('t', ?, 't', 't', 't', ?, ?, 'ok')`).run(stamp, stamp, stamp).lastInsertRowid)
        return insertDefaultPlayerSync(account).id
    }
    const at = iso => setServerTime(new Date(iso))
    const cn = fn => { let r; runInCnContext(true, () => { r = fn() }); return r }
    const giftMails = (p, inCn = true) => (inCn ? cn(() => GetMails(p)) : GetMails(p)).filter(m => m.id >= 20_000_000 && m.id < 90_000_000)

    const A = newPlayer()
    at("2021-10-26T01:00:00Z")
    check("nothing before CN's launch", giftMails(A).length === 0)
    at("2021-10-26T03:00:00Z")
    check("the global app gets no CN gifts", giftMails(A, false).length === 0)
    let mails = giftMails(A)
    check("launch day: CN's 1,500 free beads arrive in the CN app", mails.length === 1 && mails[0].type === 4 && mails[0].number === 1500 && mails[0].subject === "Launch Day Gift", mails)
    check("it's dated CN's time and claimable for 30 days", mails[0]?.create_time === "2021-10-26 02:00:00" && mails[0]?.reward_limit_time === "2021-11-25 02:00:00", mails[0])
    const free = getPlayerSync(A).freeVmoney
    cn(() => ProcessMail(A, mails[0].id))
    check("claiming it adds the free beads", getPlayerSync(A).freeVmoney === free + 1500)
    check("a claimed gift isn't sent again", giftMails(A).length === 0)

    // a gift with items: one mail per item, each claimable
    const multi = gifts.find(g => g.items.length >= 3 && g.items.every(x => x.kind !== "chara" && x.kind !== "equip"))
    at(new Date(Date.parse(multi.at) + 60_000).toISOString())
    mails = giftMails(A).filter(m => m.create_time === multi.at.replace("T", " ").replace("Z", ""))
    check(`"${multi.title}": one mail per item`, mails.length === multi.items.length, [mails.length, multi.items.length])
    const firstItem = multi.items.find(x => x.kind === "item")
    const before = firstItem ? (getPlayerItemSync(A, firstItem.typeId) ?? 0) : 0
    cn(() => ProcessAllMails(A))
    check("claiming all gives the items", !firstItem || getPlayerItemSync(A, firstItem.typeId) === before + firstItem.amount, [before, firstItem, getPlayerItemSync(A, firstItem?.typeId)])
    check("... and empties the gift mails", giftMails(A).length === 0)

    // a date jump: only the last 30 days' gifts arrive
    const B = newPlayer()
    const jump = "2024-07-12T00:00:00Z", t = Date.parse(jump)
    at(jump)
    const due = gifts.filter(g => Date.parse(g.at) <= t && Date.parse(g.at) > t - 30 * DAY)
    mails = giftMails(B)
    check("after a jump to 2024-07-12, only gifts from the last 30 days arrive", mails.length === due.reduce((n, g) => n + g.items.length, 0) && due.length > 0, [mails.length, due.map(g => g.title)])
    check("including the 3rd anniversary unit", mails.some(m => m.type === 5 && m.type_id === 231093), mails.map(m => [m.type, m.type_id]))

    // the switch and Remove
    const next = gifts.find(g => Date.parse(g.at) > t + DAY)
    G.setCnGiftRemoved(next.id, true)
    at(new Date(Date.parse(next.at) + 60_000).toISOString())
    check("a removed gift isn't sent", !giftMails(B).some(m => m.subject === next.title && m.create_time === next.at.replace("T", " ").replace("Z", "")))
    G.setCnGiftsOn(false)
    const later = gifts.find(g => Date.parse(g.at) > Date.parse(next.at) + DAY)
    at(new Date(Date.parse(later.at) + 60_000).toISOString())
    check("turned off: no new gifts", !giftMails(B).some(m => m.create_time === later.at.replace("T", " ").replace("Z", "")))
    G.setCnGiftsOn(true)
    G.setCnGiftRemoved(next.id, false)
    check("on again: the next gift arrives", giftMails(B).some(m => m.create_time === later.at.replace("T", " ").replace("Z", "")))

    // the dashboard
    const serverRoutes = (await import(new URL("routes/web_api/server.js", out))).default
    const fastify = require("fastify")()
    await fastify.register(serverRoutes.default ?? serverRoutes)
    await fastify.ready()
    const page = (await fastify.inject({ method: "GET", url: "/mail" })).json()
    check("the Mail tab lists CN's gifts, on", page.cnGifts?.on === true && page.cnGifts.gifts.length === gifts.length, page.cnGifts && [page.cnGifts.on, page.cnGifts.gifts.length])
    const off = (await fastify.inject({ method: "POST", url: "/mail/cn-gifts", payload: { on: false } })).json()
    check("the switch turns them off", off.cnGifts?.on === false)
    const removed = (await fastify.inject({ method: "POST", url: "/mail/cn-gifts", payload: { id: gifts[0].id, removed: true } })).json()
    check("Remove marks a gift removed", removed.cnGifts?.gifts.find(g => g.id === gifts[0].id)?.removed === true)
    const bad = await fastify.inject({ method: "POST", url: "/mail/cn-gifts", payload: { id: 999999, removed: true } })
    check("an unknown gift is refused", bad.statusCode === 400)
    await fastify.close()
} finally {
    process.chdir(os.tmpdir())
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { }
}

console.log(failures ? `\n${failures} CN gift mail test(s) failed.` : "\nAll CN gift mail tests passed.")
process.exit(failures ? 1 : 0)
