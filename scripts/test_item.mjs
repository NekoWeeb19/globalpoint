// Tests the item use and sell rules (src/lib/item.ts) against the global item table, without a database.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_item.mjs

import { readFileSync } from "node:fs"
import { ITEM_RESULT_CODES, MAX_STAMINA_OVERFLOW, isItemInPeriod, parseUseItems, planItemSale, planItemUse } from "../out/lib/item.js"

const rules = JSON.parse(readFileSync(new URL("../assets/item_rules.json", import.meta.url), "utf8"))
let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const now = Date.parse("2026-10-30T12:00:00Z")
const has = n => () => n

// data
const items = rules.items
check("data: 1022 items, 71 stamina items, 786 sellable", Object.keys(items).length === 1022 && Object.values(items).filter(i => i.effectKind === 2).length === 71 && Object.values(items).filter(i => i.sellable).length === 786)
check("data: Staminade Swig (101) recovers 25, can't be sold", items["101"].stamina === 25 && !items["101"].sellable)
check("data: Ember Element (1) sells for 5 mana", items["1"].sellable && items["1"].salePrice === 5)

// request parsing
check("parse: entries merged per item", JSON.stringify(parseUseItems([{ id: 101, number: 2 }, { id: 101, number: 1 }, { id: 102, number: 1 }])) === JSON.stringify([{ id: 101, count: 3 }, { id: 102, count: 1 }]))
check("parse: empty, zero, negative, fractional or not a list -> null", [[], [{ id: 101, number: 0 }], [{ id: 101, number: -1 }], [{ id: 101, number: 1.5 }], [{ id: "101", number: 1 }], null, {}].every(x => parseUseItems(x) === null))

// using
const use = (reqs, owned, stamina) => planItemUse(rules, reqs, owned, stamina, now)
const swig = use([{ id: 101, count: 2 }], has(5), 100)
check("use: 2 Swigs on 100 stamina -> 150", swig.ok && swig.staminaAfter === 150 && swig.spend[0].count === 2)
check("use: capped at 999", use([{ id: 106, count: 20 }], has(20), 50).staminaAfter === MAX_STAMINA_OVERFLOW)
check("use: at 999 -> code 2102 (already max)", use([{ id: 101, count: 1 }], has(1), 999).resultCode === ITEM_RESULT_CODES.STAMINA_ALREADY_MAX)
check("use: not enough owned -> refused, no code", (r => !r.ok && r.resultCode === undefined)(use([{ id: 101, count: 3 }], has(2), 10)))
check("use: a non-stamina item (Astral Gem) -> refused", !use([{ id: 10001, count: 1 }], has(5), 10).ok)
check("use: unknown item -> refused", !use([{ id: 99999999, count: 1 }], has(5), 10).ok)
const expired = Object.entries(items).find(([_, i]) => i.effectKind === 2 && i.end !== null && Date.parse(i.end.replace(" ", "T") + "Z") < now)
check("use: an expired limited-time Swig -> code 2057 (" + (expired && expired[0]) + ")", expired !== undefined && use([{ id: Number(expired[0]), count: 1 }], has(1), 10).resultCode === ITEM_RESULT_CODES.USE_OUT_OF_PERIOD)
check("period: start included, before start not", isItemInPeriod({ start: "2020-01-01 00:00:00", end: null }, Date.parse("2020-01-01T00:00:00Z")) && !isItemInPeriod({ start: "2020-01-01 00:00:00", end: null }, Date.parse("2019-12-31T23:59:59Z")))

// selling
const sell = (id, count, owned, mana = 0) => planItemSale(rules, id, count, owned, mana, now)
const ember = sell(1, 10, 25)
check("sell: 10 Ember Elements -> 50 mana, 15 left", ember.ok && ember.mana === 50 && ember.countAfter === 15)
check("sell: unsellable (Swig) -> refused", !sell(101, 1, 5).ok)
check("sell: more than owned -> refused", !sell(1, 30, 25).ok)
check("sell: bad numbers -> refused", !sell(1, 0, 25).ok && !sell(1, -2, 25).ok && !sell("1", 1, 25).ok && !sell(1, 1.5, 25).ok)
const soul = Object.keys(items).find(id => items[id].category === 5 && items[id].sellable)
check("sell: ability souls keep 3 (" + soul + ")", sell(Number(soul), 2, 5).ok && !sell(Number(soul), 3, 5).ok)
check("sell: mana past the client's limit -> refused", !sell(1, 10, 25, 2_147_483_640).ok)

console.log(failures === 0 ? "\nAll item tests passed." : `\n${failures} item test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
