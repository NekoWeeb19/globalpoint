// Lets the phone companion app (companion/README.md) copy the files its own server needs from this
// server over Wi-Fi: the game must already have its files, so this is the slim set (CN version
// files, schedules, news), plus what the player picks: their save, the game updates (patch zips),
// dashboard pictures, comics, and the data dashboard schedule edits need (the slim CN folder from
// scripts/gen_cn_slim.cjs and the English tables, ~140 MB).
// With game=1 it also lists the game's full set of files, for a phone that doesn't have the game yet
// (~138k files, ~10 GB). They go in the game's drop-off folder (/sdcard/StarPoint/game/), which game
// build 21+ moves into its own storage at its next start. They are the entries of the CN zips and
// StarPoint's patch zips as they are (newest copy wins), streamed straight out of the zips.
//   GET /companion/manifest?save=1&patches=0&images=1&comics=0&schedule=1&game=0
//       -> { env, files: [{ path, size }], totalSize, notes: [...] }
//   GET /companion/file?path=<path from the manifest>            -> the file
// Paths are where the files go in the companion's data folder (.database/..., .cdn/...), or, under
// game/, in /sdcard/StarPoint/game/ (game/info.json, the version record, is written last).
// Custom units (docs/CUSTOM_UNITS.md) always come along: the PC's unit files go to .cdn/custom_units/ (the
// phone's CUSTOM_UNITS_DIR), and changes to existing units to .cdn/custom_units/changes/, with _units.json naming
// them all, so the phone removes the ones the PC no longer has.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { closeSync, createReadStream, existsSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { createInflateRaw } from "zlib"
import getDatabase, { Database } from "../data"
import { CN_CDN_PREFIX, cdnDir, cnAssetVersion, cnCdnRoot, cnPatchDir, cnPatches, compareVersions } from "../lib/cnClient"

interface Options { save: boolean, patches: boolean, images: boolean, comics: boolean, schedule: boolean }
interface Entry { path: string, file: string, size: number }

const SAVE_SNAPSHOT = path.join(tmpdir(), "starpoint-companion-save.db")
const CUSTOM_UNITS_INDEX = path.join(tmpdir(), "starpoint-companion-custom-units.json")
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { customUnitsDir } = require(path.join(__dirname, "..", "..", "scripts", "custom_units.cjs")) as { customUnitsDir: () => string }
const serverRoot = path.join(__dirname, "..", "..")
/** The slim CN folder (tables/ + names.txt): CN_CDN_DIR itself if it's slim, else CN_SLIM_DIR, else <CDN_DIR>/cn_slim. */
function slimDir(): string | null {
    for (const dir of [cnCdnRoot(), process.env.CN_SLIM_DIR ? path.resolve(serverRoot, process.env.CN_SLIM_DIR) : null, path.join(cdnDir(), "cn_slim")]) {
        if (dir && existsSync(path.join(dir, "tables")) && existsSync(path.join(dir, "names.txt"))) return dir
    }
    return null
}
const translatedDir = () => path.resolve(serverRoot, process.env.CN_TRANSLATED_DIR || path.join(".cdn", "cn_text"))
const databaseDir = () => path.join(process.cwd(), ".database")

function add(list: Entry[], at: string, file: string) {
    if (existsSync(file) && statSync(file).isFile()) list.push({ path: at, file, size: statSync(file).size })
}
function addTree(list: Entry[], at: string, dir: string, skip?: (name: string) => boolean) {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (skip?.(entry.name)) continue
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) addTree(list, `${at}/${entry.name}`, file)
        else add(list, `${at}/${entry.name}`, file)
    }
}

/** The files for these options. A save is copied to a consistent snapshot first. */
function entries(options: Options, snapshot: boolean, notes: string[] = []): Entry[] {
    const list: Entry[] = []
    const cn = cnCdnRoot()
    add(list, ".cdn/cn/path", path.join(cn, "path"))
    const entities = path.join(cn, "entities")
    if (existsSync(entities)) {
        const csv = readdirSync(entities).find(f => /android_medium\.csv$/.test(f))
        if (csv) add(list, `.cdn/cn/entities/${csv}`, path.join(entities, csv))
    }
    // always listed (a phone without the zips still needs the versions); the app keeps its own list when it
    // has one and the zips aren't copied (DataTransfer.downloadFromPc)
    add(list, ".cdn/cn_patches/patches.json", path.join(cnPatchDir(), "patches.json"))
    // the schedules match the game's files (they were built together), so they always come along
    for (const name of ["news.json", "event_schedule.json", "campaign_schedule.json", "cn_copy_window.json", "banner_rotation.json"]) {
        add(list, `.database/${name}`, path.join(databaseDir(), name))
    }
    // custom units, always (small): every unit file, then the index of them
    const unitDir = customUnitsDir()
    const units = existsSync(unitDir) ? readdirSync(unitDir).filter(f => f.endsWith(".json") && !f.startsWith("_")).sort() : []
    for (const name of units) add(list, `.cdn/custom_units/${name}`, path.join(unitDir, name))
    const changeDir = path.join(unitDir, "changes")
    const changes = existsSync(changeDir) ? readdirSync(changeDir).filter(f => f.endsWith(".json") && !f.startsWith("_")).sort() : []
    for (const name of changes) add(list, `.cdn/custom_units/changes/${name}`, path.join(changeDir, name))
    writeFileSync(CUSTOM_UNITS_INDEX, JSON.stringify({ units, changes }))
    add(list, ".cdn/custom_units/_units.json", CUSTOM_UNITS_INDEX)
    if (options.save) {
        if (snapshot) {
            rmSync(SAVE_SNAPSHOT, { force: true })
            getDatabase(Database.WDFP_DATA).exec(`VACUUM INTO '${SAVE_SNAPSHOT.replace(/'/g, "''")}'`)
        }
        add(list, ".database/wdfp_data.db", SAVE_SNAPSHOT)
        for (const name of ["wdfp_data.db.version", "active_accounts.json", "account_claim.json", "server_time.json", "drop_settings.json", "server_settings.json", "gacha_rates.json"]) {
            add(list, `.database/${name}`, path.join(databaseDir(), name))
        }
    }
    if (options.patches) addTree(list, ".cdn/cn_patches", cnPatchDir(), name => name === "patches.json")
    if (options.images) addTree(list, ".cdn/dashboard_images", path.join(cdnDir(), "dashboard_images"))
    if (options.comics) addTree(list, ".cdn/comics", path.join(cdnDir(), "comics"))
    if (options.schedule) {
        const slim = slimDir()
        if (slim) {
            add(list, ".cdn/cn/names.txt", path.join(slim, "names.txt"))
            addTree(list, ".cdn/cn/tables", path.join(slim, "tables"))
        } else {
            notes.push("No slim CN folder on the PC, so dashboard schedule edits won't work on the phone. Make one with: node scripts/gen_cn_slim.cjs .cdn/cn_slim")
        }
        if (existsSync(translatedDir())) {
            addTree(list, ".cdn/cn_text", translatedDir())
            // the dir only has the tables its own step changed; files.json points to the rest in earlier
            // steps' dirs (on this PC), so those are sent too, into the same folder on the phone
            const sent = new Set(list.map(e => e.path))
            try {
                const files = JSON.parse(readFileSync(path.join(translatedDir(), "files.json"), "utf8")) as { path: string, from?: string }[]
                for (const f of files) {
                    const at = `.cdn/cn_text/${f.path}`
                    if (f.from && !sent.has(at)) { add(list, at, f.from); sent.add(at) }
                }
            } catch {
                notes.push(`Couldn't read ${path.join(translatedDir(), "files.json")}; some English CN tables may be missing.`)
            }
        } else notes.push(`No English CN tables at ${translatedDir()} (CN_TRANSLATED_DIR).`)
    }
    return list
}

// ---- the game's full set of files (game=1) ----

interface ZipEntry { zip: string, method: number, compressed: number, size: number, offset: number }
interface GameFiles { key: string, byPath: Map<string, ZipEntry>, info: Buffer, totalSize: number, notes: string[] }

/** The file entries of a zip, from its central directory (the CN and patch zips are small: no zip64). */
function zipEntries(zip: string): { name: string, entry: ZipEntry }[] {
    const fd = openSync(zip, "r")
    try {
        const size = statSync(zip).size
        const tail = Buffer.alloc(Math.min(size, 65557))
        readSync(fd, tail, 0, tail.length, size - tail.length)
        let eocd = -1
        for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
        if (eocd < 0) throw new Error(`${zip}: not a zip`)
        const count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16)
        if (count === 0xffff || cdOffset === 0xffffffff) throw new Error(`${zip}: zip64 is not supported`)
        const cd = Buffer.alloc(cdSize)
        readSync(fd, cd, 0, cdSize, cdOffset)
        const list: { name: string, entry: ZipEntry }[] = []
        for (let p = 0, n = 0; n < count && cd.readUInt32LE(p) === 0x02014b50; n++) {
            const nameLength = cd.readUInt16LE(p + 28), extra = cd.readUInt16LE(p + 30), comment = cd.readUInt16LE(p + 32)
            const name = cd.toString("utf8", p + 46, p + 46 + nameLength).split("\\").join("/")
            if (!name.endsWith("/")) list.push({
                name,
                entry: { zip, method: cd.readUInt16LE(p + 10), compressed: cd.readUInt32LE(p + 20), size: cd.readUInt32LE(p + 24), offset: cd.readUInt32LE(p + 42) },
            })
            p += 46 + nameLength + extra + comment
        }
        return list
    } finally {
        closeSync(fd)
    }
}

/** The zips that make up the game files, oldest first: CN's base set, CN's updates, StarPoint's patches (no iOS). */
function gameZips(notes: string[]): string[] {
    const root = cnCdnRoot()
    const local = (location: string) => path.join(root, location.replace(/^.*?\/upload_assets\//, ""))
    const zips: string[] = []
    try {
        const file = JSON.parse(readFileSync(path.join(root, "path"), "utf8"))
        for (const a of file.full?.archive ?? []) zips.push(local(a.location))
        for (const d of [...(file.diff ?? [])].sort((a: any, b: any) => compareVersions(a.version, b.version))) {
            for (const a of d.archive) zips.push(local(a.location))
        }
    } catch (e) {
        notes.push(`The CN game files aren't on the PC (${path.join(root, "path")}: ${(e as Error).message}), so the full game files can't be copied.`)
        return []
    }
    for (const p of cnPatches()) for (const a of p.archives) zips.push(path.join(cnPatchDir(), a.file))
    return zips.filter(z => !/archive-ios-/.test(z))
}

let gameCache: GameFiles | null = null
/** Every game file (game/download/<entry> -> where it is) and the info.json to go with them; kept until the patches change. */
function gameFiles(notes: string[] = []): GameFiles {
    const version = cnAssetVersion()
    const key = `${cnCdnRoot()}|${version}|${cnPatches().length}`
    if (gameCache?.key === key) {
        notes.push(...gameCache.notes)
        return gameCache
    }
    const started = Date.now()
    const byPath = new Map<string, ZipEntry>()
    const missing: string[] = []
    const found: string[] = []
    for (const zip of gameZips(found)) {
        if (!existsSync(zip)) { missing.push(zip); continue }
        for (const { name, entry } of zipEntries(zip)) byPath.set(`game/download/${name}`, entry)
    }
    if (missing.length > 0) found.push(`${missing.length} game zip(s) missing on the PC (e.g. ${missing[0]}): the game would download what they hold.`)
    let totalSize = 0
    for (const e of byPath.values()) totalSize += e.size
    // the version record the game writes after a finished download (scripts/client_mod/STORAGE_LAYOUT.txt
    // on the storage drop-off branch): with the server's newest version the game asks for no download
    const info = Buffer.from(JSON.stringify({
        assetRecoveryInfo: [],
        totalSize,
        version,
        baseUrl: `http://127.0.0.1:8000${CN_CDN_PREFIX}/`,
        assetSizeKind: "fulfill",
        latestModifiedTimeOfArchive: new Date().toUTCString(),
    }))
    console.log(`[companion] game files: ${byPath.size} files, ${(totalSize / 1073741824).toFixed(1)} GB, version ${version} (${Date.now() - started} ms)`)
    gameCache = { key, byPath, info, totalSize, notes: found }
    notes.push(...found)
    return gameCache
}

/** One game file, unpacked from its zip as it's sent. */
function sendGameFile(reply: FastifyReply, entry: ZipEntry) {
    const fd = openSync(entry.zip, "r")
    const header = Buffer.alloc(30)
    try { readSync(fd, header, 0, 30, entry.offset) } finally { closeSync(fd) }
    if (header.readUInt32LE(0) !== 0x04034b50) return reply.status(500).send({ error: "bad zip entry" })
    if (entry.method !== 0 && entry.method !== 8) return reply.status(500).send({ error: `zip method ${entry.method}` })
    const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
    reply.header("content-length", entry.size)
    reply.type("application/octet-stream")
    if (entry.compressed === 0) return reply.send(Buffer.alloc(0))
    const raw = createReadStream(entry.zip, { start, end: start + entry.compressed - 1 })
    if (entry.method === 0) return reply.send(raw)
    const inflate = createInflateRaw()
    raw.on("error", e => inflate.destroy(e))
    return reply.send(raw.pipe(inflate))
}

let allFiles: { at: number, byPath: Map<string, Entry> } | null = null
const flag = (value: unknown) => value === "1" || value === "true"

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/manifest", async (request: FastifyRequest, reply: FastifyReply) => {
        const q = request.query as Record<string, string>
        const options = { save: flag(q.save), patches: flag(q.patches), images: flag(q.images), comics: flag(q.comics), schedule: flag(q.schedule) }
        const notes: string[] = []
        const list: { path: string, size: number }[] = entries(options, true, notes)
        allFiles = null
        if (flag(q.game)) {
            const game = gameFiles(notes)
            if (game.byPath.size > 0) {
                for (const [at, e] of game.byPath) list.push({ path: at, size: e.size })
                list.push({ path: "game/info.json", size: game.info.length })
            }
        }
        const env: Record<string, string> = {}
        if (options.save && process.env.CN_ACCOUNT_ID) env.CN_ACCOUNT_ID = process.env.CN_ACCOUNT_ID
        return reply.send({
            server: "StarPoint",
            env,
            files: list.map(e => ({ path: e.path, size: e.size })),
            totalSize: list.reduce((n, e) => n + e.size, 0),
            notes,
        })
    })

    fastify.get("/file", async (request: FastifyRequest, reply: FastifyReply) => {
        const wanted = (request.query as Record<string, string>).path
        if (wanted === "game/info.json") return reply.type("application/json").send(gameFiles().info)
        if (wanted?.startsWith("game/")) {
            const entry = gameFiles().byPath.get(wanted)
            return entry ? sendGameFile(reply, entry) : reply.status(404).send({ error: "Not Found" })
        }
        // only files a manifest can list (with every option on, using the existing save snapshot);
        // the list is kept for a minute, since a download asks for thousands of files
        if (allFiles === null || Date.now() - allFiles.at > 60 * 1000) {
            allFiles = { at: Date.now(), byPath: new Map(entries({ save: true, patches: true, images: true, comics: true, schedule: true }, false).map(e => [e.path, e])) }
        }
        const entry = allFiles.byPath.get(wanted)
        if (!entry) return reply.status(404).send({ error: "Not Found" })
        reply.header("content-length", statSync(entry.file).size)
        return reply.type("application/octet-stream").send(createReadStream(entry.file))
    })
}

export default routes
