// The Unit editor's Skill tab on a server without CN's full game files (the phone companion keeps only CN's data
// tables) and without the game APK: every unit's skill script still reads, from assets/skill_editor/game_scripts.json
// (scripts/gen_skill_scripts_bundle.cjs). Player report 2026-11-21: "Couldn't read the script: No script
// battle/action/skill/action/rare4/alk$alk_1" on a phone. Runs with CN_CDN_DIR pointing at an empty folder.
//   node scripts/test_skill_scripts_shipped.mjs
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const empty = fs.mkdtempSync(path.join(os.tmpdir(), "no-cn-files-"))
process.env.CN_CDN_DIR = empty // no CN game files at all
process.env.CN_GAME_APK = path.join(empty, "none.apk") // and no game APK

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

try {
    const SE = require("./skill_editor.cjs")
    const shipped = JSON.parse(fs.readFileSync(new URL("../assets/skill_editor/game_scripts.json", import.meta.url), "utf8"))
    const paths = Object.keys(shipped)
    check("the shipped file has CN's skill scripts", paths.length >= 1000, paths.length)
    for (const p of ["battle/action/skill/action/rare4/alk$alk_1", "battle/action/skill/action/rare4/alk$alk_2"]) {
        const script = await SE.readScript(p)
        check(`${p} reads without CN files (built into the game app)`, Array.isArray(script) && script[0] === "ActionDsl", JSON.stringify(script)?.slice(0, 60))
    }
    // a sample of other units' scripts
    let bad = 0
    for (const p of paths.filter((_, i) => i % 50 === 0)) {
        const script = await SE.readScript(p)
        if (!(Array.isArray(script) && script[0] === "ActionDsl")) bad++
    }
    check("a sample of other units' scripts read too", bad === 0, bad)
    check("an unknown script is still 'no script'", (await SE.readScript("battle/action/skill/action/rare4/nobody_1")) === null)
} catch (error) {
    console.error(error)
    failures++
} finally {
    try { fs.rmSync(empty, { recursive: true, force: true }) } catch { }
}

console.log(failures === 0 ? "All shipped skill script tests passed." : `${failures} shipped skill script test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
