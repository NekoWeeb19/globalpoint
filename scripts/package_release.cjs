// Builds the shareable, self-contained globalized CN StarPoint folder (sharing plan, Phase 1):
//   <out>/                 the server: this repo's files (git's tracked + new, minus .env, saves, logs)
//   <out>/.env             from .env.example (relative paths, no account, listens on 127.0.0.1 only)
//   <out>/.cdn/cn/         CN base game files (no iOS archives), hard links when on the same drive
//   <out>/.cdn/cn_text/    the English CN tables, one flat folder (CN_TRANSLATED_DIR's files.json chain)
//   <out>/.cdn/cn_patches/ ONE patch: every StarPoint patch merged (scripts/squash_cn_patches.cjs)
//   <out>/.cdn/comics/, dashboard_images/
//   <out>/.database/       news.json only (no saves, accounts, clock or schedule)
// Events start on their original CN dates: the schedule is run once with an empty schedule (that
// rebuilds every schedule-touched table and the server's mission/shop/pass data), then all patches are
// squashed. The global CDN (.cdn/en, .cdn/mods) is not included. node_modules and out/ are only used
// while building and removed again (setup.bat installs and compiles them).
//
// The game APK (the 127.0.0.1 build only) goes in <out>/apk/: --apk <file>, or add it later.
//
//   node scripts/package_release.cjs [out folder, default ../GlobalPoint-release next to this repo] [--apk <game apk>]
//   node scripts/package_release.cjs <existing out folder> --apk <game apk> --apk-only
//   node scripts/package_release.cjs <existing out folder> --update-code   (server code only)
const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")
const { cnDir, cnTextDir } = require("./cn_archives.cjs")

const ROOT = path.join(__dirname, "..")
const args = process.argv.slice(2)
const apkAt = args.indexOf("--apk")
const APK = apkAt >= 0 ? args[apkAt + 1] : null
const OUT = path.resolve(args.find((a, i) => !a.startsWith("--") && i !== apkAt + 1) ?? path.join(ROOT, "..", "GlobalPoint-release"))
const step = s => console.log(`\n== ${s}`)

/** Puts the game APK in <out>/apk/ (only the 127.0.0.1 build is for sharing). */
function addApk() {
    if (!APK) return
    if (/phone/i.test(path.basename(APK))) throw new Error(`${APK} looks like the LAN (phone) build: share only the 127.0.0.1 build`)
    const dir = path.join(OUT, "apk")
    fs.mkdirSync(dir, { recursive: true })
    for (const f of fs.readdirSync(dir)) if (f.endsWith(".apk")) fs.rmSync(path.join(dir, f))
    fs.copyFileSync(APK, path.join(dir, path.basename(APK)))
    console.log(`game APK: apk/${path.basename(APK)}`)
}
if (args.includes("--apk-only")) { addApk(); process.exit(0) }

function copyTree(from, to, { link = false, skip = () => false } = {}) {
    let n = 0
    const walk = (a, b) => {
        fs.mkdirSync(b, { recursive: true })
        for (const e of fs.readdirSync(a, { withFileTypes: true })) {
            const src = path.join(a, e.name), dst = path.join(b, e.name)
            if (skip(src, e)) continue
            if (e.isDirectory()) walk(src, dst)
            else {
                if (fs.existsSync(dst)) fs.rmSync(dst)
                if (link) { try { fs.linkSync(src, dst) } catch { fs.copyFileSync(src, dst) } }
                else fs.copyFileSync(src, dst)
                n++
            }
        }
    }
    walk(from, to)
    return n
}

// the server's data the package's own schedule run writes (original CN dates): never overwritten from
// this working copy, whose copies follow its own schedule
const PACKAGE_GENERATED = ["assets/missions_cn.json", "assets/cn_shops.json", "assets/pass_card_cn.json"]

/** Copies the server's files (git's tracked + new files, minus .env, saves, logs, builds) into OUT. */
function copyServerFiles({ skipGenerated = false } = {}) {
    const tracked = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean)
    const keep = f => !/^(\.env$|\.database\/|logs\/|out\/|node_modules\/)/.test(f) && fs.existsSync(path.join(ROOT, f))
        && !(skipGenerated && PACKAGE_GENERATED.includes(f))
    let files = 0
    for (const f of tracked.filter(keep)) {
        const dst = path.join(OUT, f)
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.copyFileSync(path.join(ROOT, f), dst)
        files++
    }
    // the dashboard's stylesheet is built (npm run css), not tracked: ship the built one
    fs.copyFileSync(path.join(ROOT, "web", "public", "tailwind.css"), path.join(OUT, "web", "public", "tailwind.css"))
    return files
}

// --update-code: refresh only the server's code and settings template in an existing package
// (game files, its generated data, .database and the player's .env stay as they are)
if (args.includes("--update-code")) {
    if (!fs.existsSync(path.join(OUT, ".cdn", "cn_patches"))) throw new Error(`${OUT} is not a package`)
    console.log(`${copyServerFiles({ skipGenerated: true })} server files updated in ${OUT}`)
    process.exit(0)
}

if (fs.existsSync(OUT) && fs.readdirSync(OUT).length > 0) throw new Error(`${OUT} is not empty: remove it first`)
fs.mkdirSync(OUT, { recursive: true })

step("server files")
const files = copyServerFiles()
fs.copyFileSync(path.join(ROOT, ".env.example"), path.join(OUT, ".env"))
fs.mkdirSync(path.join(OUT, ".database"))
fs.copyFileSync(path.join(ROOT, ".database", "news.json"), path.join(OUT, ".database", "news.json"))
console.log(`${files} files, .env from .env.example, .database/news.json`)

step("CN base game files")
console.log(`${copyTree(cnDir(), path.join(OUT, ".cdn", "cn"), { link: true, skip: (src, e) => e.isDirectory() && e.name.startsWith("archive-ios") })} files from ${cnDir()}`)

step("English CN tables")
{
    const textDir = cnTextDir(), listFile = path.join(textDir, "files.json")
    const out = path.join(OUT, ".cdn", "cn_text")
    let n = 0
    // the files.json chain names every table (also ones kept from earlier steps' folders); without it, the folder itself
    const list = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, "utf8")) : []
    for (const { path: p, from } of list) {
        const dst = path.join(out, p)
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.copyFileSync(from, dst)
        n++
    }
    if (list.length === 0) n = copyTree(textDir, out)
    console.log(`${n} tables from ${textDir}`)
}

step("patches, comics, dashboard pictures")
for (const dir of ["cn_patches", "comics", "dashboard_images"])
    console.log(`${dir}: ${copyTree(path.join(ROOT, ".cdn", dir), path.join(OUT, ".cdn", dir), { skip: (src, e) => dir === "cn_patches" && e.isDirectory() && e.name === "cn_patches_squash" })} files`)

step("build tools (temporary): node_modules, out/")
copyTree(path.join(ROOT, "node_modules"), path.join(OUT, "node_modules"))
execFileSync(process.execPath, [path.join(OUT, "node_modules", "typescript", "bin", "tsc"), "-p", "."], { cwd: OUT, stdio: "inherit" })

step("clean schedule (original CN dates)")
execFileSync(process.execPath, ["--env-file=.env", path.join("scripts", "gen_cn_event_schedule.cjs")], { cwd: OUT, stdio: "inherit" })

step("merge all patches into one")
execFileSync(process.execPath, ["--env-file=.env", path.join("scripts", "squash_cn_patches.cjs")], { cwd: OUT, stdio: "inherit" })

step("remove build tools and run state")
for (const p of ["node_modules", "out", "logs"]) fs.rmSync(path.join(OUT, p), { recursive: true, force: true })
for (const f of fs.readdirSync(path.join(OUT, ".database"))) if (f !== "news.json") fs.rmSync(path.join(OUT, ".database", f), { recursive: true })
addApk()
console.log(`\ndone: ${OUT}`)
