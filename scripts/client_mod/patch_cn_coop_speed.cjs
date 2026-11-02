// Lets the CN client's co-op battles run faster than 1x. The game starts multi (co-op) battles and raid
// battles with their allowed auto speed hard-coded to 1 (MultiQuestStartLoadingTask.remoteFinishedHandler,
// RaidBattleStartFlow.remoteFinishedHandler: new BattleAutoplayData(auto, skillMode, speed, 1)), so the
// AUTO button only cycles x1 -> off. This makes the allowed level 3: the button then cycles
// x1 -> x2 -> x3 -> off, the same as solo battles with auto 3x.
// Co-op battles also run the partners' battles on this device, so a faster speed costs more CPU per
// frame; on a slow device the frame rate (and with it the real speed) gains less than the number.
//
//   node patch_cn_coop_speed.cjs <in.swf> <out.swf>
const A = require("./abc.cjs")

const [inSwf, outSwf] = process.argv.slice(2)
if (!outSwf) throw new Error("usage: patch_cn_coop_speed.cjs <in.swf> <out.swf>")

const ALLOWED = 3
const swf = A.readSwf(inSwf)
const tag = swf.tags.filter(t => t.code === 82).find(t => A.splitDoAbc(t.data).name === "boot_ffc6")
if (!tag) throw new Error("main ABC boot_ffc6 not found")
const head = A.splitDoAbc(tag.data)
const abc = A.parseAbc(head.abc)

const TARGETS = [
    ["pinball.loading.battle.MultiQuestStartLoadingTask", "remoteFinishedHandler"],
    ["pinball.loading.battle.raid.RaidBattleStartFlow", "remoteFinishedHandler"],
]
for (const [cls, name] of TARGETS) {
    const method = A.findMethod(abc, A.findClass(abc, cls), name)
    let n = 0
    A.patchBody(abc, method, list => {
        for (let i = 1; i < list.length; i++) {
            const ins = list[i], prev = list[i - 1]
            if (ins.name === "constructprop" && A.mnName(abc, ins.args[0]) === "pinball.common.data.battle.BattleAutoplayData" && ins.args[1] === 4) {
                // the 4th argument (allowed speed) is the last value pushed: a constant 1
                if (prev.name !== "pushbyte" || prev.args[0] !== 1) throw new Error(`${cls}.${name}: allowed speed isn't a constant 1 (${prev.name} ${prev.args})`)
                prev.args = [ALLOWED]
                n++
            }
        }
        return list
    }, { extraStack: 0 })
    if (n !== 1) throw new Error(`${cls}.${name}: expected 1 BattleAutoplayData, found ${n}`)
    console.log(`${cls.split(".").pop()}.${name}: allowed auto speed 1 -> ${ALLOWED}`)
}

tag.data = A.joinDoAbc(head, A.writeAbc(abc))
A.writeSwf(outSwf, swf, false) // uncompressed, like the game's own SWF
console.log(`wrote ${outSwf}`)
