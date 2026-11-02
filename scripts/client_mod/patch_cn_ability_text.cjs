// Speeds up the CN client's Units screen (and battle setup): the ability stat code builds every ability's
// full description text for each trigger and stores it in BattleAbilitySource.abilityDescription, which
// only a debug inspector reads. Building that text was about half the Units screen freeze. This drops
// the text (the field stays "") in:
//   BattleCharacterLogic.getAvailableAbilities / getAvailableAbilitiesWithCond
//   AbilitySummarizer.summaryAbilities (static)
// Each `<ability>.getDescription(false)` that feeds `.abilityDescription =` becomes `""`:
//   ... callproperty getDescription,1 ; [coerce String] ; set/initproperty abilityDescription
//   ->  ... pop ; pop ; pushstring "" ; set/initproperty abilityDescription
//
//   node patch_cn_ability_text.cjs <in.swf> <out.swf>
const A = require("./abc.cjs")

const [inSwf, outSwf] = process.argv.slice(2)
if (!outSwf) throw new Error("usage: patch_cn_ability_text.cjs <in.swf> <out.swf>")

const swf = A.readSwf(inSwf)
const tag = swf.tags.filter(t => t.code === 82).find(t => A.splitDoAbc(t.data).name === "boot_ffc6")
if (!tag) throw new Error("main ABC boot_ffc6 not found")
const head = A.splitDoAbc(tag.data)
const abc = A.parseAbc(head.abc)

const TARGETS = [
    ["pinball.common.data.character.BattleCharacterLogic", "getAvailableAbilities", false, 2],
    ["pinball.common.data.character.BattleCharacterLogic", "getAvailableAbilitiesWithCond", false, 2],
    ["pinball.common.data.ability.summary.AbilitySummarizer", "summaryAbilities", true, 2],
]
const empty = A.str(abc, "")
let total = 0
for (const [cls, name, isStatic, expect] of TARGETS) {
    const method = A.findMethod(abc, A.findClass(abc, cls), name, isStatic)
    let n = 0
    A.patchBody(abc, method, list => {
        const out = []
        for (let i = 0; i < list.length; i++) {
            const ins = list[i]
            // the store may come straight after the call or after a `coerce String`
            const next = list[i + 1]?.name === "coerce" ? list[i + 2] : list[i + 1]
            if (ins.name === "callproperty" && A.shortName(abc, ins.args[0]) === "getDescription" && ins.args[1] === 1
                && next && /^(set|init)property$/.test(next.name) && A.shortName(abc, next.args[0]) === "abilityDescription") {
                // keep the instruction object as the first replacement so branch labels pointing at it stay valid
                const pop = A.ins("pop")
                Object.assign(ins, { op: pop.op, name: "pop", args: [] })
                out.push(ins, A.ins("pop"), A.ins("pushstring", empty))
                n++
                continue
            }
            out.push(ins)
        }
        return out
    }, { extraStack: 0 })
    if (n !== expect) throw new Error(`${cls}.${name}: expected ${expect} description calls, found ${n}`)
    total += n
}

tag.data = A.joinDoAbc(head, A.writeAbc(abc))
A.writeSwf(outSwf, swf, false) // uncompressed, like the game's own SWF
console.log(`${total} unused ability text builds removed; wrote ${outSwf}`)
