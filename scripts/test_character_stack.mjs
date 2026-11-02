// Tests the select-all uncap and convert rules (src/lib/characterStack.ts) without a database.
//
// Compile first, because this loads the compiled code from out/:
//   npx tsc
//   node scripts/test_character_stack.mjs

import { selectBulkConversions, selectBulkOverLimits, stackConversion } from "../out/lib/characterStack.js"

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const MAX = { 1: 12, 2: 10, 3: 8, 4: 6, 5: 4 }
const unit = (characterId, rarity, stack, overLimitStep, protection = false) => ({ characterId, rarity, stack, overLimitStep, protection })

// convert amounts
check("a 5* copy gives 10,000 EXP and 30 items", JSON.stringify(stackConversion(1, 5, 1)) === JSON.stringify({ characterId: 1, count: 1, exp: 10000, items: 30 }))
check("three 3* copies give 1,500 EXP and 6 items", stackConversion(1, 3, 3).exp === 1500 && stackConversion(1, 3, 3).items === 6)
check("an unknown rarity can't convert", stackConversion(1, 9, 1) === null)

// select all -> convert
const roster = [
    unit(101, 5, 2, 4),        // fully uncapped, 2 spare copies -> converted
    unit(102, 5, 3, 2),        // not fully uncapped -> kept for uncapping
    unit(103, 4, 1, 6, true),  // fully uncapped but locked -> kept
    unit(104, 3, 0, 8),        // no copies
    unit(105, 1, 5, 12),       // fully uncapped 1* -> converted
]
const conversions = selectBulkConversions(roster, MAX)
check("convert all: only fully uncapped, unlocked units with copies (101, 105)", JSON.stringify(conversions.map(c => c.characterId)) === "[101,105]", conversions)
check("convert all: every spare copy is used (101: 2 copies = 20,000 EXP)", conversions[0].count === 2 && conversions[0].exp === 20000, conversions[0])
check("convert all: nothing to convert gives nothing", selectBulkConversions([unit(1, 5, 0, 4)], MAX).length === 0)

// select all -> uncap
const uncaps = selectBulkOverLimits(roster, MAX)
check("uncap all: only units below their max with copies (102)", JSON.stringify(uncaps.map(u => u.characterId)) === "[102]", uncaps)
check("uncap all: 5* at 2/4 with 3 copies goes to 4/4 and keeps 1 copy", uncaps[0].overLimitStep === 4 && uncaps[0].stack === 1, uncaps[0])
check("uncap all: a 4* at 0/6 with 2 copies goes to 2/6 with 0 left", JSON.stringify(selectBulkOverLimits([unit(7, 4, 2, 0)], MAX)) === JSON.stringify([{ characterId: 7, overLimitStep: 2, stack: 0 }]))
check("uncap all: a locked unit still uncaps (locking only stops conversion)", selectBulkOverLimits([unit(8, 5, 1, 0, true)], MAX).length === 1)
check("uncap all: never past the max", selectBulkOverLimits([unit(9, 2, 50, 3)], MAX)[0].overLimitStep === 10)

console.log(failures === 0 ? "\nAll character stack tests passed." : `\n${failures} character stack test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
