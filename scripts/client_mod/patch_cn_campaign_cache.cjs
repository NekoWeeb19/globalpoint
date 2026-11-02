// Speeds up the CN client's Events screen: CampaignRepository.applyStaminaCampaignFor and
// applyRewardCampaignFor (a scan of every stamina/reward campaign row, run once per event banner) now
// call as3/starpoint/CampaignCache.as, which works out the rows that are on once per kind (stamina, reward) per second
// and reuses them. Each body becomes: CampaignCache.applyX(this, <the same table lookup>, base, match,
// time). Runs after patch_cn_font.cjs in the SWF chain (client -> text -> ability -> font -> this).
//
//   node patch_cn_campaign_cache.cjs <in.swf> <out.swf> <work dir> <ffdec-cli.jar>
const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")
const A = require("./abc.cjs")

const [inSwf, outSwf, work, ffdec] = process.argv.slice(2)
if (!ffdec) throw new Error("usage: patch_cn_campaign_cache.cjs <in.swf> <out.swf> <work dir> <ffdec-cli.jar>")
fs.mkdirSync(work, { recursive: true })

// 1. compile CampaignCache into a stub SWF
const stub = path.join(work, "campaigncache_stub.swf"), compiled = path.join(work, "campaigncache.swf")
execFileSync(process.execPath, [path.join(__dirname, "stub_class.cjs"), stub, "starpoint", "CampaignCache", "active", "applyStamina", "applyReward"], { stdio: "inherit" })
execFileSync("java", ["-jar", ffdec, "-air", "-importScript", stub, compiled, path.join(__dirname, "as3")], { stdio: "inherit" })
const cacheTag = A.readSwf(compiled).tags.find(t => t.code === 82)
if (!cacheTag) throw new Error("CampaignCache did not compile")

// 2. replace the two scans in the main ABC
const swf = A.readSwf(inSwf)
const abcTags = swf.tags.filter(t => t.code === 82)
let abc = null, mainTag = null
for (const t of abcTags) {
    const d = A.splitDoAbc(t.data)
    if (d.name !== "boot_ffc6") continue
    abc = A.parseAbc(d.abc); mainTag = { tag: t, head: d }
}
if (!abc) throw new Error("main ABC boot_ffc6 not found")
if (abc.instances.some(i => A.mnName(abc, i.name) === "starpoint.CampaignCache") || abcTags.some(t => A.splitDoAbc(t.data).abc.includes("CampaignCache")))
    throw new Error("this SWF already has CampaignCache")
const CACHE = A.qname(abc, "starpoint", "CampaignCache")
const I = A.ins
const ci = A.findClass(abc, "pinball.common.data.campaign.CampaignRepository")

for (const [method, helper] of [["applyStaminaCampaignFor", "applyStamina"], ["applyRewardCampaignFor", "applyReward"]]) {
    const mi = A.findMethod(abc, ci, method)
    const body = abc.bodyOf.get(mi)
    const list = A.decode(body.code)
    // the table lookup: from "findproperty logicAssets" up to the "setlocal 4" that stores it
    const from = list.findIndex(i => i.name === "findproperty" && A.shortName(abc, i.args[0]) === "logicAssets")
    const to = list.findIndex((i, k) => k > from && i.name === "setlocal" && i.args[0] === 4)
    if (from < 0 || to < 0) throw new Error(`${method}: table lookup not found`)
    const lookup = list.slice(from, to)
    if (lookup.some(i => i.targets) || lookup.length > 8) throw new Error(`${method}: unexpected table lookup (${lookup.map(i => i.name).join(" ")})`)
    const code = [
        I("getlocal0"), I("pushscope"),
        I("getlex", CACHE),
        I("getlocal0"), // the repository
        ...lookup.map(i => I(i.name, ...i.args)), // its master table
        I("getlocal1"), I("getlocal2"), I("getlocal3"), // base, match, time
        I("callpropvoid", A.qname(abc, "", helper), 5),
        I("returnvoid"),
    ]
    body.code = A.encode(code).code
    body.exceptions = []
    body.maxStack = Math.max(body.maxStack, 8)
    console.log(`${method}: -> CampaignCache.${helper} (${lookup.map(i => i.name).join(" ")})`)
}

mainTag.tag.data = A.joinDoAbc(mainTag.head, A.writeAbc(abc))
const last = swf.tags.lastIndexOf(abcTags[abcTags.length - 1])
swf.tags.splice(last + 1, 0, { code: 82, data: cacheTag.data })
A.writeSwf(outSwf, swf, false) // uncompressed, like the game's own SWF
console.log(`wrote ${outSwf} (${fs.statSync(outSwf).size} bytes)`)
