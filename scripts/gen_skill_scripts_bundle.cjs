// Builds assets/skill_editor/game_scripts.json: every CN unit's skill script (the files the skill rows' column 7 names,
// <path>.action.dsl.amf3.deflate), as { "<logical path>": base64 }. The phone companion keeps only CN's data tables
// (scripts/gen_cn_slim.cjs), not these, so the Unit editor's Skill tab said "Couldn't read the script: No script ..."
// for every unit on a phone (player report 2026-11-21). scripts/skill_editor.cjs readScript falls back to this file.
// PC only (needs the full CN game files, and the game APK for the scripts built into the app); rerun if they change.
//
//   node --env-file=.env scripts/gen_skill_scripts_bundle.cjs   (CN_GAME_APK=<game apk> if apk/ has none)
const fs = require("fs")
const path = require("path")
const unzipper = require("unzipper")
const { cnZips } = require("./cn_archives.cjs")
const { readCnTable } = require("./cn_read.cjs")
const { uploadPath } = require("./cdn_hash.cjs")
const { parseCsvLine } = require("./cdn_master.cjs")

const OUT = path.join(__dirname, "..", "assets", "skill_editor", "game_scripts.json")
const SUFFIX = ".action.dsl.amf3.deflate"

;(async () => {
    const table = await readCnTable("master/skill/action_skill.orderedmap")
    if (!table) throw new Error("CN's skill table wasn't found: run this on the PC with the full CN game files.")
    const logicals = new Set()
    for (const text of Object.values(table)) {
        const script = parseCsvLine(text)[7]
        if (script && /^battle\/action\/skill\//.test(script)) logicals.add(script)
    }
    // archive entry names are hashed paths without "production/"
    const wanted = new Map([...logicals].map(l => [uploadPath(l + SUFFIX).replace("production/", ""), l]))
    const found = new Map()
    for (const zip of cnZips()) { // oldest first: a newer copy replaces an older one
        for (const entry of (await unzipper.Open.file(zip)).files) {
            if (entry.type !== "File") continue
            const name = entry.path.split("\\").join("/")
            for (const [short, logical] of wanted) if (name.endsWith(short)) found.set(logical, await entry.buffer())
        }
    }
    // the hero's (Alk) scripts are built into the game app (assets/bundle.zip), not CN's downloads: CN_GAME_APK or apk/*.apk
    const app = require("./cn_app_bundle.cjs")
    for (const logical of logicals) if (!found.has(logical)) { const buf = await app.readAppFile(logical + SUFFIX); if (buf) found.set(logical, buf) }
    if (!app.appApk()) console.log("No game APK (CN_GAME_APK or apk/*.apk): scripts built into the app are left out.")
    const out = {}
    for (const logical of [...found.keys()].sort()) out[logical] = found.get(logical).toString("base64")
    fs.writeFileSync(OUT, JSON.stringify(out))
    const bytes = [...found.values()].reduce((n, b) => n + b.length, 0)
    const missing = [...logicals].filter(l => !found.has(l))
    console.log(`Wrote ${OUT}: ${found.size} of ${logicals.size} skill scripts, ${(bytes / 1024).toFixed(0)} KB${missing.length ? `; not in CN's files: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}` : ""}.`)
})()
