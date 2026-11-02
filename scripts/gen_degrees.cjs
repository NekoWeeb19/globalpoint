// Builds assets/degree.json (every title, "degree" in the game's data) from the global client's own
// master table master/degree/degree (see scripts/cdn_master.cjs).
//
//   node scripts/gen_degrees.cjs
//
// Columns used: 0 pattern, 2 name, 4 how it's earned. Title 1 ("World Voyager") is everyone's default.
// The profile's "titles owned" maximum is the number of titles here (global showed 1282).

const path = require("path")
const fs = require("fs")
const { ROOT, readTable, parseCsvLine } = require("./cdn_master.cjs")

;(async () => {
    const table = await readTable("master/degree/degree.orderedmap")
    const degrees = {}
    for (const [id, line] of Object.entries(table)) {
        const c = parseCsvLine(line)
        degrees[id] = { pattern: c[0], name: c[2], description: c[4] }
    }
    const out = path.join(ROOT, "assets", "degree.json")
    fs.writeFileSync(out, JSON.stringify({ _note: "Every title, from master/degree/degree (scripts/gen_degrees.cjs). Title 1 is the default.", degrees }))
    console.log(`degree.json: ${Object.keys(degrees).length} titles`)
})().catch(error => { console.error(error); process.exit(1) })
