// The Comics screens (Menu > Other > Flipper World / Stella's W.F.101). The official comics were
// images on the official servers, which are gone, so comics come from a local folder:
//   .cdn/comics/<kind>/<episode> <title>.png (or .jpg)     kind 0 = Flipper World, 1 = Stella's W.F.101
//   <episode>.small.png next to it is the list's thumbnail, <episode>.large.png the newest comic's wide
//   banner. The list is newest first: the client shows episode == total_count as the banner and
//   needs it on page 0 (error 2035 otherwise).
// Titles and release times are in assets/comics_en.json (Flipper World) and comics_stella_en.json
// (Stella's W.F.101); scripts/download_comics.cjs downloads the pages as <episode>.png. A comic is
// listed once the server date reaches its release. The CN app gets them on its own calendar: global's first
// comics came out with global's launch (2021-09-08 14:00 UTC), so for CN they start with CN's launch (2021-10-26
// 10:00 China time), every release 47.5 days later (the CN calendar switch, 2026-11-22).
// With no comics there, the list holds one placeholder (StarPoint's logo): an empty list stops the
// client (error 2035, "latest comic not found").

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { getSession } from "../../data/wdfpData";
import { generateDataHeaders, getServerDate } from "../../utils";
import { cdnDir, inCnRequest } from "../../lib/cnClient";
import { chineseForRequest } from "../../nya/gameLanguage";
import comicsEn from "../../../assets/comics_en.json";
import comicsStellaEn from "../../../assets/comics_stella_en.json";

const COMIC_DIR = path.join(cdnDir(), "comics")
const PLACEHOLDER = path.join(process.cwd(), "web", "public", "img", "logo.png")
const PER_PAGE = 9
// global's first comics (2021-09-08 14:00 UTC) to CN's launch (2021-10-26 02:00 UTC)
const CN_COMIC_DELAY_MS = Date.parse("2021-10-26T02:00:00Z") - Date.parse("2021-09-08T14:00:00Z")

interface Comic { episode: number, title: string, file: string, thumbnail: string, banner: string }

type ComicList = { comics: { episode: number, title: string, commenceTime: string }[] }
const releasesOf = (list: ComicList) => new Map(list.comics.map(c => [c.episode, { title: c.title, at: Date.parse(c.commenceTime.replace(" ", "T") + "Z") }]))
/** Official titles and release times (UTC), by kind and episode: 0 Flipper World, 1 Stella's W.F.101. */
const RELEASES: Record<number, Map<number, { title: string, at: number }>> = { 0: releasesOf(comicsEn as ComicList), 1: releasesOf(comicsStellaEn as ComicList) }

// ---- the comics in Chinese (the game set to Chinese: docs/CHINESE.md), from a Chinese comics pack ----
// .cdn/comics_zh/<kind>/ in the Chinese StarPoint fork's layout (startpoint-cn, docs/systems/comic.md), so a set made
// for it goes in as it is:
//   <kind>/第N话 标题.jpg                     kind 0, Flipper World (弹射小世界): episode N, its title
//   <kind>/…第N课…今日课程：标题？.jpg          kind 1, Stella's W.F.101 (史黛拉的弹射世界讲座)
//   <kind>/main/<same name>.png (or .jpg)     the page; thumbnail_l/<same name>.jpg the wide banner;
//   thumbnail_s/<same name>.jpg the list's thumbnail
// The top-level .jpg names the episode and title. An episode the Chinese set doesn't have stays English.
const COMIC_ZH_DIR = path.join(cdnDir(), "comics_zh")

/** Episode and title from a Chinese comic's file name (the CN fork's parseKind0 / parseKind1). */
export function parseZhComicName(kind: number, file: string): { episode: number, title: string } | null {
    if (!/\.jpg$/i.test(file)) return null
    if (kind === 1) {
        const ep = /第(\d+)课/.exec(file)
        if (!ep) return null
        const title = /今日课程：(.+?)？?\.jpg$/i.exec(file)?.[1] ?? file.replace(/\.jpg$/i, "")
        return { episode: Number(ep[1]), title }
    }
    const m = /^第(\d+)话\s+(.+)\.jpg$/i.exec(file)
    return m ? { episode: Number(m[1]), title: m[2] } : null
}

/** The Chinese comics of one kind there are, by episode (none without a Chinese comics pack). */
function zhComicsOf(kind: number): Map<number, { title: string, file: string, thumbnail: string, banner: string }> {
    const out = new Map<number, { title: string, file: string, thumbnail: string, banner: string }>()
    const dir = path.join(COMIC_ZH_DIR, String(kind))
    let files: string[] = []
    try { files = readdirSync(dir) } catch { return out }
    for (const name of files) {
        const parsed = parseZhComicName(kind, name)
        if (!parsed || out.has(parsed.episode)) continue
        const png = path.join(dir, "main", name.replace(/\.jpg$/i, ".png"))
        const jpg = path.join(dir, "main", name)
        const file = existsSync(png) ? png : existsSync(jpg) ? jpg : path.join(dir, name)
        const small = path.join(dir, "thumbnail_s", name), large = path.join(dir, "thumbnail_l", name)
        out.set(parsed.episode, { title: parsed.title, file, thumbnail: existsSync(small) ? small : file, banner: existsSync(large) ? large : file })
    }
    return out
}

/** The comics of one kind that are out on the server date, newest first; Chinese ones where there are some and
 *  the game is set to Chinese. */
function comicsOf(kind: number): Comic[] {
    const english = englishComicsOf(kind)
    if (!chineseForRequest()) return english
    const zh = zhComicsOf(kind)
    if (zh.size === 0) return english
    const now = getServerDate().getTime()
    const shown = new Set<number>()
    const comics: Comic[] = english.filter(c => c.file !== PLACEHOLDER).map(c => {
        shown.add(c.episode)
        const z = zh.get(c.episode)
        return z ? { episode: c.episode, ...z } : c
    })
    // episodes only the Chinese set has, out on the server date when their release is known
    for (const [episode, z] of zh) {
        if (shown.has(episode)) continue
        const release = RELEASES[kind]?.get(episode)
        if (release !== undefined && release.at + (inCnRequest() ? CN_COMIC_DELAY_MS : 0) > now) continue
        comics.push({ episode, ...z })
    }
    comics.sort((a, b) => b.episode - a.episode)
    return comics.length > 0 ? comics : english
}

/** The English comics of one kind that are out on the server date, newest first. */
function englishComicsOf(kind: number): Comic[] {
    const dir = path.join(COMIC_DIR, String(kind))
    let files: string[] = []
    try { files = readdirSync(dir) } catch { }
    const now = getServerDate().getTime()
    const comics = files.flatMap(file => {
        const match = /^(\d+)\s*(.*)\.(png|jpe?g)$/i.exec(file)
        if (!match || /\.(small|large)\.(png|jpe?g)$/i.test(file)) return []
        const episode = Number(match[1])
        const release = RELEASES[kind]?.get(episode)
        const at = release === undefined ? undefined : release.at + (inCnRequest() ? CN_COMIC_DELAY_MS : 0)
        if (at !== undefined && at > now) return [] // not out yet on the server date
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
