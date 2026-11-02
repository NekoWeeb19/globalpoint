// Makes a data zip for the companion's "Import a data zip" button from a running StarPoint
// (the same files as "Download from PC": GET /companion/manifest, /companion/file).
// Usage: node companion/tools/make-data-zip.cjs <out.zip> [server=http://127.0.0.1:8000] [save] [images] [comics] [patches] [schedule]
//   e.g. node companion/tools/make-data-zip.cjs companion-data.zip http://127.0.0.1:8000 images
// Without "save" the phone starts a new account. Needs `tar` with zip support (Windows 10+ tar.exe,
// bsdtar) or `zip`.
const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")

const [out, server = "http://127.0.0.1:8000", ...picks] = process.argv.slice(2)
if (!out) { console.error("usage: node make-data-zip.cjs <out.zip> [server] [save] [images] [comics] [patches]"); process.exit(1) }
const want = new Set(picks)
const query = ["save", "patches", "images", "comics", "schedule"].map(k => `${k}=${want.has(k) ? 1 : 0}`).join("&")

async function main() {
    const manifest = await (await fetch(`${server}/companion/manifest?${query}`)).json()
    for (const note of manifest.notes || []) console.log(`note: ${note}`)
    // staged next to the zip (not the system temp folder, which may be on a small drive)
    const work = fs.mkdtempSync(path.join(path.dirname(path.resolve(out)), ".companion-data-"))
    try {
        let done = 0
        for (const f of manifest.files) {
            const res = await fetch(`${server}/companion/file?path=${encodeURIComponent(f.path)}`)
            if (!res.ok) throw new Error(`${f.path}: HTTP ${res.status}`)
            const file = path.join(work, f.path)
            fs.mkdirSync(path.dirname(file), { recursive: true })
            fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
            done += f.size
            process.stdout.write(`\r${(done / 1048576).toFixed(1)} / ${(manifest.totalSize / 1048576).toFixed(1)} MB`)
        }
        const env = Object.entries(manifest.env || {}).map(([k, v]) => `${k}="${v}"`).join("\n")
        if (env) fs.writeFileSync(path.join(work, ".env"), env + "\n")
        const target = path.resolve(out)
        fs.rmSync(target, { force: true })
        const items = fs.readdirSync(work)
        try {
            execFileSync("tar", ["-a", "-c", "-f", target, ...items], { cwd: work, stdio: "inherit" })
        } catch {
            execFileSync("zip", ["-r", "-q", target, ...items], { cwd: work, stdio: "inherit" })
        }
        console.log(`\nWrote ${target} (${manifest.files.length} files)`)
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}
main().catch(e => { console.error(e.message); process.exit(1) })
