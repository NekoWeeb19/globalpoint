// Entry point the companion app gives the embedded Node (see companion/README.md).
// argv: node companion-main.js <dataDir>
// The server code (out/, assets/, web/, scripts/, node_modules/) sits next to this file and is
// replaced on every app update; the data folder (.database, .cdn, .env, logs) is kept.
const fs = require("fs")
const path = require("path")

const serverDir = __dirname
const dataDir = process.argv[2] || path.join(serverDir, "..", "data")
fs.mkdirSync(path.join(dataDir, ".database"), { recursive: true })
fs.mkdirSync(path.join(dataDir, ".cdn"), { recursive: true })

// everything printed also goes to <data>/server.log, which the app's screen shows
const logFile = path.join(dataDir, "server.log")
try { if (fs.statSync(logFile).size > 2 * 1024 * 1024) fs.renameSync(logFile, logFile + ".old") } catch { }
const log = fs.openSync(logFile, "a")
for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream)
    stream.write = (chunk, ...rest) => {
        try { fs.writeSync(log, typeof chunk === "string" ? chunk : Buffer.from(chunk)) } catch { }
        return write(chunk, ...rest)
    }
}
console.log(`\n--- ${new Date().toISOString()} starting (node ${process.version}, ${process.versions.mobile ?? "?"}, ${process.arch})`)
process.on("uncaughtException", error => { console.error("[companion] uncaught:", error && error.stack || error) })

// the server reads some files relative to the working folder (.database, .cdn/comics, web/...)
// and some relative to its code (.cdn/cn_patches): run in the data folder and link the rest
const link = (target, at) => {
    try { fs.lstatSync(at) } catch { try { fs.symlinkSync(target, at, "dir") } catch (e) { console.error(`[companion] link ${at}: ${e.message}`) } }
}
// Android has no /tmp: temporary files (e.g. the save snapshot in src/routes/companion.ts) go here
const tmp = path.join(dataDir, ".tmp")
fs.mkdirSync(tmp, { recursive: true })
process.env.TMPDIR = tmp

// the comics placeholder is read from <working folder>/web
link(path.join(serverDir, "web"), path.join(dataDir, "web"))
// the schedule scripts write the game updates to <server folder>/.cdn (build_cn_patch.cjs,
// gen_cn_event_schedule.cjs), and the server folder is replaced on every app update: keep them in data
link(path.join(dataDir, ".cdn"), path.join(serverDir, ".cdn"))
// the server keeps .database in its working folder, but gen_cn_event_schedule.cjs reads and writes
// <server folder>/.database (server_time, cn_copy_window, event/campaign_schedule.json)
link(path.join(dataDir, ".database"), path.join(serverDir, ".database"))
// same for the server's CN tables a schedule change regenerates (gen_cn_missions/pass_card/shops.cjs)
const keptAssets = path.join(dataDir, ".assets")
fs.mkdirSync(keptAssets, { recursive: true })
for (const name of ["missions_cn.json", "pass_card_cn.json", "cn_shops.json"]) {
    const bundled = path.join(serverDir, "assets", name), kept = path.join(keptAssets, name)
    try {
        if (fs.lstatSync(bundled).isSymbolicLink()) continue
        if (!fs.existsSync(kept)) fs.copyFileSync(bundled, kept)
        fs.rmSync(bundled)
        fs.symlinkSync(kept, bundled)
    } catch (e) { console.error(`[companion] keep ${name}: ${e.message}`) }
}
process.chdir(dataDir)

// settings: <data>/.env if the player made one, else phone defaults (same names as the PC .env)
const envFile = path.join(dataDir, ".env")
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
const defaults = {
    CDN_DIR: path.join(dataDir, ".cdn"),
    CN_CDN_DIR: path.join(dataDir, ".cdn", "cn"),
    CN_TRANSLATED_DIR: path.join(dataDir, ".cdn", "cn_text"),
    SERVER_START_DATE: "2021-07-24T05:00:00Z",
    LISTEN_HOST: "127.0.0.1",
    LISTEN_PORT: "8000",
    COOP_HOST: "127.0.0.1",
    COOP_PORT: "18888",
    COOP_MANA_NODE_FORMAT: "list",
    COOP_SUMMON_SECONDS: "5",
    LOGIN_BONUS_PAID_BEADS: "150",
    RAID_SOLO_CLEARS_PER_KILL: "1",
    SERVER_TIME_TICKS: "true",
    BANNER_ROTATION: "false",
    BANNER_ROTATION_HOURS: "24",
}
for (const [key, value] of Object.entries(defaults)) if (process.env[key] === undefined) process.env[key] = value

// COMPANION_PROBE=1 in <data>/.env: report whether this Node can start a second Node process
// (the event schedule rebuild does, src/nya/eventSchedule.ts) and whether worker threads work
if (process.env.COMPANION_PROBE === "1") {
    console.log(`[probe] execPath=${process.execPath} argv0=${process.argv0} pid=${process.pid}`)
    try {
        const out = require("child_process").execFileSync(process.execPath, ["-e", "console.log('child ok ' + process.version)"], { timeout: 15000 })
        console.log(`[probe] execFile(process.execPath): ${String(out).trim()}`)
    } catch (e) {
        console.log(`[probe] execFile(process.execPath) failed: ${(e.message || String(e)).split("\n")[0]}`)
    }
    try {
        const out = require("child_process").execFileSync("/system/bin/sh", ["-c", "echo shell ok"], { timeout: 15000 })
        console.log(`[probe] execFile(/system/bin/sh): ${String(out).trim()}`)
    } catch (e) {
        console.log(`[probe] execFile(/system/bin/sh) failed: ${(e.message || String(e)).split("\n")[0]}`)
    }
    const { Worker } = require("worker_threads")
    const w = new Worker("require('worker_threads').parentPort.postMessage('worker ok ' + require('node:sqlite').DatabaseSync.name)", { eval: true })
    w.on("message", m => console.log(`[probe] worker_threads: ${m}`))
    w.on("error", e => console.log(`[probe] worker_threads failed: ${e.message}`))
}

require(path.join(serverDir, "out", "server.js"))
