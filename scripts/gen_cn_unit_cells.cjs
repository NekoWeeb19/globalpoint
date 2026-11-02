// English unit text for the CN client (assets/translations/cn_units.json) as single cells, for
// scripts/apply_cn_translations.cjs: assets/translations/cn_unit_cells.json.
//
// - Units global never had: every text cell of master/character/character_text (name, description,
//   title, skill, skill+, skill++, leader buff, voice actor) and the leader buff name in
//   master/character/character (column 18).
// - Global units: CN added a skill++ (unit awakening, src/nya/manaAwake.ts) in columns 8-9. Its name
//   is global's skill+ name with another "+", its text global's skill+ text unless cn_units.json
//   gives one (where CN's skill++ does more).
// - Guest/assist units (7000xx) with placeholder text ("仮", "临时") take their base unit's global
//   text (global's own guest rows have the same placeholders).
//
// character_text columns (CN): 0 name, 1 reading, 2 description, 3 title, 4 skill, 5 skill text,
// 6 skill+, 7 skill+ text, 8 skill++, 9 skill++ text, 10 leader buff, 11 voice actor.
// Global's rows have no 8-9, so global column 8 = CN 10 and 9 = CN 11.
//
//   node scripts/gen_cn_unit_cells.cjs [base text dir, default text8 = apply_cn_translations' input]
//     -> assets/translations/cn_unit_cells.json
const fs = require("fs")
const path = require("path")
const unzipper = require("unzipper")
const R = require("./cdn_rows.cjs")
const { cnZips } = require("./cn_archives.cjs")
const { recordsOf } = require("./gen_cn_text.cjs")

const ROOT = path.join(__dirname, "..")
const OUT = path.join(ROOT, "assets", "translations", "cn_unit_cells.json")
const UNITS = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "translations", "cn_units.json"), "utf8")).units
const NOT_ENGLISH = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/
const PLACEHOLDER = /^(仮|临时|임시)$/
// guest/assist unit -> the global unit whose text it takes
const GUEST_BASE = { 700000: 243007, 700012: 161082, 700013: 131086, 700014: 121081 }
const NO_SKILL = new Set(["700000"]) // ekaki_onmyoji_noskill

const names = JSON.parse(fs.readFileSync("F:/WF client/globalize/table_names.json", "utf8"))
const byName = Object.fromEntries(Object.entries(names).map(([k, v]) => [v, k]))
const TEXT = byName["master/character/character_text"]
const CHARACTER = byName["master/character/character"]
const SPEECH = byName["master/character/character_speech"]
const ACTION_SKILL = byName["master/skill/action_skill"]
const AWAKE_MISSION = byName["master/mission/character_awake_mission"]
// CN -> global names from the unit and speaker tables (built once from CN's and global's
// character_text / story_character; see the awake mission texts below)
const CN_NAMES = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "translations", "cn_names.json"), "utf8"))
// quest names in awake mission texts (CN -> global, from the translation memory)
const QUESTS = {
    "伊尔格拉乌 超级": "Il Glaur (Godly)", "八岐大蛇 超级": "Orochi (Godly)", "寄居蟹船长 超级": "Hermit King (Godly)",
    "寄居蟹船长 地狱级": "Hermit King (Hell)", "结实假人·水": "Tough Lignoid (Wa)", "结实假人·风": "Tough Lignoid (Wi)",
    "临境域 深渊之兽": "The Beast of the Abyss", "临境域 深渊之兽·极": "The Beast of the Abyss EX",
    "单人挑战关卡「女王拉芙」超级+": "the solo challenge \"Mother Love\" (Godly+)",
}
const RACES = { "人": "Human", "龙": "Dragon", "魔": "Fiend" }
const SPEECH_LINES = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "translations", "cn_unit_speech.json"), "utf8")).lines

async function entries(zips) {
    const map = new Map()
    for (const z of zips) for (const e of (await unzipper.Open.file(z)).files)
        if (e.type === "File") map.set("production/" + e.path.split("\\").join("/").replace(/^production\//, ""), e)
    return map
}
const rowsOf = buf => new Map(R.leaves(R.decodeFile(buf)).map(l => [l.path.join("/"), recordsOf(l.leaf.text)[0]]))

;(async () => {
    // the CN text the apply step starts from (not its output, which already has these cells)
    const textDir = process.argv[2] ?? process.env.CN_BASE_TEXT_DIR ?? "F:/WF client/globalize/text8"
    const translated = textDir ? new Map(JSON.parse(fs.readFileSync(path.join(textDir, "files.json"), "utf8")).map(f => [f.path, f.from])) : new Map()
    const cn = await entries(cnZips("D:/WF client/.cdn/cn"))
    const glDir = path.join(ROOT, ".cdn/en")
    const gl = await entries(["archive-common-full", "archive-common-diff"].flatMap(d => fs.readdirSync(path.join(glDir, d)).filter(f => f.endsWith(".zip")).sort().map(f => path.join(glDir, d, f))))
    const cnRows = async p => rowsOf(translated.has(p) ? fs.readFileSync(translated.get(p)) : await cn.get(p).buffer())
    const cnText = await cnRows(TEXT), cnChar = await cnRows(CHARACTER)
    const glText = rowsOf(await gl.get(TEXT).buffer()), glChar = rowsOf(await gl.get(CHARACTER).buffer())

    const tables = { [TEXT]: {}, [CHARACTER]: {}, [SPEECH]: {}, [ACTION_SKILL]: {}, [AWAKE_MISSION]: {} }
    const set = (table, key, col, text) => { if (text !== undefined) (tables[table][key] ??= {})[`0:${col}`] = text }

    for (const [key, row] of cnText) {
        const unit = UNITS[key]
        if (unit?.name !== undefined) {
            // a unit global never had: all of its text
            set(TEXT, key, 0, unit.name)
            set(TEXT, key, 2, unit.description)
            set(TEXT, key, 3, unit.title)
            set(TEXT, key, 4, unit.skill)
            set(TEXT, key, 5, unit.skillDesc)
            set(TEXT, key, 6, `${unit.skill}+`)
            set(TEXT, key, 7, unit.skillDesc)
            if (row[8] !== "(None)") {
                set(TEXT, key, 8, `${unit.skill}++`)
                set(TEXT, key, 9, unit.skillPlusPlusDesc ?? unit.skillDesc)
            }
            set(TEXT, key, 10, unit.leader)
            set(TEXT, key, 11, unit.va)
            if (cnChar.has(key)) set(CHARACTER, key, 18, unit.leader)
            continue
        }
        if (/^7000\d\d$/.test(key)) {
            // guest: text that isn't English takes global's own row for it, else its base unit's
            const fromRow = (r, col) => (r === undefined ? undefined : col <= 7 ? r[col] : col === 10 ? r[8] : col === 11 ? r[9] : undefined)
            const english = v => v !== undefined && v !== "" && v !== "(None)" && !NOT_ENGLISH.test(v) && !PLACEHOLDER.test(v)
            const same = glText.get(key), base = GUEST_BASE[key] !== undefined ? glText.get(String(GUEST_BASE[key])) : undefined
            row.forEach((v, col) => {
                if (col === 1 || !(NOT_ENGLISH.test(v) || PLACEHOLDER.test(v))) return
                // a guest without a skill (700000) doesn't borrow its base unit's skill
                if (NO_SKILL.has(key) && col >= 4 && col <= 9) { set(TEXT, key, col, "--"); return }
                if (col === 8 && /\+$/.test(row[6]) && !NOT_ENGLISH.test(row[6])) { set(TEXT, key, col, `${row[6]}+`); return }
                const text = [fromRow(same, col), fromRow(base, col)].find(english)
                if (text !== undefined) set(TEXT, key, col, text)
            })
            const charRow = cnChar.get(key)
            if (charRow && (NOT_ENGLISH.test(charRow[18]) || PLACEHOLDER.test(charRow[18]))) {
                const text = [glChar.get(key)?.[18], GUEST_BASE[key] !== undefined ? glChar.get(String(GUEST_BASE[key]))?.[18] : undefined].find(english)
                if (text !== undefined) set(CHARACTER, key, 18, text)
            }
            continue
        }
        // a global unit: CN's skill++ (columns 8-9)
        if (NOT_ENGLISH.test(row[8] ?? "") && !NOT_ENGLISH.test(row[6] ?? "") && /\+$/.test(row[6])) set(TEXT, key, 8, `${row[6]}+`)
        if (unit?.skillPlusPlusDesc !== undefined) set(TEXT, key, 9, unit.skillPlusPlusDesc)
        else if (NOT_ENGLISH.test(row[9] ?? "") && !NOT_ENGLISH.test(row[7] ?? "")) set(TEXT, key, 9, row[7])
    }

    // voice lines (cn_unit_speech.json): record -> text, in the line column (3)
    const speechRows = new Map(R.leaves(R.decodeFile(translated.has(SPEECH) ? fs.readFileSync(translated.get(SPEECH)) : await cn.get(SPEECH).buffer())).map(l => [l.path.join("/"), recordsOf(l.leaf.text)]))
    for (const [key, lines] of Object.entries(SPEECH_LINES)) {
        const recs = speechRows.get(key)
        if (!recs) { console.log(`  no speech row for ${key}`); continue }
        for (const [r, text] of Object.entries(lines)) {
            if (!recs[Number(r)] || recs[Number(r)].length < 4) { console.log(`  speech ${key} has no record ${r}`); continue }
            (tables[SPEECH][key] ??= {})[`${r}:3`] = text
        }
    }

    // battle skills (action_skill "<unit internal name>/<level>"): the unit's skill (1), skill+ (2) and
    // skill++ (3) name and text, as character_text has them after the cells above; skills that
    // aren't a unit's (skill invokers...) take global's own row
    const finalText = (key, col) => tables[TEXT][key]?.[`0:${col}`] ?? cnText.get(key)?.[col]
    const unitByInternal = new Map([...cnChar].map(([key, row]) => [row[0], key]))
    const cnSkills = await cnRows(ACTION_SKILL), glSkills = rowsOf(await gl.get(ACTION_SKILL).buffer())
    for (const [key, row] of cnSkills) {
        if (!NOT_ENGLISH.test(row[0] ?? "") && !NOT_ENGLISH.test(row[1] ?? "")) continue
        const [internal, level] = key.split("/")
        const unit = unitByInternal.get(internal)
        const cols = { 1: [4, 5], 2: [6, 7], 3: [8, 9] }[level]
        let name, desc
        if (unit !== undefined && cols) { name = finalText(unit, cols[0]); desc = finalText(unit, cols[1]) }
        const glRow = glSkills.get(key)
        if (name === undefined || NOT_ENGLISH.test(name) || name === "(None)") name = glRow?.[0]
        if (desc === undefined || NOT_ENGLISH.test(desc) || desc === "(None)") desc = glRow?.[1]
        if (NOT_ENGLISH.test(row[0]) && name !== undefined && !NOT_ENGLISH.test(name)) (tables[ACTION_SKILL][key] ??= {})["0:0"] = name
        if (NOT_ENGLISH.test(row[1]) && desc !== undefined && !NOT_ENGLISH.test(desc)) (tables[ACTION_SKILL][key] ??= {})["0:1"] = desc
    }

    // unit awakening missions (the Awake board, src/nya/manaAwake.ts): CN's sentence patterns
    const unitName = cn => CN_NAMES[cn] ?? Object.values(UNITS).find(u => u.cnName === cn)?.name
    const nameList = list => {
        const parts = list.split("、").map(unitName)
        if (parts.some(p => p === undefined)) return undefined
        return parts.length <= 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`
    }
    const quest = q => QUESTS[q]
    const time = t => t.replace(/(\d+)分(\d+)秒/, "$1 min $2 sec").replace(/(\d+)分钟/, "$1 min").replace(/(\d+)秒/, "$1 sec")
    const PATTERNS = [
        [/^完成全部觉醒任务$/, () => "Complete all Awakening Missions"],
        [/^阅读(.+)的所有个人剧情$/, m => nameList(m[1]) && `Read all of ${nameList(m[1])}'s episodes`],
        [/^累计阅读::x_count:: ?篇角色故事$/, () => "Read ::x_count:: unit episodes"],
        [/^累计获得玛纳 ?::x_count::$/, () => "Obtain ::x_count:: Mana"],
        [/^获得(.+)的全部信赖之证$/, m => nameList(m[1]) && `Obtain all of ${nameList(m[1])}'s Amity Scrolls`],
        [/^以(.+)作为队长，累计进行强化弹射::x_count::次$/, m => nameList(m[1]) && `Use ::x_count:: Power Flips with ${nameList(m[1])} as leader`],
        [/^以(.+)作为队长，在单次战斗中达成::x_count::连击$/, m => nameList(m[1]) && `Reach a ::x_count:: combo in one battle with ${nameList(m[1])} as leader`],
        [/^以(.+)作为队长，累计进行共斗::x_count::次$/, m => nameList(m[1]) && `Play ::x_count:: co-op battles with ${nameList(m[1])} as leader`],
        [/^以(.+)作为队长参与共斗x1次$/, m => nameList(m[1]) && `Play 1 co-op battle with ${nameList(m[1])} as leader`],
        [/^以(.+)作为队长通关(?:任意)?关卡::x_count::次，且不能有队友阵亡$/, m => nameList(m[1]) && `Clear any quest ::x_count:: times with ${nameList(m[1])} as leader without any unit being knocked out`],
        [/^以(.+)作为队长通关任意关卡::x_count::次$/, m => nameList(m[1]) && `Clear any quest ::x_count:: times with ${nameList(m[1])} as leader`],
        [/^以(.+)作为队长且队伍中编有(.+)通关任意关卡::x_count::次$/, m => nameList(m[1]) && nameList(m[2]) && `Clear any quest ::x_count:: times with ${nameList(m[1])} as leader and ${nameList(m[2])} in your party`],
        [/^以(.+)作为队长，队伍中编有([人龙魔、]+)通关任意关卡$/, m => nameList(m[1]) && `Clear any quest with ${nameList(m[1])} as leader and ${m[2].split("、").map(r => RACES[r]).join(", ").replace(/, ([^,]+)$/, ", and $1")} units in your party`],
        [/^以(.+)作为队长，(.+?)内通关(.+)$/, m => nameList(m[1]) && quest(m[3]) && `Clear ${quest(m[3])} within ${time(m[2])} with ${nameList(m[1])} as leader`],
        [/^以(.+)作为队长，单人通关(.+)$/, m => nameList(m[1]) && quest(m[2]) && `Clear ${quest(m[2])} solo with ${nameList(m[1])} as leader`],
        [/^以(.+)作为队长，?通关(.+)$/, m => nameList(m[1]) && quest(m[2]) && `Clear ${quest(m[2])} with ${nameList(m[1])} as leader`],
        [/^队伍中编有(.+)通关任意关卡:?$/, m => nameList(m[1]) && `Clear any quest with ${nameList(m[1])} in your party`],
        [/^通关任意关卡，队伍中编有(.+)$/, m => nameList(m[1]) && `Clear any quest with ${nameList(m[1])} in your party`],
        [/^队伍中编有(.+)通关任意关卡::x_count::次$/, m => nameList(m[1]) && `Clear any quest ::x_count:: times with ${nameList(m[1])} in your party`],
        [/^队伍中编有(.+)通关任意摇曳迷宫关卡$/, m => nameList(m[1]) && `Clear any Kaleidoscope quest with ${nameList(m[1])} in your party`],
        [/^队伍中编有(.+)通关通关摇曳的迷宫 宝物域关卡$/, m => nameList(m[1]) && `Clear a Kaleidoscope Treasure Zone quest with ${nameList(m[1])} in your party`],
        [/^队伍中编有(.+)单人通关(.+)$/, m => nameList(m[1]) && quest(m[2]) && `Clear ${quest(m[2])} solo with ${nameList(m[1])} in your party`],
        [/^队伍中编有(.+)通关(.+)$/, m => nameList(m[1]) && quest(m[2]) && `Clear ${quest(m[2])} with ${nameList(m[1])} in your party`],
        [/^通关(.+)$/, m => quest(m[1]) && `Clear ${quest(m[1])}`],
    ]
    const awakeRows = await cnRows(AWAKE_MISSION)
    const untranslated = new Set()
    for (const [key, row] of awakeRows) {
        const text = row[3] ?? ""
        if (!NOT_ENGLISH.test(text)) continue
        let en
        for (const [re, make] of PATTERNS) { const m = re.exec(text); if (m) { en = make(m) || undefined; break } }
        if (en) (tables[AWAKE_MISSION][key] ??= {})["0:3"] = en
        else untranslated.add(text)
    }
    if (untranslated.size) console.log(`  awake missions left: ${[...untranslated].join(" | ")}`)

    // what's still not English in these rows after the cells (the apply step's translation memory
    // still fixes some of these, e.g. voice actors' names)
    const left = []
    for (const [table, rows] of [[TEXT, cnText], [CHARACTER, cnChar], [ACTION_SKILL, cnSkills]]) for (const [key, row] of rows) row.forEach((v, col) => {
        if (table === TEXT && col === 1) return // the reading
        if (NOT_ENGLISH.test(v) && tables[table][key]?.[`0:${col}`] === undefined) left.push(`${names[table]} ${key} ${col}: ${v.slice(0, 40)}`)
    })
    fs.writeFileSync(OUT, JSON.stringify({ _note: "Built by scripts/gen_cn_unit_cells.cjs from assets/translations/cn_units.json.", tables }))
    console.log(`Wrote ${OUT}: ${Object.values(tables).reduce((n, t) => n + Object.values(t).reduce((m, c) => m + Object.keys(c).length, 0), 0)} cells; still not English: ${left.length}`)
    for (const l of left.slice(0, 40)) console.log("  " + l)
})().catch(e => { console.error(e); process.exit(1) })
