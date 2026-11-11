// Automatic event posts on the CN app's News board, like the live game's announcements: built from the event
// schedule each time the board is opened (nothing is stored), so they always match the server's date, moved events
// and time jumps included.
//
//  - "Coming soon": starts within the next 7 days
//  - "Now on": running now
//  - "Ended": ended within the last 7 days
// Events and summon banners in the CN app; things that run for years (permanent portals, The Haunt) are left out.
// Shown Now on first (ending soonest first), then Coming soon (starting soonest first), then Ended (latest first).
// Summon banners that opened with an event (and still start with it) are in that event's post, not posts of their
// own. Each post shows its picture from the game's own files (<img src="file://<path>">; paths from
// assets/event_art_paths_cn.json, written by scripts/gen_event_catalog.cjs --cn). Newest first, at most 100 per tab.
// Off with the switch on the dashboard's News tab (src/nya/serverSettings.ts autoNews).

import artPathsData from "../../assets/event_art_paths_cn.json"
import { getServerDate } from "../utils"
import { getEventOverview } from "./eventSchedule"
import { NewsPost } from "./news"
import { autoNewsOn } from "./serverSettings"

const DAY = 86_400_000
const SOON = 7 * DAY, AFTER_END = 7 * DAY, PERMANENT = 400 * DAY
const MAX_POSTS = 100
const CATEGORY = 2 // the Events tab
/** Ids far from the dashboard's own posts (they count up from 1). */
const ID_BASE = 900_000_000

/** event key -> [path in the CN game files, width, height] (scripts/gen_event_catalog.cjs --cn) */
const artPaths = artPathsData as unknown as Record<string, [string, number?, number?]>

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC"

function idOf(key: string): number {
    let h = 2166136261
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0
    return ID_BASE + (h % 99_999_999)
}

function span(ms: number): string {
    const hours = Math.max(0, Math.round(ms / 3_600_000))
    const days = Math.floor(hours / 24)
    if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`
    return `${hours} hour${hours === 1 ? "" : "s"}`
}

// the game shrinks an image to the post's width keeping its shape, so giving its own size scaled up makes it fill the
// width; the size is the CN game file's own (recorded with the path), so the picture isn't squashed
function picture(d: { key: string }): string {
    const art = artPaths[d.key]
    if (!art) return ""
    const [file, width, height] = art
    const scale = width && height ? ` width="${width * 10}" height="${height * 10}"` : ""
    return `<img src="file://${escape(file)}.png"${scale}/>`
}

type Dated = { key: string, name: string, kind: string, start: number, end: number, banners: { key: string, name: string }[] }

function datedEvents(): Dated[] {
    const out: Dated[] = []
    for (const e of getEventOverview().events) {
        if (!e.servers.includes("cn")) continue
        const from = e.scheduled ?? e.cn ?? e.original
        const start = Date.parse(from.start), end = Date.parse(from.end)
        if (isNaN(start) || isNaN(end) || end - start >= PERMANENT) continue
        const kind = e.family === "gacha" ? (e.bannerType === "armament" ? "Armament summon" : "Unit summon") : e.familyLabel
        const banners = (e.banners as { id?: string, name: string }[]).filter(b => b.id).map(b => ({ key: `gacha:${b.id}`, name: b.name }))
        out.push({ key: e.key, name: e.name + (e.rerun ? " (rerun)" : ""), kind, start, end, banners })
    }
    return out
}

/** The automatic posts right now, newest first. */
export function autoNewsPosts(now: number = getServerDate().getTime()): NewsPost[] {
    if (!autoNewsOn()) return []
    const all = datedEvents()
    const byKey = new Map(all.map(d => [d.key, d]))
    // banners that start with their event go in its post
    const folded = new Set<string>()
    const foldedInto = new Map<string, Dated[]>()
    for (const d of all) {
        if (d.key.startsWith("gacha:")) continue
        const inPost: Dated[] = []
        for (const b of d.banners) {
            const banner = byKey.get(b.key)
            if (banner && Math.abs(banner.start - d.start) < 3_600_000) { folded.add(b.key); inPost.push(banner) }
        }
        foldedInto.set(d.key, inPost)
    }

    // shown in this order: Now on (ending soonest first), Coming soon (starting soonest first), Ended (latest first)
    const posts: { post: NewsPost, group: number, order: number }[] = []
    for (const d of all) {
        if (folded.has(d.key)) continue
        let state: "soon" | "on" | "ended", date: number
        if (now < d.start && d.start - now <= SOON) { state = "soon"; date = d.start - SOON }
        else if (d.start <= now && now <= d.end) { state = "on"; date = d.start }
        else if (d.end < now && now - d.end <= AFTER_END) { state = "ended"; date = d.end }
        else continue
        const title = { soon: "Coming soon", on: "Now on", ended: "Ended" }[state] + ": " + d.name
        const when = state === "soon" ? `Starts in ${span(d.start - now)}.` : state === "on" ? `Ends in ${span(d.end - now)}.` : "This has ended."
        // "Hanifolk Carnival: Hanifolk Carnival" -> just the name
        const what = d.name.toLowerCase().startsWith(d.kind.toLowerCase()) ? d.name : `${d.kind}: ${d.name}`
        let html = picture(d)
            + `<p>${escape(what)}</p>`
            + `<p>${escape(utc(d.start))} to ${escape(utc(d.end))}</p>`
            + `<p>${escape(when)}</p>`
        for (const banner of foldedInto.get(d.key) ?? []) {
            html += `<p>With the ${escape(banner.kind.toLowerCase())}: ${escape(banner.name)}</p>` + picture(banner)
        }
        const post: NewsPost = {
            id: idOf(d.key), title, body: "", category: CATEGORY, apps: ["cn"],
            date: new Date(Math.min(date, now)).toISOString(),
            html: `<div>${html}</div>`,
        }
        posts.push(state === "on" ? { post, group: 0, order: d.end } : state === "soon" ? { post, group: 1, order: d.start } : { post, group: 2, order: -d.end })
    }
    return posts.sort((a, b) => a.group - b.group || a.order - b.order || a.post.id - b.post.id).slice(0, MAX_POSTS).map(x => x.post)
}

/** One automatic post by its id (when the game opens it), or null. */
export function autoNewsPost(id: number): NewsPost | null {
    return autoNewsPosts().find(post => post.id === id) ?? null
}
