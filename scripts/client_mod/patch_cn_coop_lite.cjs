// Makes the CN client's Lite Mode apply to co-op battles only. The game sets each battle's lightweight
// level from the options (Battle.preparation: Lite Mode off 0, on 1, on + "Abbreviate Multiplayer
// Notifications" 2). Level 2 hides the partners' skill animations, trails, multiballs and other extras,
// which saves frames in co-op, where this device also runs the partners' battles. This sets the level
// right after: 2 in co-op and raid battles (playerMode not solo), 0 in solo, whatever the options say,
// so solo keeps every effect.
//   this.lightweightModeLevel = playerMode.index != 0 ? 2 : 0
//
//   node patch_cn_coop_lite.cjs <in.swf> <out.swf>
const A = require("./abc.cjs")

const [inSwf, outSwf] = process.argv.slice(2)
if (!outSwf) throw new Error("usage: patch_cn_coop_lite.cjs <in.swf> <out.swf>")

const swf = A.readSwf(inSwf)
const tag = swf.tags.filter(t => t.code === 82).find(t => A.splitDoAbc(t.data).name === "boot_ffc6")
if (!tag) throw new Error("main ABC boot_ffc6 not found")
const head = A.splitDoAbc(tag.data)
const abc = A.parseAbc(head.abc)
const I = A.ins

const ci = A.findClass(abc, "pinball.scene.battle.battle.Battle")
// the property names as this class's own code writes them (playerMode.index, from __isRichMode__)
const rich = A.decode(abc.bodyOf.get(A.findMethod(abc, ci, "__isRichMode__")).code)
const mn = (name, op) => {
    const ins = rich.find(i => i.name === op && A.shortName(abc, i.args[0]) === name)
    if (!ins) throw new Error(`${op} ${name} not found in __isRichMode__`)
    return ins.args[0]
}
const findPlayerMode = mn("playerMode", "findproperty"), getPlayerMode = mn("playerMode", "getproperty"), getIndex = mn("index", "getproperty")

let n = 0
A.patchBody(abc, A.findMethod(abc, ci, "preparation"), list => {
    const k = list.findIndex(i => i.name === "initproperty" && A.shortName(abc, i.args[0]) === "lightweightModeLevel")
    if (k < 0) throw new Error("lightweightModeLevel assignment not found")
    const find = list.slice(0, k).reverse().find(i => i.name === "findproperty" && A.shortName(abc, i.args[0]) === "lightweightModeLevel")
    if (!find) throw new Error("findproperty lightweightModeLevel not found")
    const solo = I("pushbyte", 0)
    const set = I("initproperty", list[k].args[0])
    A.insertAfter(list, list[k], [
        I("findproperty", find.args[0]),
        I("findproperty", findPlayerMode), I("getproperty", getPlayerMode), I("getproperty", getIndex),
        I("pushbyte", 0), I("ifeq", solo),
        I("pushbyte", 2), I("jump", set),
        solo,
        set,
    ])
    n++
    return list
}, { extraStack: 4 })
if (n !== 1) throw new Error("patch not applied")

tag.data = A.joinDoAbc(head, A.writeAbc(abc))
A.writeSwf(outSwf, swf, false) // uncompressed, like the game's own SWF
console.log(`Battle.preparation: lightweight level = co-op ? 2 : 0; wrote ${outSwf}`)
