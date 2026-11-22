// The CN game app's built-in files: assets/bundle.zip inside the game APK, production/android_bundle/<hash> (the same
// hashed names as the update files, scripts/cdn_hash.cjs). About 3,000 base files that never come as updates, e.g. the
// Fine and Coarse hit effects (battle/effect/hit/normal_damage/fine|coarse/...).
// The APK: CN_GAME_APK (a path), else the newest .apk in the repository's apk/ folder (as release packages have it).
// Read once and kept (~80 MB).
//   const { readAppFile, hasAppFile, appApk } = require("./cn_app_bundle.cjs")
const fs = require("fs")
const path = require("path")
const { hashName } = require("./cdn_hash.cjs")

/** The game APK the built-in files come from, or null. */
function appApk() {
    if (process.env.CN_GAME_APK) return fs.existsSync(process.env.CN_GAME_APK) ? process.env.CN_GAME_APK : null
    const dir = path.join(__dirname, "..", "apk")
    if (!fs.existsSync(dir)) return null
    const apks = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".apk")).map(f => path.join(dir, f))
    apks.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    return apks[0] ?? null
}

let entries = null
/** hash name ("ab/cdef...") -> zip entry of the bundle; empty when there's no APK. */
function bundleEntries() {
    entries ??= (async () => {
        const apk = appApk()
        if (!apk) return new Map()
        const unzipper = require("unzipper")
        const outer = await unzipper.Open.file(apk)
        const bundle = outer.files.find(f => f.path === "assets/bundle.zip")
        if (!bundle) return new Map()
        const inner = await unzipper.Open.buffer(await bundle.buffer())
        return new Map(inner.files.filter(f => f.type === "File").map(f => [f.path.split("/").slice(-2).join("/"), f]))
    })().catch(() => new Map())
    return entries
}

/** A built-in file by its logical path, or null. */
async function readAppFile(logical) {
    const e = (await bundleEntries()).get(hashName(logical))
    return e ? e.buffer() : null
}

/** Whether the app has a built-in file. */
async function hasAppFile(logical) {
    return (await bundleEntries()).has(hashName(logical))
}

module.exports = { appApk, readAppFile, hasAppFile, bundleEntries }
