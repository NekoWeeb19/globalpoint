// Lets the phone companion app (companion/README.md) copy the files its own server needs from this
// server over Wi-Fi: the game must already have its files, so this is the slim set (CN version
// files, schedules, news), plus what the player picks: their save, the game updates (patch zips),
// dashboard pictures, comics, and the data dashboard schedule edits need (the slim CN folder from
// scripts/gen_cn_slim.cjs and the English tables, ~140 MB).
//   GET /companion/manifest?save=1&patches=0&images=1&comics=0&schedule=1
//       -> { env, files: [{ path, size }], totalSize, notes: [...] }
//   GET /companion/file?path=<path from the manifest>            -> the file
// Paths are where the files go in the companion's data folder (.database/..., .cdn/...).

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { createReadStream, existsSync, readdirSync, rmSync, statSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import getDatabase, { Database } from "../data"
import { cdnDir, cnCdnRoot, cnPatchDir } from "../lib/cnClient"

interface Options { save: boolean, patches: boolean, images: boolean, comics: boolean, schedule: boolean }
interface Entry { path: string, file: string, size: number }

const SAVE_SNAPSHOT = path.join(tmpdir(), "starpoint-companion-save.db")
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
    add(list, ".cdn/cn_patches/patches.json", path.join(cnPatchDir(), "patches.json"))
    // the schedules match the game's files (they were built together), so they always come along
    for (const name of ["news.json", "event_schedule.json", "campaign_schedule.json", "cn_copy_window.json", "banner_rotation.json"]) {
        add(list, `.database/${name}`, path.join(databaseDir(), name))
    }
    if (options.save) {
        if (snapshot) {
            rmSync(SAVE_SNAPSHOT, { force: true })
            getDatabase(Database.WDFP_DATA).exec(`VACUUM INTO '${SAVE_SNAPSHOT.replace(/'/g, "''")}'`)
        }
        add(list, ".database/wdfp_data.db", SAVE_SNAPSHOT)
        for (const name of ["wdfp_data.db.version", "active_accounts.json", "account_claim.json", "server_time.json"]) {
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
        if (existsSync(translatedDir())) addTree(list, ".cdn/cn_text", translatedDir())
        else notes.push(`No English CN tables at ${translatedDir()} (CN_TRANSLATED_DIR).`)
    }
    return list
}

let allFiles: { at: number, byPath: Map<string, Entry> } | null = null
const flag = (value: unknown) => value === "1" || value === "true"

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/manifest", async (request: FastifyRequest, reply: FastifyReply) => {
        const q = request.query as Record<string, string>
        const options = { save: flag(q.save), patches: flag(q.patches), images: flag(q.images), comics: flag(q.comics), schedule: flag(q.schedule) }
        const notes: string[] = []
        const list = entries(options, true, notes)
        allFiles = null
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
