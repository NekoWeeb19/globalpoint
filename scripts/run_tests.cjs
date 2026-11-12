// Runs every offline test (scripts/test_*.mjs) against the built server code in out/ and lists the results.
// test_cn_client.mjs is left out: it plays against a running server (run it by hand).
//
//   npm test          (builds first)
//   node scripts/run_tests.cjs [name filter]
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const ROOT = path.join(__dirname, "..")
const NEEDS_SERVER = new Set(["test_cn_client.mjs"])
const filter = process.argv[2] ?? ""
const envFile = fs.existsSync(path.join(ROOT, ".env")) ? ".env" : ".env.example"

const tests = fs.readdirSync(__dirname).filter(f => /^test_.*\.mjs$/.test(f) && !NEEDS_SERVER.has(f) && f.includes(filter)).sort()
let failed = 0
for (const test of tests) {
    const run = spawnSync(process.execPath, [`--env-file=${envFile}`, path.join("scripts", test)], { cwd: ROOT, encoding: "utf8", env: { ...process.env, STARPOINT_NO_CN_REBUILD: "1" } })
    const lastLine = `${run.stdout}${run.stderr}`.trim().split(/\r?\n/).pop()
    if (run.status !== 0) failed++
    console.log(`${run.status === 0 ? "pass" : "FAIL"}  ${test.padEnd(36)} ${lastLine}`)
}
console.log(`\n${tests.length - failed} of ${tests.length} passed${failed ? `, ${failed} failed` : ""}`)
process.exit(failed ? 1 : 0)
