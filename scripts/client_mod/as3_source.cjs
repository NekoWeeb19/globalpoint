// The as3/ folder the game-code patches compile from (FFDec -importScript). With --zh on the command line (the
// Chinese game app), a copy in <work>/as3-zh with the messages in Chinese (as3_zh.json); else as3/ itself.
const fs = require("fs")
const path = require("path")

const AS3 = path.join(__dirname, "as3")

function as3Source(work) {
    if (!process.argv.includes("--zh")) return AS3
    const out = path.join(work, "as3-zh")
    fs.rmSync(out, { recursive: true, force: true })
    fs.cpSync(AS3, out, { recursive: true })
    const table = JSON.parse(fs.readFileSync(path.join(__dirname, "as3_zh.json"), "utf8"))
    for (const [name, pairs] of Object.entries(table)) {
        if (name.startsWith("_")) continue
        const file = path.join(out, "starpoint", name)
        let text = fs.readFileSync(file, "utf8")
        for (const [en, zh] of pairs) {
            if (!text.includes(en)) throw new Error(`${name}: not found, update as3_zh.json: ${en}`)
            text = text.split(en).join(zh)
        }
        fs.writeFileSync(file, text)
    }
    console.log(`as3 sources in Chinese: ${out}`)
    return out
}

module.exports = { as3Source }
