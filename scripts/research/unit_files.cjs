// RESEARCH (docs/research/new-units.md): every file of one unit that CN has, by logical path. File names
// are hashed, so they can't be listed; this tries every name the game's code builds from a unit's string
// id (decompiled client: "character/" + id + "/ui/...", "/pixelart/...", "/voice/battle"...), plus its
// home voice lines (character_speech) and the expressions in story_character, and keeps the ones the
// CN file list has.
//
//   node scripts/research/unit_files.cjs <unit id> > files.txt
const fs = require("fs")
const path = require("path")
const R = require("../cdn_rows.cjs")
const { readCnTable } = require("../cn_read.cjs")
const { cnDir } = require("../cn_archives.cjs")
const { uploadPath } = require("../cdn_hash.cjs")

const UI = ["thumb_party_unison", "thumb_party_main", "thumb_level_up", "skill_cutin", "full_shot_illustration_setting",
    "full_shot_1440_1920", "episode_banner", "cutin_skill_chain", "battle_member_status", "battle_control_board",
    "square", "square_132_132", "square_round_136_136", "square_round_95_95", "story/base"]
const BATTLE_VOICE = ["battle_start", "skill", "normal_attack", "skill_ready", "outhole", "win", "power_flip"]
const EXT = ["", ".png", ".mp3", ".atlas.amf3.deflate", ".frame.amf3.deflate", ".timeline.amf3.deflate",
    ".parts.amf3.deflate", ".battle.amf3.deflate", ".amf3.deflate", ".atf.deflate"]

;(async () => {
    const id = process.argv[2]
    if (!id) throw new Error("usage: unit_files.cjs <unit id>")
    const characters = await readCnTable("master/character/character.orderedmap")
    const row = R.splitCsv(characters[id].replace(/\n$/, ""))
    const dev = row[0], skill = row[8]
    const stems = ["pixelart/pixelart", "pixelart/special", "pixelart/sprite_sheet", "pixelart/special_sprite_sheet",
        "battle/character_detail_skill_preview", "battle/character_info_skill_preview", "ui/illustration_setting_sprite_sheet"]
    for (const s of UI) for (const i of ["0", "1", "2"]) stems.push(`ui/${s}_${i}`)
    for (const v of BATTLE_VOICE) for (const i of ["", "_0", "_1", "_2", "_3"]) stems.push(`voice/battle/${v}${i}`)
    for (const i of [0, 1, 2, 3, 4]) stems.push(`voice/login/login_${i}`)
    const speech = (await readCnTable("master/character/character_speech.orderedmap"))[id] ?? ""
    for (const line of R.splitCsvLines(speech.replace(/\n$/, ""))) { const c = R.splitCsv(line); if (c[4]) stems.push(`voice/${c[4]}`) }
    const story = (await readCnTable("master/story/story_character.orderedmap"))[dev]
    if (story) for (const e of R.splitCsv(story.replace(/\n$/, ""))[3].split(",")) stems.push(`ui/story/${e}`)

    const csv = fs.readdirSync(path.join(cnDir(), "entities")).find(f => /android_medium\.csv$/.test(f))
    const index = new Set(fs.readFileSync(path.join(cnDir(), "entities", csv), "utf8").split(/\r?\n/).map(l => l.split(",")[0]))
    const has = logical => ["upload", "medium_upload", "android_upload"].some(f => index.has(uploadPath(logical, f)))
    const found = new Set()
    for (const s of stems) for (const x of EXT) if (has(`character/${dev}/${s}${x}`)) found.add(`character/${dev}/${s}${x}`)
    for (const n of [1, 2, 3]) for (const r of ["rare5", "rare4", "rare3", "rare2", "rare1"]) {
        const p = `battle/action/skill/action/${r}/${skill}$${skill}_${n}.action.dsl.amf3.deflate`
        if (has(p)) found.add(p)
    }
    for (const p of [...found].sort()) console.log(p)
    console.error(`${found.size} files of ${dev} (${id})`)
})().catch(e => { console.error(e); process.exit(1) })
