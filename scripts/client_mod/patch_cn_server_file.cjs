// Lets the CN client take its server address from a server.txt file on the phone (see
// as3/starpoint/ServerAddress.as), so a phone can play against a PC's StarPoint over plain Wi-Fi.
// The addresses patch_cn_client.cjs baked in become calls that fall back to them:
//   DevConfig_gf_android: pushstring "<host:port>/cn"            -> ServerAddress.apiHost("<host:port>/cn")
//   GbitsVersionLogic:    pushstring "http://<host:port>/cn/shijtswy/version/" -> ServerAddress.versionUrl(...)
//   TitleView.run:        the version text gets ServerAddress.titleLine() in front ("Server: x\n" or "")
// The CDN and patch downloads need nothing: the server builds their addresses from the address the game
// used. Co-op's battle address comes from the server's replies. Runs after patch_cn_storage_dropoff.cjs.
//
//   node patch_cn_server_file.cjs <in.swf> <out.swf> <work dir> <ffdec-cli.jar>
const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")
const A = require("./abc.cjs")

const [inSwf, outSwf, work, ffdec] = process.argv.slice(2)
if (!ffdec) throw new Error("usage: patch_cn_server_file.cjs <in.swf> <out.swf> <work dir> <ffdec-cli.jar>")
fs.mkdirSync(work, { recursive: true })

// 1. compile ServerAddress into a stub SWF
const stub = path.join(work, "serveraddress_stub.swf"), compiled = path.join(work, "serveraddress.swf")
execFileSync(process.execPath, [path.join(__dirname, "stub_class.cjs"), stub, "starpoint", "ServerAddress", "apiHost", "versionUrl", "titleLine"], { stdio: "inherit" })
execFileSync("java", ["-jar", ffdec, "-air", "-importScript", stub, compiled, path.join(__dirname, "as3")], { stdio: "inherit" })
const helperTag = A.readSwf(compiled).tags.find(t => t.code === 82)
if (!helperTag || !A.splitDoAbc(helperTag.data).abc.includes("server.txt")) throw new Error("ServerAddress did not compile")

// 2. the main ABC
const swf = A.readSwf(inSwf)
const abcTags = swf.tags.filter(t => t.code === 82)
let abc = null, mainTag = null
for (const t of abcTags) {
    const d = A.splitDoAbc(t.data)
    if (d.name !== "boot_ffc6") continue
    abc = A.parseAbc(d.abc); mainTag = { tag: t, head: d }
}
if (!abc) throw new Error("main ABC boot_ffc6 not found")
if (abcTags.some(t => A.splitDoAbc(t.data).abc.includes("ServerAddress"))) throw new Error("this SWF already has ServerAddress")
const HELPER = A.qname(abc, "starpoint", "ServerAddress")
const I = A.ins
const call = (name, args) => I("callproperty", A.qname(abc, "", name), args)
// turns "pushstring baked" into "getlex ServerAddress ; pushstring baked ; callproperty fn(1)", keeping the
// original instruction object first (as getlex) so any branch that lands on it still lands right
const wrap = (out, op, fn) => {
    const value = op.args[0]
    Object.assign(op, { op: I("getlex", HELPER).op, name: "getlex", args: [HELPER] })
    out.push(op, I("pushstring", value), call(fn, 1))
}

// the baked strings: the version URL is "http://<api host>/shijtswy/version/"
const versionUrl = abc.strings.find(s => s && /^http:\/\/.+\/shijtswy\/version\/$/.test(s))
if (!versionUrl) throw new Error("no patched version URL (run patch_cn_client.cjs first)")
const apiHost = versionUrl.slice("http://".length, -"/shijtswy/version/".length)
console.log(`baked: api host ${apiHost}, version check ${versionUrl}`)

const swaps = { apiHost: 0, versionUrl: 0 }
const swap = (cls, method, value, fn) => {
    const m = A.findMethod(abc, A.findClass(abc, cls), method)
    A.patchBody(abc, m, list => {
        const out = []
        for (const op of list) {
            if (op.name === "pushstring" && abc.strings[op.args[0]] === value) {
                wrap(out, op, fn)
                swaps[fn]++
            } else out.push(op)
        }
        return out
    }, { extraStack: 2 })
}
const devConfig = A.findClass(abc, "pinball.config.gbits.DevConfig_gf_android")
const devInit = abc.instances[devConfig].iinit
A.patchBody(abc, devInit, list => {
    const out = []
    for (const op of list) {
        if (op.name === "pushstring" && abc.strings[op.args[0]] === apiHost) {
            wrap(out, op, "apiHost")
            swaps.apiHost++
        } else out.push(op)
    }
    return out
}, { extraStack: 2 })
swap("pinball.gbits.logic.GbitsVersionLogic", "queryVersion", versionUrl, "versionUrl")
swap("pinball.gbits.logic.GbitsVersionLogic", "onQueryErrorDefault", versionUrl, "versionUrl")
if (swaps.apiHost !== 1 || swaps.versionUrl !== 2) throw new Error("patch points not found: " + JSON.stringify(swaps))

// 3. title screen: titleLine() + GbitsQueryVersion.GetVersionView() + "\nBusVer..." ...
const run = A.findMethod(abc, A.findClass(abc, "pinball.scene.title.TitleView"), "run")
let titled = false
A.patchBody(abc, run, list => {
    const at = list.findIndex((op, k) => op.name === "callproperty" && A.mnName(abc, op.args[0]).endsWith("GetVersionView")
        && list[k - 1]?.name === "getlex" && list[k + 1]?.name === "coerce")
    if (at < 1) throw new Error("TitleView.run: GetVersionView not found")
    titled = true
    // stack: line ; view -> line + view
    return [
        ...list.slice(0, at - 1),
        I("getlex", HELPER), call("titleLine", 0),
        list[at - 1], list[at], list[at + 1],
        I("add"), I("coerce_s"),
        ...list.slice(at + 2),
    ]
}, { extraStack: 2 })
if (!titled) throw new Error("title line not added")
console.log(`ServerAddress: api host x${swaps.apiHost}, version URL x${swaps.versionUrl}, title line`)

mainTag.tag.data = A.joinDoAbc(mainTag.head, A.writeAbc(abc))
const last = swf.tags.lastIndexOf(abcTags[abcTags.length - 1])
swf.tags.splice(last + 1, 0, { code: 82, data: helperTag.data })
A.writeSwf(outSwf, swf, false) // uncompressed, like the game's own SWF
console.log(`wrote ${outSwf} (${fs.statSync(outSwf).size} bytes)`)
