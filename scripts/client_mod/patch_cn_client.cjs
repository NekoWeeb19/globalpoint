// Patches the official CN 1.8.1 client SWF to play on a private server (the same two changes the
// startpoint-cn project makes, done on the bytecode instead of a decompile):
//   1. DevConfig.sdkDummy = true   (skips the Leiting SDK login; uses a dummy user id)
//   2. DevConfig_gf_android api server "https://shijtswygamegf.leiting.com" -> "http://<host:port>"
//   3. the version check (update.leiting.com / update.roguelike.com) -> "http://<host:port>/shijtswy/version/"
// For StarPoint, <host:port> ends in /cn (e.g. 127.0.0.1:8000/cn), see src/lib/cnClient.ts.
//
//   node patch_cn_client.cjs <in.swf> <out.swf> <host:port>
const A = require("./abc.cjs")

const [input, output, host] = process.argv.slice(2)
if (!input || !output || !host) throw new Error("usage: patch_cn_client.cjs <in.swf> <out.swf> <host:port>")

const VERSION_URLS = ["https://update.leiting.com/shijtswy/version/", "https://update.roguelike.com/shijtswy/version/"]
const swf = A.readSwf(input)
const done = { sdkDummy: false, server: false, version: 0 }

for (const tag of swf.tags) {
    if (tag.code !== 82) continue
    const doAbc = A.splitDoAbc(tag.data)
    const abc = A.parseAbc(doAbc.abc)
    let changed = false

    for (const body of abc.bodies) {
        const code = A.decode(body.code)
        // 1. the static initializer's "DevConfig.sdkDummy = false"
        const dummyAt = code.findIndex((op, k) => op.name === "initproperty" && A.mnName(abc, op.args[0]).endsWith("sdkDummy")
            && code[k - 1]?.name === "pushfalse")
        if (dummyAt > 0) {
            A.patchBody(abc, body.method, list => { list[dummyAt - 1] = A.ins("pushtrue"); return list }, { extraStack: 0 })
            done.sdkDummy = changed = true
        }
        // 2. ApiServerKind.Custom("https", "shijtswygamegf.leiting.com")
        const hostAt = code.findIndex(op => op.name === "pushstring" && abc.strings[op.args[0]] === "shijtswygamegf.leiting.com")
        // 3. the version check (asks update.leiting.com, then update.roguelike.com, for the API host)
        const versionAt = code.map((op, k) => [op, k]).filter(([op]) => op.name === "pushstring" && VERSION_URLS.includes(abc.strings[op.args[0]]))
        if (versionAt.length > 0) {
            A.patchBody(abc, body.method, list => {
                for (const [, k] of versionAt) list[k].args = [A.str(abc, `http://${host}/shijtswy/version/`)]
                return list
            }, { extraStack: 0 })
            done.version += versionAt.length
            changed = true
        }
        if (hostAt > 0 && code[hostAt - 1].name === "pushstring" && abc.strings[code[hostAt - 1].args[0]] === "https") {
            A.patchBody(abc, body.method, list => {
                list[hostAt - 1].args = [A.str(abc, "http")]
                list[hostAt].args = [A.str(abc, host)]
                return list
            }, { extraStack: 0 })
            done.server = changed = true
        }
    }
    if (changed) tag.data = A.joinDoAbc(doAbc, A.writeAbc(abc))
}

if (!done.sdkDummy || !done.server || done.version !== VERSION_URLS.length) throw new Error("patch point not found: " + JSON.stringify(done))
A.writeSwf(output, swf, false) // the CN client ships its SWF uncompressed (FWS)
console.log(`wrote ${output}: sdkDummy=true, api server http://${host}, version check http://${host}/shijtswy/version/`)
