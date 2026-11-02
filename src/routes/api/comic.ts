// The Comics screens (Menu > Other > Flipper World / Stella's W.F.101). The official comics were
// images on the official servers, which are gone, so comics come from a local folder:
//   .cdn/comics/<kind>/<episode> <title>.png (or .jpg)     kind 0 = Flipper World, 1 = Stella's W.F.101
//   <episode>.small.png next to it is the list's thumbnail, <episode>.large.png the newest comic's wide
//   banner. The list is newest first: the client shows episode == total_count as the banner and
//   needs it on page 0 (error 2035 otherwise).
// Titles and release times are in assets/comics_en.json (Flipper World) and comics_stella_en.json
// (Stella's W.F.101); scripts/download_comics.cjs downloads the pages as <episode>.png. A comic is
// listed once the server date reaches its release.
// With no comics there, the list holds one placeholder (StarPoint's logo): an empty list stops the
// client (error 2035, "latest comic not found").

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { getSession } from "../../data/wdfpData";
import { generateDataHeaders, getServerDate } from "../../utils";
import comicsEn from "../../../assets/comics_en.json";
import comicsStellaEn from "../../../assets/comics_stella_en.json";

const COMIC_DIR = path.join(process.cwd(), ".cdn", "comics")
const PLACEHOLDER = path.join(process.cwd(), "web", "public", "img", "logo.png")
const PER_PAGE = 9

interface Comic { episode: number, title: string, file: string, thumbnail: string, banner: string }

type ComicList = { comics: { episode: number, title: string, commenceTime: string }[] }
const releasesOf = (list: ComicList) => new Map(list.comics.map(c => [c.episode, { title: c.title, at: Date.parse(c.commenceTime.replace(" ", "T") + "Z") }]))
/** Official titles and release times (UTC), by kind and episode: 0 Flipper World, 1 Stella's W.F.101. */
const RELEASES: Record<number, Map<number, { title: string, at: number }>> = { 0: releasesOf(comicsEn as ComicList), 1: releasesOf(comicsStellaEn as ComicList) }

/** The comics of one kind that are out on the server date, newest first. */
function comicsOf(kind: number): Comic[] {
    const dir = path.join(COMIC_DIR, String(kind))
    let files: string[] = []
    try { files = readdirSync(dir) } catch { }
    const now = getServerDate().getTime()
    const comics = files.flatMap(file => {
        const match = /^(\d+)\s*(.*)\.(png|jpe?g)$/i.exec(file)
        if (!match || /\.(small|large)\.(png|jpe?g)$/i.test(file)) return []
        const episode = Number(match[1])
        const release = RELEASES[kind]?.get(episode)
        if (release !== undefined && release.at > now) return [] // not out yet on the server date
        const small = path.join(dir, `${episode}.small.png`)
        const large = path.join(dir, `${episode}.large.png`)
        const full = path.join(dir, file)
        return [{ episode, title: release?.title ?? (match[2] || `Episode ${episode}`), file: full, thumbnail: existsSync(small) ? small : full, banner: existsSync(large) ? large : full }]
    }).sort((a, b) => b.episode - a.episode)
    return comics.length > 0 ? comics : [{ episode: 1, title: "No comics available", file: PLACEHOLDER, thumbnail: PLACEHOLDER, banner: PLACEHOLDER }]
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/get_list", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, kind?: number, page_index?: number }
        const viewerId = Number(body?.viewer_id)
        if (isNaN(viewerId) || !(await getSession(String(viewerId)))) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })
        const kind = Number(body.kind) || 0
        const page = Number(body.page_index) || 0
        const comics = comicsOf(kind)
        // the images are served next to this route (same prefix, so the CN client's /cn path works too)
        const base = `http://${request.headers.host}${request.originalUrl.replace(/\/get_list(\?.*)?$/, "")}/image`
        const image = (episode: number, size = "") => `${base}?kind=${kind}&episode=${episode}${size}`
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "comic_list": comics.slice(page * PER_PAGE, (page + 1) * PER_PAGE).map(comic => ({
                    "episode": comic.episode,
                    "title": comic.title,
                    "media_image": { "main": image(comic.episode), "thumbnail_l": image(comic.episode, "&size=large"), "thumbnail_s": image(comic.episode, "&size=small") },
                })),
                "current_page_index": page,
                "total_count": comics.length,
            }
        })
    })

    fastify.get("/image", async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as { kind?: string, episode?: string, size?: string }
        const comic = comicsOf(Number(query.kind) || 0).find(c => c.episode === Number(query.episode))
        const file = comic === undefined ? null : query.size === "small" ? comic.thumbnail : query.size === "large" ? comic.banner : comic.file
        if (file === null || !existsSync(file)) return reply.status(404).send({ "error": "Not Found" })
        reply.header("content-type", /\.png$/i.test(file) ? "image/png" : "image/jpeg")
        return reply.send(readFileSync(file))
    })
}

export default routes;
