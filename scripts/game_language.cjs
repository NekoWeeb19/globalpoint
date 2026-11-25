// The CN game's language, set on the dashboard's Game settings tab (.database/game_language.json { language }):
// - "en": GlobalPoint's English (the default; no file)
// - "zh": CN's own Simplified Chinese. The CN update (scripts/gen_cn_event_schedule.cjs) then ships every table with
//   CN's own Chinese text in place of the English, keeping GlobalPoint's data changes (scripts/cn_language.cjs), and
//   the server writes its own text (mail titles, automatic news) in Chinese (src/nya/gameLanguage.ts).
// Read by the server, the update builder and scripts/schedule_fingerprint.cjs (a change rebuilds the update).
const fs = require("fs")
const path = require("path")

const LANGUAGES = ["en", "zh"]
const DEFAULT_LANGUAGE = "en"
const FILE_NAME = "game_language.json"

/** The language saved in a .database folder ("en" when unset or unreadable). */
function readGameLanguage(dataDir) {
    try {
        const value = JSON.parse(fs.readFileSync(path.join(dataDir, FILE_NAME), "utf8")).language
        return LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE
    } catch {
        return DEFAULT_LANGUAGE
    }
}

/**
 * Whether CN's original pictures are here for the game in Chinese (assets/cn_lang_art.json): a CN folder with CN's
 * archives (a PC), or a slim folder holding every listed picture in tables/ (a phone with the Chinese art pack).
 */
function chineseArtReady(cnDir) {
    try {
        const { cnZips } = require("./cn_archives.cjs")
        if (cnZips(cnDir).length > 0) return true
        const paths = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets", "cn_lang_art.json"), "utf8")).paths ?? []
        return paths.length > 0 && paths.every(p => fs.existsSync(path.join(cnDir, "tables", p)))
    } catch {
        return false
    }
}

module.exports = { LANGUAGES, DEFAULT_LANGUAGE, FILE_NAME, readGameLanguage, chineseArtReady }
