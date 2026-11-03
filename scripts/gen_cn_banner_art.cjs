// Gives summon banners that have no summon-screen art in the CN game the art they should have:
//   - CN reruns ("<banner>_1" etc.) have no gacha_feature_content rows of their own; they get their
//     original banner's rows (same featured units, same list picture, checked 2026-11-02)
//   - banner 44 (new_character_pickup_zcollabo_2) gets global's rows and animation files
//   - pictures the CN files lack but global has (same path) are shipped from global
// Writes .cdn/cn_work_banner_art/files.json (the edited table + global's files) for
// scripts/build_cn_patch.cjs. Banners restored here can come off scripts/no_art_banners.cjs.
//
//   node scripts/gen_cn_banner_art.cjs
const fs = require("fs")
const path = require("path")
const unzipper = require("unzipper")
const R = require("./cdn_rows.cjs")
const { cnZips } = require("./cn_archives.cjs")
const { readTable } = require("./cdn_master.cjs")

const ROOT = path.join(__dirname, "..")
const OUT = path.join(ROOT, ".cdn", "cn_work_banner_art")
const { hashHex: hash, uploadPath: hashed } = require("./cdn_hash.cjs")

// rerun -> original (CN ids)
const RERUNS = { 64: 7, 66: 8, 68: 10, 69: 11, 72: 14, 74: 17, 76: 20, 77: 18, 82: 25, 84: 27, 86: 28, 5009: 5000, 5013: 5004, 5015: 5006 }
// banners whose rows come from global's table (same internal name in both games)
const FROM_GLOBAL = ["44"]
// old banners whose top art is the short strip layout (624 px high) -> a later full-screen rerun that
// features exactly the same units: the old banner shows the rerun's top art (its first row)
const TOP_FROM = {
    6: 132, 53: 132, 8: 134, 58: 134, 33: 122, 1555: 122, 10070: 122, 900001: 122, 59: 109, 1534: 109,
    1531: 112, 10061: 112, 1537: 120, 10065: 120, 1559: 136, 10071: 136,
}

;(async () => {
    const table = "master/gacha/gacha_feature_content.orderedmap"
    const tableFile = hashed(table)
    // newest copy of the table and every file name: CN's files, then StarPoint's patches
    const names = new Set()
    let tableBuf = null
    const zips = [...cnZips()]
    const patchList = JSON.parse(fs.readFileSync(path.join(ROOT, ".cdn", "cn_patches", "patches.json"), "utf8"))
    for (const p of patchList) for (const a of p.archives) { const f = path.join(ROOT, ".cdn", "cn_patches", a.file); if (fs.existsSync(f)) zips.push(f) }
    for (const z of zips) for (const e of (await unzipper.Open.file(z)).files) {
        const p = e.path.split("\\").join("/")
        names.add(p.split("/").pop())
        if (p === tableFile && !p.includes("cn_work_banner_art")) tableBuf = await e.buffer()
    }
    const has = logical => names.has(hash(logical).slice(2))
    const tree = R.decodeFile(tableBuf)
    const byKey = new Map(tree.entries.map(e => [e.key, e]))
    const rowsOf = id => byKey.get(String(id))?.node.entries.map(e => e.node.text) ?? null
    const global = await readTable(table, true)

    // every file in global's archives, by name (hash tail) -> its path there
    const globalPaths = new Map()
    for (const d of fs.readdirSync(path.join(ROOT, ".cdn", "en")).filter(d => d.startsWith("archive-") && !d.includes("ios")))
        for (const f of fs.readdirSync(path.join(ROOT, ".cdn", "en", d))) if (f.endsWith(".zip"))
            for (const e of (await unzipper.Open.file(path.join(ROOT, ".cdn", "en", d, f))).files) {
                const p = e.path.split("\\").join("/")
                globalPaths.set(p.split("/").pop(), p)
            }
    const inGlobal = logical => globalPaths.get(hash(logical).slice(2))

    const files = new Map()
    // a banner's summon-page files the CN files lack, when global has them
    const wantFiles = rows => {
        for (const line of rows ?? []) {
            const c = R.splitCsv(line)
            if (c[0] === "1" && c[1] && !has(c[1] + ".png") && inGlobal(c[1] + ".png")) files.set(inGlobal(c[1] + ".png"), "global")
            if (c[0] === "0" && c[2]) {
                const dir = c[2].replace(/\/[^/]+$/, "")
                const set = [c[2] + ".timeline.amf3.deflate", dir + "/sprite_sheet.png", dir + "/sprite_sheet.atlas.amf3.deflate"]
                // the three files go together (a sheet only matches its own layout)
                if (!set.every(has) && set.every(inGlobal)) for (const f of set) files.set(inGlobal(f), "global")
            }
        }
    }
    const addBanner = (id, rows) => {
        if (byKey.has(String(id))) throw new Error(`banner ${id} already has rows`)
        const node = { kind: "map", entries: rows.map((text, i) => ({ key: String(i + 1), node: { kind: "leaf", text, original: "" } })) }
        const entry = { key: String(id), node }
        tree.entries.push(entry)
        byKey.set(String(id), entry)
    }
    // originals first (their pictures may be missing too), then the reruns reuse them
    for (const original of new Set(Object.values(RERUNS))) wantFiles(rowsOf(original))
    for (const [rerun, original] of Object.entries(RERUNS)) {
        if (byKey.has(rerun)) { console.log(`${rerun}: has rows already, left alone`); continue }
        addBanner(rerun, rowsOf(original))
        console.log(`${rerun}: rows of ${original}`)
    }
    for (const id of FROM_GLOBAL) {
        const rows = Object.values(global[id] ?? {})
        if (rows.length === 0) throw new Error(`global has no rows for ${id}`)
        if (byKey.has(id)) { console.log(`${id}: has rows already, left alone`); continue }
        addBanner(id, rows)
        wantFiles(rows)
        console.log(`${id}: global's rows`)
    }
    for (const [old, full] of Object.entries(TOP_FROM)) {
        const top = byKey.get(old)?.node.entries.find(e => e.key === "1")?.node
        const fullTop = byKey.get(String(full))?.node.entries.find(e => e.key === "1")?.node
        if (!top || !fullTop) throw new Error(`top row missing for ${old} or ${full}`)
        if (top.text !== fullTop.text) R.setLeafText(top, fullTop.text)
        console.log(`${old}: top art of ${full}`)
    }
    // summon-page files missing for any other banner (e.g. Star Heroes, 87, 10069: same path in global)
    for (const e of tree.entries) wantFiles(rowsOf(e.key))

    // list pictures (the strip of small banners at the top of the summon screen, gacha column 3) the CN
    // files lack: shipped from global when it has the same file, in whichever folder global keeps it
    const gacha = {}
    for (const z of cnZips()) for (const e of (await unzipper.Open.file(z)).files) if (e.path.split("\\").join("/") === hashed("master/gacha/gacha.orderedmap"))
        for (const { path: keys, leaf } of R.leaves(R.decodeFile(await e.buffer()))) gacha[keys.join("/")] = leaf.text
    const listMissing = []
    for (const [id, line] of Object.entries(gacha)) {
        const list = R.splitCsv(line)[3]
        if (!list || has(list + ".png")) continue
        const g = globalPaths.get(hash(list + ".png").slice(2))
        if (g) { files.set(g, "global"); listMissing.push(id) }
    }
    console.log(`list pictures from global: ${listMissing.length} banners (${listMissing.join(", ")})`)

    // home screen banners (the rotating cards on the home screen, master/feature_banner/*): any picture
    // they name that the CN files lack, from global when it has it
    const homeMissing = new Set()
    for (const t of ["feature_banner", "feature_banner_secondary", "feature_banner_misc"]) {
        const file = hashed(`master/feature_banner/${t}.orderedmap`)
        for (const z of cnZips()) for (const e of (await unzipper.Open.file(z)).files) if (e.path.split("\\").join("/") === file)
            for (const { leaf } of R.leaves(R.decodeFile(await e.buffer())))
                for (const field of R.splitCsv(leaf.text)) {
                    if (!/^(dynamic|quest)\/[a-z0-9_/]+$/i.test(field) || has(field + ".png")) continue
                    const g = inGlobal(field + ".png")
                    if (g) { files.set(g, "global"); homeMissing.add(field) }
                }
    }
    console.log(`home banner pictures from global: ${homeMissing.size}`)

    fs.rmSync(OUT, { recursive: true, force: true })
    const tablePath = path.join(OUT, tableFile)
    fs.mkdirSync(path.dirname(tablePath), { recursive: true })
    fs.writeFileSync(tablePath, R.encodeFile(tree))
    const list = [{ path: tableFile, from: tablePath }, ...[...files.keys()].sort().map(p => ({ path: p, from: "global" }))]
    fs.writeFileSync(path.join(OUT, "files.json"), JSON.stringify(list))
    console.log(`${list.length} files -> ${path.join(OUT, "files.json")}`)
})().catch(e => { console.error(e); process.exit(1) })
