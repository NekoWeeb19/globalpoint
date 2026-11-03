// Lets the CN client take its game files from a drop-off folder instead of downloading them (see
// as3/starpoint/StorageDropoff.as). AssetExtractor.start (the first loading step, before any downloaded
// file is read) now begins with:
//     var r = StorageDropoff.start(this); if (r) return r;
// StorageDropoff moves the files from /sdcard/StarPoint/game/ and Android/obb/com.leiting.wf/ into
// Local Store/asset/asset_download/dummy/ and then runs start() itself. Runs after
// patch_cn_strip_pages.cjs in the SWF chain. The APK also needs manifest_storage.py (storage permissions).
//
//   node patch_cn_storage_dropoff.cjs <in.swf> <out.swf> <work dir> <ffdec-cli.jar>
const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")
const A = require("./abc.cjs")

const [inSwf, outSwf, work, ffdec] = process.argv.slice(2)
if (!ffdec) throw new Error("usage: patch_cn_storage_dropoff.cjs <in.swf> <out.swf> <work dir> <ffdec-cli.jar>")
fs.mkdirSync(work, { recursive: true })

// 1. compile StorageDropoff into a stub SWF
const stub = path.join(work, "storagedropoff_stub.swf"), compiled = path.join(work, "storagedropoff.swf")
execFileSync(process.execPath, [path.join(__dirname, "stub_class.cjs"), stub, "starpoint", "StorageDropoff", "start"], { stdio: "inherit" })
execFileSync("java", ["-jar", ffdec, "-air", "-importScript", stub, compiled, path.join(__dirname, "as3")], { stdio: "inherit" })
const helperTag = A.readSwf(compiled).tags.find(t => t.code === 82)
if (!helperTag || !A.splitDoAbc(helperTag.data).abc.includes("asset/asset_download/dummy")) throw new Error("StorageDropoff did not compile")

// 2. hook AssetExtractor.start in the main ABC
const swf = A.readSwf(inSwf)
const abcTags = swf.tags.filter(t => t.code === 82)
let abc = null, mainTag = null
for (const t of abcTags) {
    const d = A.splitDoAbc(t.data)
    if (d.name !== "boot_ffc6") continue
    abc = A.parseAbc(d.abc); mainTag = { tag: t, head: d }
}
if (!abc) throw new Error("main ABC boot_ffc6 not found")
if (abcTags.some(t => A.splitDoAbc(t.data).abc.includes("StorageDropoff"))) throw new Error("this SWF already has StorageDropoff")
const HELPER = A.qname(abc, "starpoint", "StorageDropoff")
const I = A.ins
const method = A.findMethod(abc, A.findClass(abc, "pinball.loading.initial.AssetExtractor"), "start")
A.patchBody(abc, method, list => {
    if (list[0].name !== "getlocal0" || list[1].name !== "pushscope") throw new Error(`start: unexpected prologue ${list[0].name} ${list[1].name}`)
    // stack: r ; dup ; iffalse -> pop and go on ; else return r
    const go = I("pop")
    return [
        list[0], list[1],
        I("getlex", HELPER),
        I("getlocal0"),
        I("callproperty", A.qname(abc, "", "start"), 1),
        I("dup"),
        I("iffalse", go),
        I("returnvalue"),
        go,
        ...list.slice(2),
    ]
}, { extraStack: 2 })
console.log("AssetExtractor.start: StorageDropoff.start(this) first")

mainTag.tag.data = A.joinDoAbc(mainTag.head, A.writeAbc(abc))
const last = swf.tags.lastIndexOf(abcTags[abcTags.length - 1])
swf.tags.splice(last + 1, 0, { code: 82, data: helperTag.data })
A.writeSwf(outSwf, swf, false) // uncompressed, like the game's own SWF
console.log(`wrote ${outSwf} (${fs.statSync(outSwf).size} bytes)`)
