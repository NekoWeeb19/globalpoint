// Tests the CN game's language setting (dashboard Game settings): CN's Chinese text put back into the update's tables
// (scripts/cn_language.cjs), the updates built in Chinese kept apart (languages.json), the rebuild fingerprint, and
// the server's own Chinese text (src/nya/gameLanguage.ts, mail titles, the automatic news). On a temp folder.
//
//   npx tsc
//   node scripts/test_cn_language.mjs
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const scripts = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))
const out = new URL("../out/", import.meta.url)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cn-language-"))
process.chdir(temp)
process.env.STARPOINT_NO_CN_REBUILD = "1"

let failures = 0
const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`)
    if (!ok) failures++
}

try {
    const CL = require(path.join(scripts, "cn_language.cjs"))
    const R = require(path.join(scripts, "cdn_rows.cjs"))
    const leaf = text => ({ kind: "leaf", text })
    const table = rows => ({ kind: "map", entries: Object.entries(rows).map(([key, text]) => ({ key, node: leaf(text) })) })
    const texts = root => Object.fromEntries(R.leaves(root).map(({ path: k, leaf: l }) => [k.join("/"), l.text]))

    // ---- the Chinese pass ----
    const update = table({
        "1": "unit_a,Dragon Lord,2022-01-01 00:00:00,5\n",            // name translated, date moved by GlobalPoint
        "2": "unit_b,Hello,こんにちは\n",                               // CN left Japanese: stays English
        "3": "unit_c,Only GlobalPoint has this row\n",                 // a row CN doesn't have
        "4": "x,First,1\ny,Second,2\nz,Added by GlobalPoint,3\n",       // a record added: matched by first cell
        "5": "unit_a,Dragon Lord,2023-01-01 00:00:00,5\n",            // a copy GlobalPoint made of row 1 (the Haunt's months, yearly free pulls)
    })
    const cn = table({
        "1": "unit_a,龙王,2020-01-01 00:00:00,5\n",
        "2": "unit_b,你好,こんにちは\n",
        "4": "x,第一,1\ny,第二,2\n",
    })
    const changed = CL.chineseTree(update, cn)
    const t = texts(update)
    check("a translated cell goes back to CN's Chinese, GlobalPoint's date stays", t["1"] === "unit_a,龙王,2022-01-01 00:00:00,5\n", t["1"])
    check("CN's Japanese cells keep their English", t["2"] === "unit_b,你好,こんにちは\n", t["2"])
    check("rows only GlobalPoint has stay as they are", t["3"] === "unit_c,Only GlobalPoint has this row\n", t["3"])
    check("records matched by their first cell when GlobalPoint added one", t["4"] === "x,第一,1\ny,第二,2\nz,Added by GlobalPoint,3\n", t["4"])
    check("a row GlobalPoint copied takes the Chinese of the same English in the table", t["5"] === "unit_a,龙王,2023-01-01 00:00:00,5\n", t["5"])
    check("the number of cells changed is counted", changed === 5, changed)
    check("a second pass changes nothing", CL.chineseTree(update, cn) === 0)

    // ---- the Chinese community's fixes (assets/cn_zh_fixes.json) ----
    const fixes = CL.zhFixes()
    const profiles = fixes.rules[0]?.except?.[0]
    check("the fixes file has cells and the 生命值 -> HP rule (unit profiles excepted)", Object.keys(fixes.cells).length > 0 && fixes.rules[0]?.from === "生命值" && fixes.rules[0]?.to === "HP" && typeof profiles === "string")
    const [fixTable, fixRows] = Object.entries(fixes.cells).find(([, rows]) => Object.values(rows).some(c => Object.keys(c).some(at => at.startsWith("0:"))))
    const [fixKey, fixCells] = Object.entries(fixRows).find(([, c]) => Object.keys(c).some(at => at.startsWith("0:")))
    const [fixAt, [fixWas, fixZh]] = Object.entries(fixCells).find(([at]) => at.startsWith("0:"))
    const fixCol = Number(fixAt.split(":")[1])
    const rowWith = value => { const cells = Array(fixCol + 2).fill("x"); cells[fixCol] = value; return cells.join(",") + "\n" }
    const ours = table({ [fixKey]: rowWith("English shown for it"), other: "y,生命值不满50%\n" })
    const theirsSource = table({ [fixKey]: rowWith(fixWas), other: "y,生命值不满50%\n" })
    CL.applyZhFixes(fixTable, ours, theirsSource)
    const fixed = texts(ours)
    check("a fixed cell takes the community's Chinese while CN's copy still has the text it was made from", fixed[fixKey] === rowWith(fixZh), fixed[fixKey])
    check("the rule turns 生命值 into HP in game text", fixed.other === "y,HP不满50%\n", fixed.other)
    const changedCn = table({ [fixKey]: rowWith("CN's text changed since"), other: "y,x\n" })
    const untouched = table({ [fixKey]: rowWith("English shown for it"), other: "y,x\n" })
    CL.applyZhFixes(fixTable, untouched, changedCn)
    check("a fix whose CN text changed isn't applied", texts(untouched)[fixKey] === rowWith("English shown for it"))
    const profile = table({ "111001": "a,生命值很高\n" })
    CL.applyZhFixes(profiles, profile, table({}))
    check("unit profile text keeps 生命值", texts(profile)["111001"] === "a,生命值很高\n")

    // ---- GlobalPoint's own Chinese (assets/cn_zh_own.json) and the cut stories in Chinese ----
    const own = JSON.parse(fs.readFileSync(path.join(scripts, "..", "assets", "cn_zh_own.json"), "utf8"))
    const ownCells = Object.values(own.cells).flatMap(rows => Object.values(rows).flatMap(c => Object.values(c)))
    check("our own cells: Chinese with no kana left, made from CN's Japanese or blank cells", ownCells.length > 0
        && ownCells.every(([was, zh]) => /[一-鿿]/.test(zh) && !/[ぁ-ゖァ-ヺ]/.test(zh) && (/[ぁ-ゖァ-ヺ]/.test(was) || was === "--")))
    check("the loader merges the community's fixes and ours, with the rows CN lacks", Object.keys(CL.zhFixes().rows ?? {}).length > 0
        && Object.values(CL.zhFixes().cells).some(rows => Object.values(rows).some(c => Object.values(c).some(([, zh]) => zh.startsWith("【至")))))
    const storiesZh = JSON.parse(fs.readFileSync(path.join(scripts, "..", "assets", "cn_story_fixes_zh", "index.json"), "utf8")).files
    const storiesEn = JSON.parse(fs.readFileSync(path.join(scripts, "..", "assets", "cn_story_fixes", "index.json"), "utf8")).files
    check("each cut story has a complete Chinese copy with global's row count", Object.keys(storiesEn).every(k => storiesZh[k]?.rows === storiesEn[k].rows))

    // ---- updates built in Chinese aren't English copies ----
    const patchDir = path.join(temp, "cn_patches")
    fs.mkdirSync(patchDir, { recursive: true })
    CL.recordLanguage(patchDir, "1.4.900", "zh")
    CL.recordLanguage(patchDir, "1.4.901", "en")
    check("only the Chinese build is listed", JSON.stringify(CL.readLanguages(patchDir)) === JSON.stringify({ "1.4.900": "zh" }), CL.readLanguages(patchDir))
    CL.recordLanguage(patchDir, "1.4.900", "en")
    check("a version built again in English leaves the list", Object.keys(CL.readLanguages(patchDir)).length === 0, CL.readLanguages(patchDir))

    // ---- pictures: CN's originals (a phone's slim folder) and English copies, each zipped once and reused ----
    const { zip } = require(path.join(scripts, "gen_translation_mod.cjs"))
    const unzipper = require(path.join(scripts, "..", "node_modules", "unzipper"))
    const pics = ["production/upload/aa/pic1", "production/upload/bb/pic2"]
    const slim = path.join(temp, "slim")
    fs.mkdirSync(path.join(slim, "tables", "production", "upload", "aa"), { recursive: true })
    fs.writeFileSync(path.join(slim, "tables", pics[0]), "CN picture 1")
    const artPatches = path.join(temp, "art_patches")
    const englishZip = (version, files) => {
        fs.mkdirSync(path.join(artPatches, version), { recursive: true })
        fs.writeFileSync(path.join(artPatches, version, "a.zip"), zip(files.map(([name, text]) => ({ name, data: Buffer.from(text) }))))
        return { version, from: "1.4.54", files: files.length, archives: [{ file: `${version}/a.zip`, size: 1, sha256: "" }] }
    }
    fs.writeFileSync(path.join(artPatches, "patches.json"), JSON.stringify([
        englishZip("1.4.55", [[pics[0], "EN picture 1"], [pics[1], "EN picture 2"]]),
        englishZip("1.4.60", [[pics[0], "Chinese copy, not English"]]),
    ]))
    CL.recordLanguage(artPatches, "1.4.60", "zh")
    check("Chinese pictures wait until every one of CN's originals is here", await CL.artArchives("zh", artPatches, slim, pics) === null)
    fs.mkdirSync(path.join(slim, "tables", "production", "upload", "bb"), { recursive: true })
    fs.writeFileSync(path.join(slim, "tables", pics[1]), "CN picture 2")
    const zhArt = await CL.artArchives("zh", artPatches, slim, pics)
    const contents = async art => {
        const out = {}
        for (const a of art.archives) for (const e of (await unzipper.Open.file(path.join(artPatches, a.file))).files) out[e.path] = (await e.buffer()).toString()
        return out
    }
    check("the Chinese set holds CN's originals", JSON.stringify(await contents(zhArt)) === JSON.stringify({ [pics[0]]: "CN picture 1", [pics[1]]: "CN picture 2" }), await contents(zhArt))
    const again = await CL.artArchives("zh", artPatches, slim, pics)
    check("a second switch reuses the same archives (no new copy)", JSON.stringify(again.archives) === JSON.stringify(zhArt.archives)
        && fs.readdirSync(path.join(artPatches, CL.ART_DIR)).length === 1)
    const enArt = await CL.artArchives("en", artPatches, slim, pics)
    check("the English set takes the newest English copies, never a Chinese build's", JSON.stringify(await contents(enArt)) === JSON.stringify({ [pics[0]]: "EN picture 1", [pics[1]]: "EN picture 2" }), await contents(enArt))
    CL.registerArt(artPatches, "1.4.61", "1.4.60", zhArt)
    const entry = JSON.parse(fs.readFileSync(path.join(artPatches, "patches.json"), "utf8")).find(p => p.version === "1.4.61")
    check("the update entry points at the kept archives", entry?.from === "1.4.60" && entry.archives[0].file.startsWith(`${CL.ART_DIR}/zh-`), entry)

    // ---- the rebuild fingerprint follows the setting ----
    const { scheduleFingerprint } = require(path.join(scripts, "schedule_fingerprint.cjs"))
    const dataDir = path.join(temp, ".database")
    fs.mkdirSync(dataDir, { recursive: true })
    const english = scheduleFingerprint(dataDir)

    // ---- the server side ----
    const GL = await import(new URL("nya/gameLanguage.js", out))
    const lang = GL.default ?? GL
    check("English by default", lang.getGameLanguage() === "en")
    lang.setGameLanguage("zh")
    check("set to Chinese, saved in .database/game_language.json", lang.getGameLanguage() === "zh" && fs.existsSync(path.join(dataDir, "game_language.json")))
    const chinese = scheduleFingerprint(dataDir)
    check("Chinese changes the rebuild fingerprint", chinese !== english)
    let refused = false
    try { lang.setGameLanguage("fr") } catch { refused = true }
    check("an unknown language is refused", refused && lang.getGameLanguage() === "zh")

    // the CN app's text in Chinese; the global app's stays English
    const { runInCnContext } = await import(new URL("lib/cnClient.js", out))
    const inCn = fn => new Promise(resolve => runInCnContext(true, () => resolve(fn())))
    check("CN app: Chinese text", await inCn(() => lang.gameText("Hello", "你好")) === "你好")
    check("global app: English text", lang.gameText("Hello", "你好") === "Hello")

    const MS = await import(new URL("nya/mailSchedule.js", out))
    const ms = MS.default ?? MS
    check("default mail titles in Chinese", ms.defaultTitleZh("Free beads * 100") === "免费星导石 * 100" && ms.defaultTitleZh("Item 1001 * 5") === "道具 1001 * 5")
    check("a title typed on the dashboard stays as typed", ms.defaultTitleZh("Happy birthday!") === "Happy birthday!")
    const GM = await import(new URL("nya/cnGiftMails.js", out))
    const gm = GM.default ?? GM
    const firstGift = require(path.join(scripts, "..", "assets", "cn_gift_mails.json")).mails[0]
    const giftText = gm.cnGiftTextZh(gm.scheduleIdOf(firstGift.id, 0))
    check("CN's gift mails have Chinese titles", giftText?.title === firstGift.titleZh && /[一-鿿]/.test(giftText?.message ?? ""), giftText)
    const gifts = require(path.join(scripts, "..", "assets", "cn_gift_mails.json")).mails
    check("every gift has a Chinese title", gifts.every(g => typeof g.titleZh === "string" && /[一-鿿]/.test(g.titleZh)), gifts.filter(g => !g.titleZh).map(g => g.id))

    const names = require(path.join(scripts, "..", "assets", "event_names_zh.json")).names
    check("CN's own event names are there (boss event 1, banner 1)", /[一-鿿]/.test(names["advent_event:1"] ?? "") && /[一-鿿]/.test(names["gacha:1"] ?? ""), [names["advent_event:1"], names["gacha:1"]])

    // the comics in Chinese: the CN fork's file names (src/routes/api/comic.ts)
    const CM = await import(new URL("routes/api/comic.js", out))
    const parseZh = (CM.default?.parseZhComicName ?? CM.parseZhComicName)
    check("Chinese comic names: 第N话 标题.jpg", JSON.stringify(parseZh(0, "第12话 史黛拉的世界.jpg")) === JSON.stringify({ episode: 12, title: "史黛拉的世界" }), parseZh(0, "第12话 史黛拉的世界.jpg"))
    check("Chinese comic names: Stella's 第N课 ... 今日课程：标题", JSON.stringify(parseZh(1, "第3课 今日课程：弹射是什么？.jpg")) === JSON.stringify({ episode: 3, title: "弹射是什么" }), parseZh(1, "第3课 今日课程：弹射是什么？.jpg"))
    check("Chinese comic names: other files are no comic", parseZh(0, "第12话 史黛拉.png") === null && parseZh(0, "cover.jpg") === null && parseZh(1, "第12话 x.jpg") === null)

    // the English tables' list: files.json, or (a data pack without one) the folder's own tables
    const listDir = path.join(temp, "cn_text_list")
    fs.mkdirSync(path.join(listDir, "production", "upload", "ab"), { recursive: true })
    fs.writeFileSync(path.join(listDir, "production", "upload", "ab", "cdef"), "x")
    check("no files.json: the English tables folder lists itself", JSON.stringify(CL.translatedPaths(listDir)) === JSON.stringify(["production/upload/ab/cdef"]), CL.translatedPaths(listDir))
    fs.writeFileSync(path.join(listDir, "files.json"), JSON.stringify([{ path: "production/upload/ab/cdef" }, { path: "production/upload/cd/0123", from: "elsewhere" }]))
    check("files.json lists every table, also ones in earlier folders", CL.translatedPaths(listDir).length === 2, CL.translatedPaths(listDir))

    // the dashboard's dictionary and the companion's table: every text has its Chinese
    const { execFileSync } = require("child_process")
    let companion = ""
    try { companion = execFileSync(process.execPath, [path.join(scripts, "gen_companion_zh.cjs"), "--check"], { encoding: "utf8" }) } catch (e) { companion = String(e.stdout) + " FAILED" }
    check("companion app: every text has its Chinese", / 0 problem\(s\)/.test(companion) && !companion.includes("FAILED"), companion.trim().split("\n").slice(-3).join(" | "))
    const dashboard = execFileSync(process.execPath, [path.join(scripts, "dashboard_strings.cjs")], { encoding: "utf8" })
    check("dashboard: every text has its Chinese", / 0 without Chinese/.test(dashboard), dashboard.trim().split("\n")[0])

    lang.setGameLanguage("en")
    check("back to English removes the file and the fingerprint matches English again", !fs.existsSync(path.join(dataDir, "game_language.json")) && scheduleFingerprint(dataDir) === english)
} catch (error) {
    console.log("FAIL", error)
    failures++
} finally {
    process.chdir(os.tmpdir())
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { }
}

console.log(failures ? `\n${failures} game language test(s) failed.` : "\nAll game language tests passed.")
process.exit(failures ? 1 : 0)
