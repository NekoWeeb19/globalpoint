// Tests the Star Crumb and bond token exchange rules (src/lib/exchange.ts) against the global data,
// without a database.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_exchange.mjs

import { readFileSync } from "node:fs"
import { bondTokenExchangeList, isOffered, planBondTokenExchange, planStarCrumbExchange } from "../out/lib/exchange.js"

const data = JSON.parse(readFileSync(new URL("../assets/exchange.json", import.meta.url), "utf8"))
let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const now = Date.parse("2024-06-02T12:00:00Z")
const nothing = { hasCharacter: () => false, hasEquipment: () => false, itemCount: () => 0 }
const all = Object.entries(data.starCrumb)

// data
check("data: 1215 Star Crumb exchanges (1133 units, 2 items, 80 armaments), 2 bond token armaments",
    all.length === 1215 && all.filter(([_, e]) => e.kind === "character").length === 1133 && all.filter(([_, e]) => e.kind === "item").length === 2 && Object.keys(data.bondToken).length === 2)
check("costs: unit 300/600, item 300/600, armament 200/400", all.every(([_, e]) => e.cost === (e.kind === "equipment" ? 200 : 300) * (e.rarity === 5 ? 2 : 1)))

// Star Crumbs
const unit5 = all.find(([_, e]) => e.kind === "character" && e.rarity === 5 && isOffered(e, now))
const s = planStarCrumbExchange(data, Number(unit5[0]), 1000, nothing, now)
check(`5-star unit (${unit5[1].targetId}): 600 crumbs, 400 left`, s.ok && s.starCrumbAfter === 400 && s.exchange.targetId === unit5[1].targetId, s)
check("an owned unit is refused", !planStarCrumbExchange(data, Number(unit5[0]), 1000, { ...nothing, hasCharacter: () => true }, now).ok)
check("not enough crumbs is refused", !planStarCrumbExchange(data, Number(unit5[0]), 599, nothing, now).ok)
const arm = all.find(([_, e]) => e.kind === "equipment" && isOffered(e, now))
check("an owned armament is refused", planStarCrumbExchange(data, Number(arm[0]), 1000, nothing, now).ok && !planStarCrumbExchange(data, Number(arm[0]), 1000, { ...nothing, hasEquipment: () => true }, now).ok)
check("5-star Astral Gem (9000002): 600, refused at its max count 9999", planStarCrumbExchange(data, 9000002, 600, nothing, now).ok && !planStarCrumbExchange(data, 9000002, 600, { ...nothing, itemCount: () => 9999 }, now).ok)
const ended = all.find(([_, e]) => e.end !== null && Date.parse(e.end.replace(" ", "T") + "Z") < now)
check(`an exchange past its period (${ended?.[0]}) is refused`, ended !== undefined && !planStarCrumbExchange(data, Number(ended[0]), 1000, nothing, now).ok)
check("unknown or malformed ids are refused", !planStarCrumbExchange(data, 1, 1000, nothing, now).ok === !isOffered(data.starCrumb["1"], now) && !planStarCrumbExchange(data, 99999999, 1000, nothing, now).ok && !planStarCrumbExchange(data, "5", 1000, nothing, now).ok && !planStarCrumbExchange(data, 0, 1000, nothing, now).ok)

// bond tokens
const b = planBondTokenExchange(data, 5010005, 60, 0, now)
check("bond tokens: armament 5010005 for 50, 10 left, count 1", b.ok && b.bondTokenAfter === 10 && b.exchangedAfter === 1, b)
check("bond tokens: out of stock after 1", !planBondTokenExchange(data, 5010005, 60, 1, now).ok)
check("bond tokens: not enough tokens", !planBondTokenExchange(data, 5010005, 49, 0, now).ok)
check("bond tokens: unknown armament", !planBondTokenExchange(data, 1234567, 60, 0, now).ok)
check("bond token list: both armaments with their counts", JSON.stringify(bondTokenExchangeList(data, id => id === 5030005 ? 1 : 0, now)) === JSON.stringify([{ equipment_id: 5010005, exchange_count: 0 }, { equipment_id: 5030005, exchange_count: 1 }]))
check("bond token list before 2020-08-28: empty", bondTokenExchangeList(data, () => 0, Date.parse("2020-01-01T00:00:00Z")).length === 0)

console.log(failures === 0 ? "\nAll exchange tests passed." : `\n${failures} exchange test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
