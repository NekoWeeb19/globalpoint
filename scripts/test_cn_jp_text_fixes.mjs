// Tests assets/cn_jp_text_fixes.json (scripts/gen_cn_jp_text_fixes.cjs): every fix replaces Japanese with English, for
// a stored table path, and the update builder ships those tables. Offline.
//
//   node scripts/test_cn_jp_text_fixes.mjs
import fs from "fs"

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}
const KANA = /[぀-ヿ]/

const file = JSON.parse(fs.readFileSync(new URL("../assets/cn_jp_text_fixes.json", import.meta.url), "utf8"))
const fixes = Object.entries(file.tables).flatMap(([table, rows]) => Object.entries(rows).flatMap(([key, cells]) => Object.entries(cells).map(([col, pair]) => ({ table, key, col, pair }))))
check("there are fixes", fixes.length > 0, fixes.length)
check("tables are stored paths", Object.keys(file.tables).every(t => /^production\/upload\/[0-9a-f]{2}\/[0-9a-f]{38}$/.test(t)), Object.keys(file.tables))
check("columns are numbers", fixes.every(f => /^\d+$/.test(f.col)))
const bad = fixes.filter(f => !Array.isArray(f.pair) || f.pair.length !== 2 || !KANA.test(f.pair[0]) || KANA.test(f.pair[1]) || !/[A-Za-z]/.test(f.pair[1]))
check("each replaces Japanese with English", bad.length === 0, bad.slice(0, 3))
check("the summer 2022 login bonus is in English", file.tables["production/upload/33/12fe29bb65e17203008c1f025ae262faaa0cb0"]?.["smr_v22/1"]?.["3"]?.[1] === "Summer Login Perks")

// our own English where global never had the text (the Black Clover collab)
const ours = JSON.parse(fs.readFileSync(new URL("../assets/cn_jp_translations.json", import.meta.url), "utf8"))
const ourCells = Object.entries(ours.tables).flatMap(([table, rows]) => Object.entries(rows).flatMap(([key, cells]) => Object.entries(cells).map(([col, pair]) => ({ table, key, col, pair }))))
check("our translations: a few hundred cells", ourCells.length > 300, ourCells.length)
const badOurs = ourCells.filter(f => !Array.isArray(f.pair) || !/[぀-ヿ一-鿿]/.test(f.pair[0]) || /[぀-ヿ]/.test(f.pair[1]) || !/[A-Za-z]/.test(f.pair[1]))
check("each replaces Japanese with English", badOurs.length === 0, badOurs.slice(0, 3))
const storyLines = ourCells.filter(f => /bcollabo\/event_chapter_00_0[1-4]\/scenario\//.test(f.key))
check("all four Black Clover chapters", new Set(storyLines.map(f => f.key.split("/")[3])).size === 4 && storyLines.length > 250, storyLines.length)
check("Asta's line", storyLines.some(f => f.pair[1] === "—Not giving up is my magic!!!"))
check("story lines keep the game's \\n line breaks", storyLines.filter(f => f.pair[0].includes("\\n")).every(f => f.pair[1].includes("\\n") || f.pair[1].length <= 36))
const overlap = Object.keys(ours.tables).flatMap(t => Object.keys(ours.tables[t]).flatMap(k => Object.keys(ours.tables[t][k]).filter(c => file.tables[t]?.[k]?.[c])))
check("no cell is in both files", overlap.length === 0, overlap)

const builder = fs.readFileSync(new URL("./gen_cn_event_schedule.cjs", import.meta.url), "utf8")
check("the update builder ships and applies them", builder.includes("...Object.keys(JP_TEXT_FIXES)") && builder.includes("if (JP_TEXT_FIXES[file])") && builder.includes("cn_jp_translations.json"))
const fingerprint = fs.readFileSync(new URL("./schedule_fingerprint.cjs", import.meta.url), "utf8")
check("the fix file is in the schedule fingerprint (a new one ships at the next start)", fingerprint.includes("cn_jp_text_fixes.json"))

console.log(failures ? `\n${failures} Japanese text fix test(s) failed.` : "\nAll Japanese text fix tests passed.")
process.exit(failures ? 1 : 0)
