// News posts written on the dashboard's News tab (.database/news.json), shown by both apps:
//  - the CN client lists them in its in-game News board (news/index, news/get_info...; src/routes/api/cn.ts)
//  - the global client's News button opens a web page (its urlHomeNews), served at /news/board
//
// A post: { id, title, body (plain text; blank lines start paragraphs), category, apps, date }.
// CN's board has tabs by category: 1 Topics, 2 Events, 3 Bugs & maintenance, 4 System (its own list,
// news/system_index).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { getServerDate } from "../utils"

export type NewsApp = "global" | "cn"
export interface NewsPost {
    id: number
    title: string
    body: string
    category: 1 | 2 | 3 | 4
    apps: NewsApp[]
    /** When it was posted, on the server's game clock (ISO, UTC). */
    date: string
}

const FILE = path.join(process.cwd(), ".database", "news.json")
export const NEWS_CATEGORIES: Readonly<Record<number, string>> = Object.freeze({ 1: "Topics", 2: "Events", 3: "Bugs & maintenance", 4: "System" })

function readAll(): NewsPost[] {
    if (!existsSync(FILE)) return []
    try {
        const raw = JSON.parse(readFileSync(FILE, "utf8"))
        return Array.isArray(raw) ? raw : []
    } catch {
        return []
    }
}

function writeAll(posts: NewsPost[]) {
    mkdirSync(path.dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(posts, null, 1))
}

/** Every post, newest first; only one app's when given. */
export function listNews(app?: NewsApp): NewsPost[] {
    return readAll()
        .filter(post => app === undefined || post.apps.includes(app))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
}

export function getNews(id: number): NewsPost | null {
    return readAll().find(post => post.id === id) ?? null
}

/** Checks a post from the dashboard; returns the error or the cleaned post fields. */
function clean(raw: unknown): string | Omit<NewsPost, "id" | "date"> {
    const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>
    const title = typeof value.title === "string" ? value.title.trim() : ""
    const body = typeof value.body === "string" ? value.body.replace(/\r\n/g, "\n").trim() : ""
    const category = Number(value.category)
    const apps = Array.isArray(value.apps) ? value.apps.filter((a): a is NewsApp => a === "global" || a === "cn") : []
    if (title === "") return "The title is empty."
    if (title.length > 120) return "The title is too long (120 characters at most)."
    if (body === "") return "The text is empty."
    if (!(category in NEWS_CATEGORIES)) return "Pick a category."
    if (apps.length === 0) return "Pick at least one app."
    return { title, body, category: category as NewsPost["category"], apps: [...new Set(apps)] }
}

/** Adds a post (no id) or changes one (with its id). Returns the post, or an error message. */
export function saveNews(raw: unknown): NewsPost | string {
    const fields = clean(raw)
    if (typeof fields === "string") return fields
    const posts = readAll()
    const id = Number((raw as Record<string, unknown>)?.id)
    if (Number.isSafeInteger(id) && id > 0) {
        const index = posts.findIndex(post => post.id === id)
        if (index < 0) return "That post doesn't exist any more."
        posts[index] = { ...posts[index], ...fields }
        writeAll(posts)
        return posts[index]
    }
    const post: NewsPost = { id: Math.max(0, ...posts.map(p => p.id)) + 1, date: getServerDate().toISOString(), ...fields }
    posts.push(post)
    writeAll(posts)
    return post
}

export function deleteNews(id: number): boolean {
    const posts = readAll()
    const left = posts.filter(post => post.id !== id)
    if (left.length === posts.length) return false
    writeAll(left)
    return true
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** A post's text as the CN client's rich text (paragraphs, line breaks). */
export function newsHtml(post: NewsPost): string {
    // the CN client parses this as XML (error C7613 / #1085 on an unclosed tag), so <br/>, not <br>
    return post.body.split(/\n{2,}/).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, "<br/>")}</p>`).join("")
}

/** "YYYY-MM-DD hh:mm:ss" in Japan time (the CN client reads news dates as Japan time). */
export function newsJapanDate(post: NewsPost): string {
    return new Date(Date.parse(post.date) + 9 * 3600_000).toISOString().slice(0, 19).replace("T", " ")
}

// the CN client's label tag (1 update, 2 summon, 3 event, 4 news, 6 important, 8 system) and list icon
// (1 important, 2 update, 3 news) for each category; icon 0 has no picture and stops the client
const CN_LOOK: Record<NewsPost["category"], { label: number, thumbnail: number }> = {
    1: { label: 4, thumbnail: 3 },
    2: { label: 3, thumbnail: 3 },
    3: { label: 6, thumbnail: 1 },
    4: { label: 8, thumbnail: 2 },
}

/** A post in the CN client's form. */
export function cnNewsItem(post: NewsPost) {
    return {
        id: post.id,
        title: post.title,
        // the client's rich text needs <html> with <body> right inside it (error 7606 otherwise)
        html: `<html lang="en"><body class="body" style_id="1"><div class="container">${newsHtml(post)}</div></body></html>`,
        date: newsJapanDate(post),
        added_time: null,
        label: CN_LOOK[post.category].label,
        thumbnail: CN_LOOK[post.category].thumbnail,
        thumbnail_path: null,
    }
}

/** The public page global's News button opens: every global post, newest first. */
export function newsBoardPage(): string {
    const posts = listNews("global")
    const items = posts.map(post => `
    <article>
      <div class="meta"><span class="tag">${escapeHtml(NEWS_CATEGORIES[post.category])}</span> ${escapeHtml(post.date.slice(0, 10))}</div>
      <h2>${escapeHtml(post.title)}</h2>
      ${newsHtml(post)}
    </article>`).join("")
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>News</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f3ee; --card: #ffffff; --text: #1d1b19; --muted: #6b655e; --accent: #c98a00; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1b1916; --card: #26231f; --text: #ece6dd; --muted: #a59d92; --accent: #f0b429; } }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
  h1 { margin: 0 0 16px; font-size: 1.6rem; }
  article { background: var(--card); border-radius: 16px; padding: 16px; margin-bottom: 12px; }
  h2 { margin: 6px 0 8px; font-size: 1.2rem; }
  .meta { color: var(--muted); font-size: .9rem; }
  .tag { color: var(--accent); font-weight: 600; }
  p { margin: 0 0 8px; overflow-wrap: anywhere; }
  .empty { color: var(--muted); }
</style>
</head>
<body>
<h1>News</h1>
${items || '<p class="empty">No news right now.</p>'}
</body>
</html>`
}
