// Centers the early banners' strip-sized summon animations on the CN client's summon screen (see
// as3/starpoint/StripPages.template.as). GachaFeaturePageHolderView.setContent gets one call after it
// adds an animation page: StripPages.place(this, animation). The strip list comes from
// strip_pages.json (scripts/gen_cn_strip_pages.cjs). Runs after patch_cn_coop_lite.cjs in the SWF chain.
//
//   node patch_cn_strip_pages.cjs <in.swf> <out.swf> <work dir> <ffdec-cli.jar> [strip middle]
const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")
const A = require("./abc.cjs")

const [inSwf, outSwf, work, ffdec, middle] = process.argv.slice(2)
if (!ffdec) throw new Error("usage: patch_cn_strip_pages.cjs <in.swf> <out.swf> <work dir> <ffdec-cli.jar> [strip middle]")
fs.mkdirSync(work, { recursive: true })

// 1. write StripPages.as with the list, compile it into a stub SWF
const strips = JSON.parse(fs.readFileSync(path.join(__dirname, "strip_pages.json"), "utf8"))
const src = path.join(work, "as3", "starpoint")
fs.mkdirSync(src, { recursive: true })
const template = fs.readFileSync(path.join(__dirname, "as3", "starpoint", "StripPages.template.as"), "utf8")
fs.writeFileSync(path.join(src, "StripPages.as"), template
    .replace("/*STRIPS*/{}", JSON.stringify(strips))
    .replace("/*MIDDLE*/330", String(Number(middle ?? 330))))
const stub = path.join(work, "strippages_stub.swf"), compiled = path.join(work, "strippages.swf")
execFileSync(process.execPath, [path.join(__dirname, "stub_class.cjs"), stub, "starpoint", "StripPages", "isStrip", "place"], { stdio: "inherit" })
execFileSync("java", ["-jar", ffdec, "-air", "-importScript", stub, compiled, path.join(work, "as3")], { stdio: "inherit" })
const helperTag = A.readSwf(compiled).tags.find(t => t.code === 82)
if (!helperTag) throw new Error("StripPages did not compile")

// 2. hook setContent in the main ABC
const swf = A.readSwf(inSwf)
const abcTags = swf.tags.filter(t => t.code === 82)
let abc = null, mainTag = null
for (const t of abcTags) {
    const d = A.splitDoAbc(t.data)
    if (d.name !== "boot_ffc6") continue
    abc = A.parseAbc(d.abc); mainTag = { tag: t, head: d }
}
if (!abc) throw new Error("main ABC boot_ffc6 not found")
if (abcTags.some(t => A.splitDoAbc(t.data).abc.includes("StripPages"))) throw new Error("this SWF already has StripPages")
const HELPER = A.qname(abc, "starpoint", "StripPages")
const I = A.ins
const method = A.findMethod(abc, A.findClass(abc, "pinball.scene.gacha.featureDisplay.GachaFeaturePageHolderView"), "setContent")
let hooked = 0
A.patchBody(abc, method, list => {
    const get = list.findIndex(i => (i.name === "callproperty" || i.name === "callpropvoid") && A.shortName(abc, i.args[0]) === "getAnimation")
    if (get < 0) throw new Error("setContent: getAnimation call not found")
    // the animation is stored in a local right after the call (maybe after a coerce)
    let k = get + 1
    while (list[k].name.startsWith("coerce") || list[k].name === "convert_o") k++
    if (list[k].name !== "setlocal" && !/^setlocal_\d$/.test(list[k].name)) throw new Error(`setContent: expected setlocal after getAnimation, found ${list[k].name}`)
    const local = list[k].name === "setlocal" ? list[k].args[0] : Number(list[k].name.slice(-1))
    const add = list.findIndex((i, n) => n > k && i.name === "callpropvoid" && A.shortName(abc, i.args[0]) === "addChild")
    if (add < 0) throw new Error("setContent: addChild after getAnimation not found")
    list.splice(add + 1, 0,
        I("getlex", HELPER),
        I("getlocal0"),
        I("getlocal", local),
        I("callpropvoid", A.qname(abc, "", "place"), 2))
    hooked++
    return list
}, { extraStack: 3 })
if (hooked !== 1) throw new Error("setContent not hooked")
console.log(`GachaFeaturePageHolderView.setContent: StripPages.place after the animation page is added (${Object.keys(strips).length} strips)`)

mainTag.tag.data = A.joinDoAbc(mainTag.head, A.writeAbc(abc))
const last = swf.tags.lastIndexOf(abcTags[abcTags.length - 1])
swf.tags.splice(last + 1, 0, { code: 82, data: helperTag.data })
A.writeSwf(outSwf, swf, false) // uncompressed, like the game's own SWF
console.log(`wrote ${outSwf} (${fs.statSync(outSwf).size} bytes)`)
