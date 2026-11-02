// Patches the global game client's code (worldflipper_android_release.swf):
//   - adds the StarPoint battle log class (as3/starpoint/BattleLog.as, compiled by FFDec into a stub)
//   - hooks it into the battle code: buffs added/removed, instant abilities firing, dash gauge refill
//   - turns off the root check and gxshield's "Detected cheating" force-quit (a re-signed app trips them)
//
//   node patch_swf.cjs <original.swf> <out.swf> <work dir> <ffdec-cli.jar>

const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")
const A = require("./abc.cjs")

const [inSwf, outSwf, work, ffdec] = process.argv.slice(2)
if (!ffdec) throw new Error("usage: patch_swf.cjs <original.swf> <out.swf> <work dir> <ffdec-cli.jar>")
fs.mkdirSync(work, { recursive: true })

// The global 0.0.81 client's class and package names are obfuscated (unicode dashes), but member names
// are kept, so each class is found by member names only it has (names from the community decompile,
// github dennis96292/wf-0.0.81-en-decompiled).
const CLASSES = {
    ball: ["escapePoint", "isFlyingMove", "playheadEscapeMarkerAnimation"], // BallImpl
    conditionSlot: ["setCondition", "removeCondition", "isFlying", "applyConditionChange"], // ConditionSlot
    instantAbility: ["applyAccumulation", "addCooltimeHandler", "forceExecuteDelayHandler", "apply"], // InstantAbility
    crackDetector: ["check", "devConfig"], // AndroidCrackDetector (also needs exactly these two)
    gxShieldDialog: ["scanriskHandler", "set_gxshield", "update"], // gxshield scanrisk dialog
}
const EXACT = new Set(["crackDetector"])

// 1. compile BattleLog into a stub SWF with FFDec
const stub = path.join(work, "battlelog_stub.swf"), compiled = path.join(work, "battlelog.swf")
execFileSync(process.execPath, [path.join(__dirname, "stub_class.cjs"), stub, "starpoint", "BattleLog",
    "log", "flush", "ignore", "show", "member", "condSet", "condRemove", "ability", "dashRate"], { stdio: "inherit" })
execFileSync("java", ["-jar", ffdec, "-air", "-importScript", stub, compiled, path.join(__dirname, "as3")], { stdio: "inherit" })
const logTag = A.readSwf(compiled).tags.find(t => t.code === 82)
if (!logTag) throw new Error("BattleLog did not compile")

// 2. patch the game's main ABC (the one with the battle classes)
const swf = A.readSwf(inSwf)
const abcTags = swf.tags.filter(t => t.code === 82)
let main = null, mainTag = null
for (const t of abcTags) {
    const d = A.splitDoAbc(t.data)
    if (d.abc.length < 1_000_000) continue
    main = A.parseAbc(d.abc); mainTag = { tag: t, head: d }
    break
}
if (!main) throw new Error("main ABC not found")
const abc = main
const LOG = A.qname(abc, "starpoint", "BattleLog")
const fn = name => A.qname(abc, "", name)
const I = A.ins
const done = []

const classIndex = {}
for (const [key, names] of Object.entries(CLASSES)) {
    const hits = []
    abc.instances.forEach((inst, i) => {
        const own = new Set(inst.traits.map(t => A.shortName(abc, t.name)))
        if (!names.every(n => own.has(n))) return
        if (EXACT.has(key) && own.size !== names.length) return
        hits.push(i)
    })
    if (hits.length !== 1) throw new Error(`class ${key}: ${hits.length} matches`)
    classIndex[key] = hits[0]
}
A.findClass = (_, key) => classIndex[key]

/** insert after the method's opening "getlocal0; pushscope" */
function atStart(classKey, method, code) {
    const ci = A.findClass(abc, classKey)
    const mi = A.findMethod(abc, ci, method)
    A.patchBody(abc, mi, list => {
        const k = list.findIndex(i => i.name === "pushscope")
        if (k < 0 || k > 2) throw new Error(`${classKey}.${method}: no pushscope at start`)
        return A.insertAfter(list, list[k], code())
    })
    done.push(`${classKey}.${method}: hook at start`)
}

/** replace a method's whole code (exceptions dropped) */
function replaceCode(classKey, method, code) {
    const ci = A.findClass(abc, classKey)
    const mi = A.findMethod(abc, ci, method)
    const body = abc.bodyOf.get(mi)
    const list = [I("getlocal0"), I("pushscope"), ...code()]
    body.code = A.encode(list).code
    body.exceptions = []
    body.maxStack = Math.max(body.maxStack, 2)
    done.push(`${classKey}.${method}: replaced`)
}

// buffs
atStart("conditionSlot", "setCondition", () => [I("getlex", LOG), I("getlocal0"), I("getlocal1"), I("getlocal2"), I("callpropvoid", fn("condSet"), 3)])
atStart("conditionSlot", "removeCondition", () => [I("getlex", LOG), I("getlocal0"), I("getlocal1"), I("callpropvoid", fn("condRemove"), 2)])
// abilities
atStart("instantAbility", "apply", () => [I("getlex", LOG), I("getlocal0"), I("getlocal2"), I("callpropvoid", fn("ability"), 2)])

// dash gauge refill: escapePoint.add(1 / (isFlyingMove() ? 60 : 90)) -> escapePoint.add(BattleLog.dashRate(this, rate))
{
    const ci = A.findClass(abc, "ball")
    const escape = "escapePoint", add = "add"
    let hits = 0
    for (const t of abc.instances[ci].traits) {
        if (t.kind !== 1) continue
        const body = abc.bodyOf.get(t.method)
        if (!body) continue
        const list = A.decode(body.code)
        // getproperty escapePoint ... callpropvoid add, 1 with "divide" right before the call
        const k = list.findIndex((i, n) => i.name === "callpropvoid" && A.shortName(abc, i.args[0]) === add && i.args[1] === 1 &&
            list[n - 1]?.name === "divide" && list.slice(Math.max(0, n - 12), n).some(x => x.name === "getproperty" && A.shortName(abc, x.args[0]) === escape))
        if (k < 0) continue
        A.patchBody(abc, t.method, l => {
            const call = l.find((i, n) => i.offset === list[k].offset)
            return A.insertBefore(l, call, [I("getlex", LOG), I("swap"), I("getlocal0"), I("callproperty", fn("dashRate"), 2)])
        })
        hits++
        done.push(`ball.${A.shortName(abc, t.name)}: dash refill hook`)
    }
    if (hits !== 1) throw new Error(`dash refill: ${hits} matches`)
}

// anti-cheat off
replaceCode("crackDetector", "check", () => [I("pushbyte", 0), I("returnvalue")])
replaceCode("gxShieldDialog", "update", () => [I("returnvoid")])
replaceCode("gxShieldDialog", "scanriskHandler", () => [I("returnvoid")])

mainTag.tag.data = A.joinDoAbc(mainTag.head, A.writeAbc(abc))

// 3. add the BattleLog ABC after the last DoABC tag
const last = swf.tags.lastIndexOf(abcTags[abcTags.length - 1])
swf.tags.splice(last + 1, 0, { code: 82, data: logTag.data })
A.writeSwf(outSwf, swf)
console.log(done.join("\n"))
console.log(`wrote ${outSwf} (${fs.statSync(outSwf).size} bytes)`)
