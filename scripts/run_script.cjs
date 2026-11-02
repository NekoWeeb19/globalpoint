// Runs one of these scripts in a worker thread instead of a second Node process. On the phone
// companion (embedded Node) process.execPath is Android's app launcher, not Node, so
// execFile(process.execPath, ...) can't start a script there; worker threads work everywhere. A worker
// behaves like its own run: fresh modules, its own argv/env copy, and process.exit() ends only the
// worker (its exit code is the result).
//
//   const { runScript } = require("./run_script.cjs")
//   const { code, stdout, stderr } = await runScript(file, { args, env, echo })
//     echo: also pass the worker's output on to this thread's stdout/stderr (as stdio "inherit" did)
const { Worker } = require("worker_threads")

function runScript(file, { args = [], env = process.env, echo = false } = {}) {
    return new Promise(resolve => {
        let stdout = "", stderr = ""
        const worker = new Worker(file, { argv: args, env: { ...env }, stdout: true, stderr: true })
        worker.stdout.on("data", d => { stdout += d; if (echo) process.stdout.write(d) })
        worker.stderr.on("data", d => { stderr += d; if (echo) process.stderr.write(d) })
        worker.on("error", e => { stderr += `${e && e.stack || e}\n` })
        worker.on("exit", code => {
            // the output streams can still hold the last chunk when "exit" fires
            setImmediate(() => resolve({ code, stdout, stderr }))
        })
    })
}

/** Runs a script and throws when it fails (like execFileSync). */
async function runScriptOrThrow(file, options) {
    const result = await runScript(file, options)
    if (result.code !== 0) throw new Error(`${file} failed (exit ${result.code}): ${result.stderr.trim().split("\n").slice(-3).join(" ")}`)
    return result
}

module.exports = { runScript, runScriptOrThrow }
