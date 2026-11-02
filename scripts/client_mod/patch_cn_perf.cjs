// TEST BUILDS ONLY: times chosen CN client functions (as3/starpoint/Perf.as, compiled by FFDec into a
// stub) and sends the totals to the server (GET /cn/perf?d=name:calls:ms,..., in logs/cn_requests.log).
// Used to find what freezes the Events screen.
//
//   node patch_cn_perf.cjs <in.swf> <out.swf> <work dir> <ffdec-cli.jar>
const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")
const A = require("./abc.cjs")

const [inSwf, outSwf, work, ffdec, targetsFile] = process.argv.slice(2)
if (!ffdec) throw new Error("usage: patch_cn_perf.cjs <in.swf> <out.swf> <work dir> <ffdec-cli.jar>")
fs.mkdirSync(work, { recursive: true })

// [class, methods ("*" = every instance method, "new" = the constructor)]. A class starting "re:" is a
// regex over full class names (e.g. "re:^pinball\.scene\.home\."). A JSON file of the same shape can be
// passed as the 5th argument instead of editing this list.
let TARGETS = [
    ["pinball.scene.event.top.EventTopScene", ["*", "new"]],
    ["pinball.scene.event.top.EventTopSceneView", ["*", "new"]],
    ["pinball.common.data.quest.repository.QuestRepository", ["getViewableEvents", "getAllEvents", "getAllEventIds", "getEvent", "getEventList", "getAvailableEventShopSelectItemCampaign"]],
    ["pinball.common.data.event.EventListLogic", ["*"]],
    ["pinball.common.data.event.SideStoryEventListLogic", ["*"]],
    // round 2: the rest of EventTopScene.run
    ["pinball.common.data.collectItem.CollectItemEventRepository", ["*", "new"]],
    ["pinball.common.data.collectItem.CollectItemEventLogic", ["*", "new"]],
    ["pinball.ui.component.list.event.EventListLogic", ["*", "new"]],
    ["pinball.ui.component.list.event.adapter.EventListAdapter", ["*", "new"]],
    ["pinball.common.data.localStore.MiscDataLogic", ["setCompletedInduce"]],
    ["pinball.tutorial.triggeredTutorial.TriggeredTutorialManager", ["setEnterSceneTriggerOnTriggeredTutorialEnd", "startEnterSceneTriggeredTutorial"]],
    // round 3: inside EventListAdapter.convertEvent
    ["pinball.common.data.campaign.CampaignRepository", ["*"]],
    ["pinball.common.data.quest.event.common.EventLogicBase", ["*"]],
]

if (targetsFile) TARGETS = JSON.parse(fs.readFileSync(targetsFile, "utf8"))

// 1. compile Perf into a stub SWF
const stub = path.join(work, "perf_stub.swf"), compiled = path.join(work, "perf.swf")
execFileSync(process.execPath, [path.join(__dirname, "stub_class.cjs"), stub, "starpoint", "Perf", "begin", "end", "flush", "ignore"], { stdio: "inherit" })
execFileSync("java", ["-jar", ffdec, "-air", "-importScript", stub, compiled, path.join(__dirname, "as3")], { stdio: "inherit" })
const perfTag = A.readSwf(compiled).tags.find(t => t.code === 82)
if (!perfTag) throw new Error("Perf did not compile")

// 2. hook the targets in the main ABC
const swf = A.readSwf(inSwf)
const abcTags = swf.tags.filter(t => t.code === 82)
let abc = null, mainTag = null
for (const t of abcTags) {
    const d = A.splitDoAbc(t.data)
    if (d.name !== "boot_ffc6") continue
    abc = A.parseAbc(d.abc); mainTag = { tag: t, head: d }
}
if (!abc) throw new Error("main ABC boot_ffc6 not found")
const PERF = A.qname(abc, "starpoint", "Perf")
const fn = name => A.qname(abc, "", name)
const I = A.ins
const hooked = []

function hook(methodIndex, label) {
    const id = A.str(abc, label)
    A.patchBody(abc, methodIndex, list => {
        const k = list.findIndex(i => i.name === "pushscope")
        const begin = [I("getlex", PERF), I("pushstring", id), I("callpropvoid", fn("begin"), 1)]
        if (k >= 0 && k <= 2) A.insertAfter(list, list[k], begin)
        else list.unshift(...begin)
        for (const ret of list.filter(i => i.name === "returnvalue" || i.name === "returnvoid")) {
            A.insertBefore(list, ret, [I("getlex", PERF), I("pushstring", id), I("callpropvoid", fn("end"), 1)])
        }
        return list
    }, { extraStack: 3 })
    hooked.push(label)
}

const seen = new Set()
const classesOf = cls => {
    if (!cls.startsWith("re:")) return [[A.findClass(abc, cls), cls]]
    const re = new RegExp(cls.slice(3))
    return abc.instances.map((inst, i) => [i, A.mnName(abc, inst.name)]).filter(([, n]) => re.test(n))
}
for (const [pattern, methods] of TARGETS) for (const [ci, cls] of classesOf(pattern)) {
    const short = cls.split(".").pop()
    const inst = abc.instances[ci]
    for (const m of methods) {
        if (m === "new") {
            if (!seen.has(inst.iinit) && abc.bodyOf.get(inst.iinit)) { seen.add(inst.iinit); hook(inst.iinit, `${short}.new`) }
            continue
        }
        const traits = inst.traits.filter(t => t.kind === 1 && (m === "*" || A.shortName(abc, t.name) === m))
        if (traits.length === 0 && !pattern.startsWith("re:")) throw new Error(`${cls}.${m}: not found`)
        for (const t of traits) {
            if (seen.has(t.method) || !abc.bodyOf.get(t.method)) continue
            seen.add(t.method); hook(t.method, `${short}.${A.shortName(abc, t.name)}`)
        }
    }
}

mainTag.tag.data = A.joinDoAbc(mainTag.head, A.writeAbc(abc))
const last = swf.tags.lastIndexOf(abcTags[abcTags.length - 1])
swf.tags.splice(last + 1, 0, { code: 82, data: perfTag.data })
A.writeSwf(outSwf, swf, false) // uncompressed, like the game's own SWF
console.log(`${hooked.length} functions timed; wrote ${outSwf} (${fs.statSync(outSwf).size} bytes)`)
