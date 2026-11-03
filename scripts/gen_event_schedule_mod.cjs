// Builds .cdn/mods/event_schedule.zip from the event schedule (.database/event_schedule.json), so
// the game shows moved events on their new dates. The server runs this whenever the schedule
// changes on the dashboard; it can also be run by hand:
//
//   npx tsc
//   node scripts/gen_event_schedule_mod.cjs
//
// Every file the schedule can touch (the files listed in assets/event_catalog.json) goes into the
// archive, moved or not: the game keeps files it downloaded, so an event taken off the schedule
// only goes back to its original dates if the original file is sent again.
//
// The yearly seasonal campaigns (.database/campaign_schedule.json, the dashboard's Campaigns tab) go
// in the same archive: a chosen login bonus gets a yearly window (its start stays, its end goes, as
// in the game's own yearly bonuses), and a chosen free pull gets a row for every later year that
// lists every regular unit banner. A chosen stamina or reward campaign run gets a copy of its rows
// for every later year. The free pull and campaign files are always sent, so turning one off removes
// its copies again.
//
// Files that the translation mod (.cdn/mods/translations.zip) also changes are built on top of
// its version, so the English text stays. The server sends this archive after the translation
// mod (src/routes/api/asset.ts), so its copy wins.

const fs = require("fs")
const path = require("path")
const unzipper = require("unzipper")
const { ROOT, decodeFile, encodeFile, setLeafText, leaves, readHashedFile, splitCsv, csvField } = require("./cdn_rows.cjs")
const { zip } = require("./gen_translation_mod.cjs")
const { parseSchedule, planRowMoves, remapText, formatMasterDate } = require("../out/lib/eventSchedule.js")
const { parseCampaignSchedule, yearlyLoginColumns, freePullCopies, freePullCopyRow, isFreePullBanner, campaignRuns, runCopies, campaignCopyId, keepLongerOnOverlap, runLength, yearlyLoginBonusesKept } = require("../out/lib/campaignSchedule.js")

const CATALOG = path.join(ROOT, "assets", "event_catalog.json")
// optional: node gen_event_schedule_mod.cjs <schedule file> <output archive> (used by the tests)
const SCHEDULE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, ".database", "event_schedule.json")
const SEASONAL = path.join(ROOT, "assets", "seasonal_campaigns.json")
const GACHA = path.join(ROOT, "assets", "gacha.json")
const { uploadPath: hashed } = require("./cdn_hash.cjs")
// stamina and reward campaigns: the server's copy of each table (for the runs) and the game's file
const RUN_TABLES = {
    reward: { asset: path.join(ROOT, "assets", "reward_campaign.json"), file: hashed("master/campaign/reward_campaign.orderedmap") },
    stamina: { asset: path.join(ROOT, "assets", "stamina_campaign.json"), file: hashed("master/campaign/stamina_campaign.orderedmap") },
}
// optional third argument: the campaign schedule file (used by the tests)
const CAMPAIGNS = process.argv[4] ? path.resolve(process.argv[4]) : path.join(ROOT, ".database", "campaign_schedule.json")
const TRANSLATIONS = path.join(ROOT, ".cdn", "mods", "translations.zip")
const OUT = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, ".cdn", "mods", "event_schedule.zip")

async function translatedFiles() {
    if (!fs.existsSync(TRANSLATIONS)) return new Map()
    const archive = await unzipper.Open.file(TRANSLATIONS)
    const files = new Map()
    for (const entry of archive.files) files.set(entry.path.split("\\").join("/"), entry)
    return files
}

async function main() {
    const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"))
    const raw = fs.existsSync(SCHEDULE) ? JSON.parse(fs.readFileSync(SCHEDULE, "utf8")) : { entries: [] }
    const { schedule, problems } = parseSchedule(raw, catalog)
    for (const problem of problems) console.log(`WARNING skipped: ${problem}`)
    const campaignRaw = fs.existsSync(CAMPAIGNS) ? JSON.parse(fs.readFileSync(CAMPAIGNS, "utf8")) : {}
    const runTables = {}
    for (const [kind, table] of Object.entries(RUN_TABLES)) {
        const rows = JSON.parse(fs.readFileSync(table.asset, "utf8")).campaigns
        runTables[kind] = { ...table, rows, runs: campaignRuns(rows) }
    }
    const known = { reward: runTables.reward.runs.map(r => r.key), stamina: runTables.stamina.runs.map(r => r.key) }
    const { schedule: campaigns, problems: campaignProblems } = parseCampaignSchedule(campaignRaw, known)
    for (const problem of campaignProblems) console.log(`WARNING skipped: ${problem}`)
    const seasonal = JSON.parse(fs.readFileSync(SEASONAL, "utf8"))
    const campaignCount = campaigns.yearlyLoginBonuses.length + campaigns.yearlyFreePulls.length + campaigns.yearlyRewardRuns.length + campaigns.yearlyStaminaRuns.length
    if (schedule.entries.length === 0 && campaignCount === 0 && !fs.existsSync(OUT)) {
        console.log("Nothing scheduled and no schedule mod yet; nothing to do.")
        return
    }
    const { moves, conflicts } = planRowMoves(catalog, schedule)
    for (const conflict of conflicts) console.log(`WARNING ${conflict}`)

    const translated = await translatedFiles()
    const files = []
    let movedRows = 0, yearlyRows = 0, copyRows = 0, runRows = 0
    const fileList = [...new Set([...Object.keys(catalog.tables), seasonal.freePullFile, RUN_TABLES.reward.file, RUN_TABLES.stamina.file])].sort()
    const gachas = JSON.parse(fs.readFileSync(GACHA, "utf8"))
    const banners = Object.entries(gachas).filter(([, g]) => isFreePullBanner(g)).map(([id]) => Number(id)).sort((a, b) => a - b)
    for (const file of fileList) {
        const entry = translated.get(file)
        const original = entry ? await entry.buffer() : await readHashedFile(file)
        const tree = decodeFile(original)
        for (const { path: keys, leaf } of leaves(tree)) {
            const move = moves.get(`${file}#${keys.join("/")}`)
            if (move === undefined) continue
            const text = remapText(leaf.text, move.from, move.to, formatMasterDate)
            if (text !== leaf.text) { setLeafText(leaf, text); movedRows++ }
        }
        if (file === seasonal.loginBonusFile) {
            // after any move, so a moved login bonus repeats on its new dates; picked ones that overlap: only the
            // longer repeats (as the server does)
            const firstDays = new Map(leaves(tree).filter(l => l.path[1] === "1").map(l => [l.path[0], splitCsv(l.leaf.text)]))
            const loginKept = yearlyLoginBonusesKept(campaigns.yearlyLoginBonuses.flatMap(id => {
                const f = firstDays.get(id)
                return f && f.length >= 44 ? [{ key: id, start: f[40], end: f[41] }] : []
            }))
            for (const { path: keys, leaf } of leaves(tree)) {
                if (!loginKept.has(keys[0])) continue
                const fields = splitCsv(leaf.text)
                const columns = fields.length >= 44 ? yearlyLoginColumns(fields[40], fields[41]) : null
                if (columns === null) { console.log(`WARNING ${keys.join("/")}: its dates can't be made yearly`); continue }
                fields[41] = "(None)"
                fields[42] = columns.yearlyFrom
                fields[43] = columns.yearlyUntil
                setLeafText(leaf, fields.map(csvField).join(","))
                yearlyRows++
            }
        }
        if (file === seasonal.freePullFile) {
            // no two copies at once: the longer campaign keeps a year (as the server does)
            const kept = keepLongerOnOverlap(campaigns.yearlyFreePulls.flatMap(id => {
                const original = seasonal.freePulls.find(c => c.id === id)
                return original ? [{ key: id, length: runLength(original), copies: freePullCopies(original, seasonal.freePulls) }] : []
            }))
            for (const id of campaigns.yearlyFreePulls) {
                const original = seasonal.freePulls.find(c => c.id === id)
                if (original === undefined) continue // a CN-only campaign: not in the global app
                for (const copy of kept.get(id) ?? []) {
                    tree.entries.push({ key: String(copy.id), node: { kind: "leaf", text: freePullCopyRow(original, copy, banners), original: "" } })
                    copyRows++
                }
            }
            // keep the rows in id order, as the game writes them
            if (copyRows > 0) tree.entries.sort((a, b) => Number(a.key) - Number(b.key))
        }
        for (const [kind, table] of Object.entries(runTables)) {
            if (file !== table.file) continue
            const chosen = kind === "reward" ? campaigns.yearlyRewardRuns : campaigns.yearlyStaminaRuns
            const added = []
            const kept = keepLongerOnOverlap(chosen.flatMap(key => {
                const run = table.runs.find(r => r.key === key)
                return run ? [{ key, length: runLength(run), copies: runCopies(run, table.runs) }] : []
            }))
            for (const key of chosen) {
                const run = table.runs.find(r => r.key === key)
                if (!run) continue
                for (const window of kept.get(key) ?? []) {
                    for (const id of run.ids) {
                        const entry = tree.entries.find(e => e.key === String(id))
                        if (entry === undefined || entry.node.kind !== "leaf") { console.log(`WARNING ${kind} campaign ${id} is not in the game's file`); continue }
                        const fields = splitCsv(entry.node.text)
                        fields[1] = window.start
                        fields[2] = window.end
                        const index = table.rows.findIndex(row => row.id === id)
                        added.push({ key: String(campaignCopyId(window.year, index)), node: { kind: "leaf", text: fields.map(csvField).join(","), original: "" } })
                    }
                }
            }
            if (added.length > 0) {
                tree.entries.push(...added)
                tree.entries.sort((a, b) => Number(a.key) - Number(b.key))
                runRows += added.length
            }
        }
        files.push({ name: file, data: encodeFile(tree) })
    }

    // written next to the archive first, so the server never reads a half-written one
    const temp = `${OUT}.tmp`
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(temp, zip(files))
    fs.renameSync(temp, OUT)
    console.log(`Wrote ${path.relative(ROOT, OUT)}: ${schedule.entries.length} event(s) scheduled, ${movedRows} rows moved, ${yearlyRows} yearly login bonus rows, ${copyRows} free pull copies, ${runRows} stamina/reward campaign copies, ${files.length} files.`)
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1) })
