// Runs every offline test (scripts/run_tests.cjs) in a checkout that lacks the git-ignored game files, such as a
// git worktree, by borrowing them from a full checkout without letting any test write there:
//   - <full>/.cdn/en (the global game files, many GB) is linked in (a junction), read only by the tests;
//   - <full>/.cdn/mods/translations.zip and <full>/.cdn/translations-revert.zip are copied in (small);
//   - the tests run with <full>/.env (its CN paths) and STARPOINT_NO_CN_REBUILD=1, so nothing builds game updates.
//   - test_coop_partners gets <full>/.database to copy (it works on a temp copy; the original is only read).
// Before and after, it fingerprints the borrowed folders (every file's size and modified time under .cdn/en and
// .cdn/mods, and the revert zip) and fails if anything there changed. Whatever it added is removed again
// (the link is unlinked, never deleted through).
//
//   node scripts/run_tests_full.cjs <full checkout> [name filter]
//   e.g. node scripts/run_tests_full.cjs F:/starpoint-main
//
// Without a full checkout, `npm test` runs the same tests; the ones that need these files fail.
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const ROOT = path.join(__dirname, "..")
const [fullArg, filter = ""] = process.argv.slice(2)
if (!fullArg) { console.error("usage: node scripts/run_tests_full.cjs <full checkout> [name filter]"); process.exit(2) }
const FULL = path.resolve(fullArg)
if (path.resolve(ROOT) === FULL) { console.error("This checkout already is the full one: run `node scripts/run_tests.cjs` here."); process.exit(2) }

const borrowed = {
    en: path.join(FULL, ".cdn", "en"),
    mods: path.join(FULL, ".cdn", "mods"),
    revert: path.join(FULL, ".cdn", "translations-revert.zip"),
    env: path.join(FULL, ".env"),
}
for (const [name, p] of Object.entries(borrowed)) if (!fs.existsSync(p)) { console.error(`${name}: ${p} not found.`); process.exit(2) }

/** size + modified time of every file under the borrowed folders (a write anywhere changes it). */
function fingerprint() {
    const out = []
    const walk = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name)
            if (entry.isDirectory()) walk(p)
            else { const st = fs.statSync(p); out.push(`${p}|${st.size}|${st.mtimeMs}`) }
        }
    }
    walk(borrowed.en)
    walk(borrowed.mods)
    const st = fs.statSync(borrowed.revert)
    out.push(`${borrowed.revert}|${st.size}|${st.mtimeMs}`)
    return out.sort()
}

const cdn = path.join(ROOT, ".cdn")
const added = [] // { path, kind: "link" | "file" | "dir" }, removed in reverse order
const ensureDir = dir => { if (!fs.existsSync(dir)) { ensureDir(path.dirname(dir)); fs.mkdirSync(dir); added.push({ path: dir, kind: "dir" }) } }

function cleanUp() {
    for (const item of added.reverse()) {
        try {
            if (item.kind === "link" || item.kind === "file") fs.unlinkSync(item.path) // a junction is unlinked, never followed
            else fs.rmdirSync(item.path) // only if empty: anything a test left there stays and is reported
        } catch (e) { console.log(`left in place: ${item.path} (${e.code ?? e.message})`) }
    }
}

let status = 1
const before = fingerprint()
try {
    ensureDir(cdn)
    const enLink = path.join(cdn, "en")
    if (!fs.existsSync(enLink)) { fs.symlinkSync(borrowed.en, enLink, "junction"); added.push({ path: enLink, kind: "link" }) }
    const modsDir = path.join(cdn, "mods")
    ensureDir(modsDir)
    for (const [from, to] of [[path.join(borrowed.mods, "translations.zip"), path.join(modsDir, "translations.zip")], [borrowed.revert, path.join(cdn, "translations-revert.zip")]]) {
        if (!fs.existsSync(to)) { fs.copyFileSync(from, to); added.push({ path: to, kind: "file" }) }
    }

    const tests = fs.readdirSync(__dirname).filter(f => /^test_.*\.mjs$/.test(f) && f !== "test_cn_client.mjs" && f.includes(filter)).sort()
    let failed = 0
    for (const test of tests) {
        // test_coop_partners copies a save to work on: the full checkout's (this one's is empty in a worktree)
        const args = test === "test_coop_partners.mjs" ? ["", path.join(FULL, ".database")] : []
        const run = spawnSync(process.execPath, [`--env-file=${borrowed.env}`, path.join("scripts", test), ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, STARPOINT_NO_CN_REBUILD: "1" } })
        const lastLine = `${run.stdout}${run.stderr}`.trim().split(/\r?\n/).pop()
        if (run.status !== 0) failed++
        console.log(`${run.status === 0 ? "pass" : "FAIL"}  ${test.padEnd(36)} ${lastLine}`)
    }
    console.log(`\n${tests.length - failed} of ${tests.length} passed${failed ? `, ${failed} failed` : ""}`)
    status = failed ? 1 : 0
} finally {
    cleanUp()
    const after = fingerprint()
    const changed = after.filter(x => !before.includes(x)).concat(before.filter(x => !after.includes(x)))
    if (changed.length > 0) {
        console.log(`\nWARNING: ${changed.length} change(s) in the borrowed folders of ${FULL}:`)
        for (const c of changed.slice(0, 10)) console.log(`  ${c}`)
        status = 1
    } else console.log(`The borrowed game files in ${FULL} are unchanged (${before.length} files checked).`)
}
process.exit(status)
