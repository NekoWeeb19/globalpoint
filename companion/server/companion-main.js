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

// The server and its schedule scripts keep everything they write in the working folder (.database),
// CDN_DIR (game updates, schedule files) and CN_GENERATED_DIR (regenerated CN tables), all in the
// data folder below. The server folder (replaced on every app update) is only read.

// Android has no /tmp: temporary files (e.g. the save snapshot in src/routes/companion.ts) go here
const tmp = path.join(dataDir, ".tmp")
fs.mkdirSync(tmp, { recursive: true })
process.env.TMPDIR = tmp

// the comics placeholder is read from <working folder>/web
const web = path.join(dataDir, "web")
try { fs.lstatSync(web) } catch { try { fs.symlinkSync(path.join(serverDir, "web"), web, "dir") } catch (e) { console.error(`[companion] link web: ${e.message}`) } }

// companion 0.2 kept the regenerated CN tables in data/.assets
const generated = path.join(dataDir, ".generated")
try { if (fs.existsSync(path.join(dataDir, ".assets")) && !fs.existsSync(generated)) fs.renameSync(path.join(dataDir, ".assets"), generated) } catch { }
fs.mkdirSync(generated, { recursive: true })
process.chdir(dataDir)

// settings: <data>/.env if the player made one, else phone defaults (same names as the PC .env)
const envFile = path.join(dataDir, ".env")
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
const defaults = {
    CDN_DIR: path.join(dataDir, ".cdn"),
    CN_CDN_DIR: path.join(dataDir, ".cdn", "cn"),
    CN_TRANSLATED_DIR: path.join(dataDir, ".cdn", "cn_text"),
    CN_GENERATED_DIR: generated,
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
    // tells the dashboard it runs inside the companion app (hides the PC-only "Play on a phone over Wi-Fi" box)
    STARPOINT_COMPANION: "1",
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
