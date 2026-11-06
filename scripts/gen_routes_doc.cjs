// Builds docs/routes.md: every route the server answers, read from the server itself (it is started
// with STARPOINT_LIST_ROUTES, which lists the routes and exits without serving anything), with the
// source file, which app calls it, and whether the reply is a fixed placeholder.
//
//   npx tsc -p .   (the server must be built)
//   node scripts/gen_routes_doc.cjs
const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFileSync } = require("child_process")

const ROOT = path.join(__dirname, "..")
const OUT = path.join(ROOT, "docs", "routes.md")
const API = "/latest/api/index.php"

// 1. the routes, from the server (started in an empty folder so it touches no saves)
const work = fs.mkdtempSync(path.join(os.tmpdir(), "starpoint-routes-"))
const listFile = path.join(work, "routes.json")
const envFile = fs.existsSync(path.join(ROOT, ".env")) ? path.join(ROOT, ".env") : path.join(ROOT, ".env.example")
execFileSync(process.execPath, [`--env-file=${envFile}`, path.join(ROOT, "out", "server.js")], {
    cwd: work, env: { ...process.env, STARPOINT_LIST_ROUTES: listFile }, stdio: "ignore",
})
const routes = JSON.parse(fs.readFileSync(listFile, "utf8"))
fs.rmSync(work, { recursive: true, force: true })

// 2. the source files that can register them
const sources = []
const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (p.endsWith(".ts")) sources.push({ file: path.relative(ROOT, p).split(path.sep).join("/"), text: fs.readFileSync(p, "utf8") })
    }
}
walk(path.join(ROOT, "src", "routes"))
// features in src/nya can register their own routes too (e.g. exchangeCampaigns.ts, under the API prefix)
walk(path.join(ROOT, "src", "nya"))

/** Which source folder registers routes under a prefix. */
function groupOf(prefix, url) {
    if (url.startsWith(API)) return { key: "api", files: f => f.startsWith("src/routes/api/") || f.startsWith("src/nya/") }
    if (url.startsWith("/companion")) return { key: "other", files: f => f === "src/routes/companion.ts" }
    if (url.startsWith("/api/") || url === "/api") return { key: "dashboardApi", files: f => f.startsWith("src/routes/web_api/") }
    if (url.startsWith("/openapi")) return { key: "kakao", files: f => f === "src/routes/openapi.ts" }
    if (url.startsWith("/infodesk")) return { key: "kakao", files: f => f === "src/routes/infodesk.ts" }
    if (url.startsWith("/starpoint")) return { key: "other", files: f => f === "src/routes/battleLog.ts" }
    if (url.includes("*")) return { key: "files", files: () => false }
    if (url.startsWith("/cn")) return { key: "cnExtra", files: f => f === "src/routes/cnVersion.ts" }
    return { key: "dashboard", files: f => f.startsWith("src/routes/web/") }
}

const ROUTE_CALL = /(fastify\.(get|post|put|delete|patch|all)\(|registerStaticRoute\()/g

/** The registering file and the text of the handler, found by the route's path. */
function findSource(route, group) {
    const sub = route.url.slice(route.prefix.length) || "/"
    const candidates = sources.filter(s => group.files(s.file))
    const quoted = [`"${sub}"`, `'${sub}'`, `\`${sub}\``]
    // a file that registers the path itself wins over one that only mentions it (src/nya files are read too)
    const registers = s => quoted.some(q => s.text.includes(`(${q}`))
    candidates.sort((a, b) => Number(registers(b)) - Number(registers(a)))
    for (const s of candidates) {
        const at = Math.max(...quoted.map(q => s.text.indexOf(q)))
        if (at < 0) continue
        ROUTE_CALL.lastIndex = at + 1
        const next = ROUTE_CALL.exec(s.text)
        return { file: s.file, body: s.text.slice(at, next ? next.index : s.text.length) }
    }
    // a path built in code (e.g. a template string): match its fixed start
    const head = sub.split("${")[0].split(/[_.]/)[0]
    const s = candidates.find(c => head.length > 1 && c.text.includes(head))
    return s ? { file: s.file, body: "" } : { file: "", body: "" }
}

// 3. which CN endpoints the CN app was seen calling (logs/cn_requests.log, when there is one)
const seen = new Set()
const log = path.join(ROOT, "logs", "cn_requests.log")
if (fs.existsSync(log)) for (const m of fs.readFileSync(log, "utf8").matchAll(/^\S+ (?:GET|POST) \/cn\/api\/index\.php(\/[^\s?]*)/gm)) seen.add(m[1])

// 4. the rows
const rows = { api: [], cnExtra: [], kakao: [], dashboard: [], dashboardApi: [], files: [], other: [] }
const done = new Set()
for (const r of routes) {
    const methods = (Array.isArray(r.method) ? r.method : [r.method]).filter(m => m !== "HEAD")
    if (methods.length === 0) continue
    const id = `${methods.join(",")} ${r.url}`
    if (done.has(id)) continue
    done.add(id)
    const group = groupOf(r.prefix, r.url)
    const { file, body } = findSource(r, group)
    const notes = []
    let app = "both"
    if (file === "src/routes/api/cn.ts" || group.key === "cnExtra") app = "CN"
    if (group.key === "kakao") app = "global"
    if (group.key === "dashboard" || group.key === "dashboardApi") app = "dashboard"
    if (/inCnRequest\(|isCnRequest\(/.test(body) && app === "both") notes.push("CN-specific reply")
    const oneLine = body.replace(/\s+/g, " ").trim()
    // stubs.ts: a fixed reply, unless it also does something (a callback after the reply data)
    const stub = file === "src/routes/api/stubs.ts" && !/=>/.test(body.split("\n")[0])
    if (stub || /^"[^"]*", async \([^)]*\) => sendMsgpack\(reply, [^()]*\)\)/.test(oneLine)) notes.push("fixed reply (placeholder)")
    else if (file === "src/routes/api/stubs.ts") notes.push("fixed reply, plus saves state")
    const sub = group.key === "api" ? r.url.slice(API.length) : r.url
    rows[group.key].push({ methods: methods.join(", "), url: sub, file, app, notes, seen: group.key === "api" && seen.has(sub) })
}
for (const list of Object.values(rows)) list.sort((a, b) => a.url.localeCompare(b.url))

// 5. the page
const link = file => file ? `[${file.replace(/^src\/routes\//, "")}](../${file})` : "?"
const table = (list, { showSeen = false, showApp = false } = {}) => {
    const head = ["Endpoint", "Method", ...(showApp ? ["App"] : []), "Source", "Notes", ...(showSeen ? ["Seen from CN app"] : [])]
    const lines = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`]
    for (const r of list) lines.push(`| \`${r.url}\` | ${r.methods} | ${showApp ? `${r.app} | ` : ""}${link(r.file)} | ${r.notes.join("; ")} |${showSeen ? ` ${r.seen ? "yes" : ""} |` : ""}`)
    return lines.join("\n")
}
const count = list => list.length
const api = rows.api
const page = `# GlobalPoint routes

Every route the GlobalPoint server answers, listed by the server itself. **Generated** by
\`scripts/gen_routes_doc.cjs\`; don't edit by hand. Rebuild it after adding or changing routes:

\`\`\`
npx tsc -p .
node scripts/gen_routes_doc.cjs
\`\`\`

For the global app's captured official traffic and upstream's 2024 status list, see
[global/routes.md](global/routes.md).

**Columns**
- **App:** \`both\` = the global and CN apps share the handler; \`CN\` = only the CN app calls it;
  \`global\` = only the global app (Kakao's login/platform services).
- **Notes:** \`CN-specific reply\` = the handler itself answers the CN app differently (many more
  routes differ inside the shared code they call, which this can't see); \`fixed reply
  (placeholder)\` = always the same small answer, enough for the game to carry on.
- **Seen from CN app:** the CN app called it in this PC's request log (\`logs/cn_requests.log\`).
  Blank doesn't mean unused: only what was played on this PC is logged.

## Game API (${count(api)} endpoints)

The global app calls \`${API}/<endpoint>\`. The CN app calls \`/cn/api/index.php/<endpoint>\`, which
the server rewrites to the same path, so both apps share these handlers. Replies to the CN app are
also converted to its format (\`adaptCnReply\` in \`src/lib/cnClient.ts\`).

${table(api, { showSeen: seen.size > 0, showApp: true })}

## CN app extras (${count(rows.cnExtra)})

Outside the API: the CN app's version check and crash/debug reports (\`/cn/...\`).

${table(rows.cnExtra)}

## Global app: Kakao services (${count(rows.kakao)})

Login and platform calls the global app makes to Kakao's services, answered locally.

${table(rows.kakao)}

## Game files (${count(rows.files)})

Static downloads.

| Path | What |
|---|---|
${rows.files.map(r => `| \`${r.url}\` | ${{ "/cn/cdn/*": "CN base game files (`CN_CDN_DIR`)", "/cn/patch/*": "StarPoint's CN updates (`<CDN_DIR>/cn_patches`)", "/patch/Live/2.0.0/*": "global game files and mods (`CDN_DIR`)", "/public/*": "the dashboard's stylesheet, fonts and images" }[r.url] ?? ""} |`).join("\n")}

## Dashboard pages (${count(rows.dashboard)})

${table(rows.dashboard)}

## Dashboard API (${count(rows.dashboardApi)})

What the dashboard pages call. These change the server's state and have no login. With
\`LISTEN_HOST\` at \`127.0.0.1\` (the default, also on the phone companion) only the same device
can reach them. Copying to a phone and setup 2 ([INSTALL.md](INSTALL.md)) set it to \`0.0.0.0\`, which lets every device on your
network use the dashboard too, so do that only on a network you trust, such as your home Wi-Fi.

${table(rows.dashboardApi)}

## Other (${count(rows.other)})

${table(rows.other)}
`
fs.writeFileSync(OUT, page)
console.log(`${OUT}: ${Object.values(rows).reduce((n, l) => n + l.length, 0)} routes (${api.length} game API, ${seen.size} CN endpoints in the request log)`)
const unknown = Object.values(rows).flat().filter(r => !r.file && !r.url.includes("*"))
if (unknown.length) console.log("no source found for:", unknown.map(r => r.url).join(", "))
