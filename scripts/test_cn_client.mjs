// Plays the CN client's startup against a running StarPoint (default http://127.0.0.1:8000; pass
// another base URL as the first argument, e.g. a test server on a save copy): version check, Leiting
// login, signup, game-file check, /load, and one CN game-file download.
//   node scripts/test_cn_client.mjs [http://127.0.0.1:8010]
import { pack, unpack } from "msgpackr"
import { createHash } from "node:crypto"

const base = process.argv[2] ?? "http://127.0.0.1:8000"
let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + (JSON.stringify(detail) ?? "").slice(0, 400)}`)
    if (!ok) failures++
}

// The CN decoder can't read msgpack uint32 (tag 0xce); StarPoint must never send one to it.
function hasUint32(buf) {
    let p = 0, found = false
    const walk = () => {
        const t = buf[p++]
        if (t <= 0x7f || t >= 0xe0 || t === 0xc0 || t === 0xc2 || t === 0xc3) return
        if (t >= 0xa0 && t <= 0xbf) { p += t & 0x1f; return }
        if (t >= 0x90 && t <= 0x9f) { const n = t & 15; for (let i = 0; i < n; i++) walk(); return }
        if (t >= 0x80 && t <= 0x8f) { const n = (t & 15) * 2; for (let i = 0; i < n; i++) walk(); return }
        switch (t) {
            case 0xce: found = true; p += 4; return
            case 0xcc: case 0xd0: p += 1; return
            case 0xcd: case 0xd1: p += 2; return
            case 0xd2: case 0xca: p += 4; return
            case 0xcf: case 0xd3: case 0xcb: p += 8; return
            case 0xd9: case 0xc4: p += 1 + buf[p]; return
            case 0xda: case 0xc5: p += 2 + buf.readUInt16BE(p); return
            case 0xdb: case 0xc6: p += 4 + buf.readUInt32BE(p); return
            case 0xdc: { const n = buf.readUInt16BE(p); p += 2; for (let i = 0; i < n; i++) walk(); return }
            case 0xdd: { const n = buf.readUInt32BE(p); p += 4; for (let i = 0; i < n; i++) walk(); return }
            case 0xde: { const n = buf.readUInt16BE(p) * 2; p += 2; for (let i = 0; i < n; i++) walk(); return }
            case 0xdf: { const n = buf.readUInt32BE(p) * 2; p += 4; for (let i = 0; i < n; i++) walk(); return }
        }
    }
    while (p < buf.length) walk()
    return found
}

async function post(path, body, headers = {}) {
    const res = await fetch(base + "/cn/api/index.php" + path, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", udid: "CN-TEST-UDID", device: "2", ...headers },
        body: pack(body).toString("base64"),
    })
    const text = await res.text()
    if (res.headers.get("content-type")?.includes("json")) return { status: res.status, json: true, body: JSON.parse(text) }
    let raw = null, decoded = text
    try { raw = Buffer.from(text, "base64"); decoded = unpack(raw) } catch { raw = null }
    return { status: res.status, body: decoded, uint32: raw ? hasUint32(raw) : false }
}

// wait for the server
for (let i = 0; i < 90; i++) {
    try { await fetch(base + "/"); break } catch { await new Promise(r => setTimeout(r, 1000)) }
}

const dis = await (await fetch(base + "/cn/shijtswy/version/client_release_android.dis")).text()
const disJson = JSON.parse(dis.split("\r\n")[1])
check("version file names this server's /cn API", disJson.default.apiPath === new URL(base).host + "/cn" && disJson.default.apiScheme === "http", dis)

const login = await post("/channels/channel_leiting/leiting_login", { userId: "dummy", game: "wf", channelNo: "1", token: "x" })
check("Leiting login accepted", login.status === 200 && login.body.data.status === "success", login)
const anti = await post("/channels/channel_leiting/leiting_antiaddiction_login", {})
check("anti-addiction: no play limit", anti.status === 200 && anti.body.data.data.usableTime === 999999, anti)

const signup = await post("/tool/signup", { device_id: 424242, channelNo: "1" })
const viewerId = signup.body?.data_headers?.viewer_id
check("signup gives a viewer id", signup.status === 200 && Number.isInteger(viewerId) && viewerId > 0, signup)
const signup2 = await post("/tool/signup", { device_id: 424242, channelNo: "1" })
check("signing up again keeps the same viewer id", signup2.body?.data_headers?.viewer_id === viewerId, signup2)

const title = await post("/assetintitle/version_info_in_title", { viewer_id: viewerId })
check("title-screen file check points at /cn/cdn", title.status === 200 && title.body.data.base_url.endsWith("/cn/cdn/") && title.body.data.total_size > 1e9, title)
const info = await post("/asset/version_info", { viewer_id: viewerId })
check("version_info (JSON) points at /cn/cdn", info.json && info.body.data.base_url.endsWith("/cn/cdn/"), info)

const fresh = await post("/asset/get_path", { viewer_id: viewerId, target_asset_version: "1.4.54" }, { asset_size: "fulfill" })
const f = fresh.body.data
check("fresh install: base 1.4.0 + updates to 1.4.54", fresh.json && f.info.is_initial && f.full.version === "1.4.0"
    && f.full.archive.length > 400 && f.diff.length > 50 && f.info.target_asset_version === "1.4.54", f?.info)
check("fresh install: every download is on this server, none for iOS",
    [...f.full.archive, ...f.diff.flatMap(d => d.archive)].every(a => a.location.startsWith(base + "/cn/cdn/archive-") && !a.location.includes("ios")))
const upToDate = await post("/asset/get_path", { viewer_id: viewerId }, { res_ver: "1.4.54", asset_size: "fulfill" })
check("has 1.4.54: nothing to download", upToDate.body.data.full === null && upToDate.body.data.diff === null && !upToDate.body.data.info.is_initial, upToDate.body)
const older = await post("/asset/get_path", { viewer_id: viewerId }, { res_ver: "1.4.50", asset_size: "fulfill" })
check("has 1.4.50: only the 4 updates after it", older.body.data.full === null
    && older.body.data.diff.map(d => d.version).join() === "1.4.51,1.4.52,1.4.53,1.4.54", older.body.data.diff?.map(d => d.version))

const first = f.full.archive[0]
const zip = await fetch(first.location)
const bytes = Buffer.from(await zip.arrayBuffer())
check("an archive downloads whole, with the listed sha256", zip.status === 200 && bytes.length === first.size
    && createHash("sha256").update(bytes).digest("base64") === first.sha256, { status: zip.status, size: bytes.length, want: first.size })
const empty = await fetch(base + "/cn/cdn/recovery/empty.csv")
check("empty recovery list", empty.status === 200 && (await empty.text()) === "")

const load = await post("/load", { device_id: 424242, keychain: viewerId, viewer_id: viewerId, graphics_device_name: "test",
    platform_os_version: "9", storage_directory_path: "/x", device_token: "" })
const d = load.body?.data
check("/load answers with the linked save", load.status === 200 && d?.user_info?.name !== undefined, load.status === 200 ? Object.keys(d ?? {}).slice(0, 10) : load)
check("/load: CN asset version and CN-only fields", d?.available_asset_version === "1.4.54" && Array.isArray(d?.tower_dungeon_list)
    && d?.user_info?.is_bought_fund_laite === false && d?.payment_rebate_info?.status === 0, { v: d?.available_asset_version })
check("/load: no msgpack uint32 for the CN decoder", load.uint32 === false)
const nodeLists = Object.values(d?.user_character_mana_node_list ?? {})
check("/load: learned mana nodes are { multiplied_id, awake_level } (CN error C8707 otherwise)", nodeLists.length > 0
    && nodeLists.every(list => list.every(n => typeof n === "object" && Number.isInteger(n.multiplied_id) && n.awake_level === 0)), nodeLists[0]?.slice(0, 2))
const { readFileSync } = await import("node:fs")
const cnIds = JSON.parse(readFileSync(new URL("../assets/cn_ids.json", import.meta.url), "utf8"))
const daily = d?.user_daily_challenge_point_list ?? []
check("/load: only Daily Challenge entries and campaigns the CN tables have (CN error C8601 otherwise)",
    daily.every(e => cnIds.dailyChallengePoint.includes(e.id) && e.campaign_list.every(c => cnIds.dailyChallengePointCampaign.includes(c.campaign_id))),
    daily)
console.log(`  player "${d?.user_info?.name}", ${JSON.stringify(load.body?.data_headers)}`)

const glob = await fetch(base + "/latest/api/index.php/tool/signup", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", udid: "x" }, body: pack({ device_id: 1 }).toString("base64") })
check("the global signup still wants a Kakao token", glob.status === 400)

console.log(failures === 0 ? "\nAll passed." : `\n${failures} failed.`)
process.exit(failures === 0 ? 0 : 1)
