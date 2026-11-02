// Lets the phone companion app (companion/README.md) copy the files its own server needs from this
// server over Wi-Fi: the game must already have its files, so this is the slim set (CN version
// files, schedules, news), plus what the player picks: their save, the game updates (patch zips),
// dashboard pictures, comics.
//   GET /companion/manifest?save=1&patches=0&images=1&comics=0  -> { env, files: [{ path, size }] }
//   GET /companion/file?path=<path from the manifest>            -> the file
// Paths are where the files go in the companion's data folder (.database/..., .cdn/...).

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { createReadStream, existsSync, readdirSync, rmSync, statSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import getDatabase, { Database } from "../data"
import { cnCdnRoot, cnPatchDir } from "../lib/cnClient"

interface Options { save: boolean, patches: boolean, images: boolean, comics: boolean }
interface Entry { path: string, file: string, size: number }

const SAVE_SNAPSHOT = path.join(tmpdir(), "starpoint-companion-save.db")
const cdnDir = () => path.resolve(process.env.CDN_DIR || ".cdn")
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
function entries(options: Options, snapshot: boolean): Entry[] {
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
    if (options.comics) addTree(list, ".cdn/comics", path.join(process.cwd(), ".cdn", "comics"))
    return list
}

const flag = (value: unknown) => value === "1" || value === "true"

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/manifest", async (request: FastifyRequest, reply: FastifyReply) => {
        const q = request.query as Record<string, string>
        const options = { save: flag(q.save), patches: flag(q.patches), images: flag(q.images), comics: flag(q.comics) }
        const list = entries(options, true)
        const env: Record<string, string> = {}
        if (options.save && process.env.CN_ACCOUNT_ID) env.CN_ACCOUNT_ID = process.env.CN_ACCOUNT_ID
        return reply.send({
            server: "StarPoint",
            env,
            files: list.map(e => ({ path: e.path, size: e.size })),
            totalSize: list.reduce((n, e) => n + e.size, 0),
        })
    })

    fastify.get("/file", async (request: FastifyRequest, reply: FastifyReply) => {
        const wanted = (request.query as Record<string, string>).path
        // only files a manifest can list (with every option on, using the existing save snapshot)
        const entry = entries({ save: true, patches: true, images: true, comics: true }, false).find(e => e.path === wanted)
        if (!entry) return reply.status(404).send({ error: "Not Found" })
        reply.header("content-length", statSync(entry.file).size)
        return reply.type("application/octet-stream").send(createReadStream(entry.file))
    })
}

export default routes
