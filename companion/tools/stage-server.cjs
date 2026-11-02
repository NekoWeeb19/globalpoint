// Gathers the server the companion app carries into companion/build/server-stage:
// out/ (run `npx tsc -p .` in the repo first), assets/, web/, scripts/, package.json,
// companion-main.js and production node_modules without better-sqlite3 (the phone uses node:sqlite,
// see src/data/sqlite.ts) or tailwindcss (only builds the dashboard CSS, already in web/).
// Gradle zips the stage into the APK (app/build.gradle, task bundleServer).
// Usage: node companion/tools/stage-server.cjs
const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

const repo = path.join(__dirname, "..", "..")
const stage = path.join(__dirname, "..", "build", "server-stage")

if (!fs.existsSync(path.join(repo, "out", "server.js"))) {
    console.error("out/server.js is missing: run `npx tsc -p .` in the repo first")
    process.exit(1)
}

// the dashboard's stylesheet is generated, not in git
if (!fs.existsSync(path.join(repo, "web", "public", "tailwind.css"))) {
    execSync("npm run css", { cwd: repo, stdio: "inherit" })
}

fs.rmSync(stage, { recursive: true, force: true })
fs.mkdirSync(stage, { recursive: true })
for (const dir of ["out", "assets", "web", "scripts"]) {
    fs.cpSync(path.join(repo, dir), path.join(stage, dir), { recursive: true })
}
for (const file of ["package.json", "package-lock.json"]) fs.copyFileSync(path.join(repo, file), path.join(stage, file))
fs.copyFileSync(path.join(__dirname, "..", "server", "companion-main.js"), path.join(stage, "companion-main.js"))

const npm = (args) => execSync(`npm ${args}`, { cwd: stage, stdio: "inherit" })
npm("ci --omit=dev --ignore-scripts --no-audit --no-fund")
npm("uninstall better-sqlite3 tailwindcss --omit=dev --ignore-scripts --no-audit --no-fund")
fs.rmSync(path.join(stage, "package-lock.json"), { force: true })

let files = 0, bytes = 0
const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(p)
        else { files++; bytes += fs.statSync(p).size }
    }
}
walk(stage)
console.log(`server stage: ${files} files, ${(bytes / 1048576).toFixed(1)} MB in ${stage}`)
