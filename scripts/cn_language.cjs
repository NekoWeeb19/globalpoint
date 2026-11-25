// The CN game in Chinese (dashboard Game settings, scripts/game_language.cjs): turns the update builder's English
// tables back into CN's own text, keeping everything else GlobalPoint changes (dates, rows, rates, fixes).
//
// Rule, per table: a cell that CN's own copy (CN_CDN_DIR, newest original) has in Chinese (scripts/gen_cn_text.cjs
// isCnText: Chinese characters, no kana) and that the update changed goes back to CN's cell. Other cells stay as the
// update has them: dates, numbers, ids, and cells CN left in Japanese (those keep their English). Rows are matched
// by their keys; inside a key, records by position, or by their first cell when the update added or removed records.
// Rows CN doesn't have (GlobalPoint's copies: the Haunt's extra months, yearly free pulls) take the Chinese of the
// same English cell elsewhere in the table; their other text stays as it is. Tested on the emulator 2026-11-25 (195,190 cells in 1,865 tables).
//
// Switching language (or a game that is ahead of this server, whose copies can't be known) needs more than the
// tables this update edits: every table GlobalPoint's translation touched (CN_TRANSLATED_DIR files.json) ships too,
// from the newest English copy in StarPoint's updates (an update built in Chinese doesn't count; they are listed in
// <cdn>/cn_patches/languages.json), in the update's language.
//
// Pictures with text and the labels built into the game app are not covered (see docs/CHINESE.md).
const fs = require("fs")
const path = require("path")
const unzipper = require("unzipper")
const R = require("./cdn_rows.cjs")
const { recordsOf, isCnText } = require("./gen_cn_text.cjs")
const { cnZips } = require("./cn_archives.cjs")

const LANGUAGES_FILE = "languages.json"
const encodeRecords = (recs, trailing) => {
    const rows = recs.length > 0 && recs[recs.length - 1].length === 1 && recs[recs.length - 1][0] === "" ? recs.slice(0, -1) : recs
    return rows.map(r => r.map(R.csvField).join(",")).join("\n") + (trailing ? "\n" : "")
}

/**
 * One record back to CN's Chinese cells; returns how many cells changed. learned: English cell -> CN's Chinese
 * (null when one English text had two Chinese ones), for the rows GlobalPoint copies.
 */
function revertRecord(rec, cn, learned) {
    if (!cn || rec.length !== cn.length) return 0
    let n = 0
    for (let c = 0; c < rec.length; c++) if (rec[c] !== cn[c] && isCnText(cn[c])) {
        // only text (an empty or number cell CN filled in says nothing about other rows)
        if (learned && /[A-Za-z]{2}/.test(rec[c])) learned.set(rec[c], learned.has(rec[c]) && learned.get(rec[c]) !== cn[c] ? null : cn[c])
        rec[c] = cn[c]; n++
    }
    return n
}

/**
 * Puts CN's Chinese text back into a decoded table (in place). cnRoot: CN's own copy, decoded.
 * Rows CN doesn't have that GlobalPoint copies from CN's (the Haunt's extra months, yearly free pull copies) get
 * the Chinese of the same English cell in this table.
 * @returns the number of cells changed
 */
function chineseTree(root, cnRoot) {
    const cnLeaves = new Map(R.leaves(cnRoot).map(({ path: keys, leaf }) => [keys.join("/"), leaf.text]))
    const learned = new Map(), added = []
    let changed = 0
    for (const { path: keys, leaf } of R.leaves(root)) {
        const cnText = cnLeaves.get(keys.join("/"))
        if (typeof leaf.text === "string" && cnText === undefined) added.push(leaf)
        if (typeof leaf.text !== "string" || cnText === undefined || cnText === leaf.text) continue
        const recs = recordsOf(leaf.text), cnRecs = recordsOf(cnText)
        let n = 0
        if (recs.length === cnRecs.length) {
            for (let r = 0; r < recs.length; r++) n += revertRecord(recs[r], cnRecs[r], learned)
        } else {
            // records added or removed: match by the first cell when it's unique in CN's copy
            const byFirst = new Map()
            for (const rec of cnRecs) byFirst.set(rec[0], byFirst.has(rec[0]) ? null : rec)
            for (const rec of recs) n += revertRecord(rec, byFirst.get(rec[0]) ?? undefined, learned)
        }
        if (n > 0) { R.setLeafText(leaf, encodeRecords(recs, leaf.text.endsWith("\n"))); changed += n }
    }
    // the rows CN doesn't have: a cell whose English the table has as one Chinese text takes it
    for (const leaf of added) {
        const recs = recordsOf(leaf.text)
        let n = 0
        for (const rec of recs) for (let c = 0; c < rec.length; c++) {
            const zh = learned.get(rec[c])
            if (typeof zh === "string") { rec[c] = zh; n++ }
        }
        if (n > 0) { R.setLeafText(leaf, encodeRecords(recs, leaf.text.endsWith("\n"))); changed += n }
    }
    return changed
}

/**
 * Reads CN's own copies of stored paths ("production/upload/xx/hash"): a slim folder's tables/, else the archives
 * (each needed archive opened once). Returns path -> Buffer (paths CN lacks are left out).
 */
async function readCnOriginals(cnDir, paths) {
    const out = new Map()
    const wanted = new Set(paths)
    const slim = path.join(cnDir, "tables")
    if (fs.existsSync(slim)) {
        for (const p of wanted) {
            const file = path.join(slim, p)
            if (fs.existsSync(file)) out.set(p, fs.readFileSync(file))
        }
        if (cnZips(cnDir).length === 0) return out
    }
    // archives: CN's file index names the version holding each file's newest copy (as scripts/cn_read.cjs reads
    // one file), so only the archives of those versions are opened, each once
    const { cnIndex } = require("./cn_read.cjs")
    const index = cnIndex()
    const byVersion = new Map()
    for (const p of wanted) {
        if (out.has(p)) continue
        const version = index.get(p)
        if (version) (byVersion.get(version) ?? byVersion.set(version, new Set()).get(version)).add(p)
    }
    if (byVersion.size === 0) return out
    for (const z of cnZips(cnDir)) {
        const name = path.basename(z)
        const versions = [...byVersion.keys()].filter(v => name.includes(`-${v}-`))
        if (versions.length === 0) continue
        const zip = await unzipper.Open.file(z)
        for (const e of zip.files) {
            if (e.type !== "File") continue
            // archive entries may or may not start with "production/" (scripts/cn_read.cjs matches the same way)
            const p = "production/" + e.path.split("\\").join("/").replace(/^production\//, "")
            if (versions.some(v => byVersion.get(v).has(p)) && !out.has(p)) out.set(p, await e.buffer())
        }
    }
    return out
}

const versionParts = s => s.split(".").map(Number)
const compareVersions = (a, b) => { const x = versionParts(a), y = versionParts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0 }

/** The updates built in a language other than English: { version: "zh" }. */
function readLanguages(patchDir) {
    try { return JSON.parse(fs.readFileSync(path.join(patchDir, LANGUAGES_FILE), "utf8")) } catch { return {} }
}
/** Records an update's language (only non-English ones are kept). */
function recordLanguage(patchDir, version, language) {
    const all = readLanguages(patchDir)
    if (language === "en") delete all[version]
    else all[version] = language
    fs.writeFileSync(path.join(patchDir, LANGUAGES_FILE), JSON.stringify(all, null, 1))
}

/**
 * The newest English copy of each wanted path in StarPoint's updates (<cdn>/cn_patches), skipping the updates
 * built in another language. Returns path -> Buffer.
 */
async function newestEnglishCopies(patchDir, paths) {
    const out = new Map()
    const wanted = new Set(paths)
    const listFile = path.join(patchDir, "patches.json")
    if (!fs.existsSync(listFile) || wanted.size === 0) return out
    const languages = readLanguages(patchDir)
    const patches = JSON.parse(fs.readFileSync(listFile, "utf8")).sort((a, b) => compareVersions(a.version, b.version))
    for (const p of patches) {
        if (languages[p.version] && languages[p.version] !== "en") continue
        for (const a of p.archives) {
            const file = path.join(patchDir, a.file)
            if (!fs.existsSync(file)) continue
            for (const e of (await unzipper.Open.file(file)).files) {
                const k = e.path.split("\\").join("/")
                if (e.type === "File" && wanted.has(k)) out.set(k, e)
            }
        }
    }
    for (const [k, e] of out) out.set(k, await e.buffer())
    return out
}

/** The stored paths of every table GlobalPoint's translation touched (CN_TRANSLATED_DIR files.json). */
function translatedPaths(translatedDir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(translatedDir, "files.json"), "utf8")).map(f => f.path ?? f).filter(p => typeof p === "string")
    } catch {
        return []
    }
}

// ---- the Chinese community's fixes (assets/cn_zh_fixes.json, scripts/gen_cn_zh_fixes.cjs) ----

let zhFixesCache = null
/** The community fixes: { cells: table -> row key -> "rec:col" -> [CN's text, theirs], rules: [{ from, to, except }], hash }. */
function zhFixes() {
    if (zhFixesCache) return zhFixesCache
    // the community's fixes, then GlobalPoint's own for what they don't cover (assets/cn_zh_own.json, scripts/gen_cn_zh_own.cjs)
    const cells = {}, rows = {}, rules = [], hash = require("crypto").createHash("sha1")
    for (const name of ["cn_zh_fixes.json", "cn_zh_own.json"]) {
        try {
            const text = fs.readFileSync(path.join(__dirname, "..", "assets", name), "utf8")
            const data = JSON.parse(text)
            hash.update(text)
            for (const [table, rows] of Object.entries(data.cells ?? {})) for (const [key, at] of Object.entries(rows)) Object.assign(((cells[table] ??= {})[key] ??= {}), at)
            for (const [table, byKey] of Object.entries(data.rows ?? {})) Object.assign((rows[table] ??= {}), byKey)
            rules.push(...(data.rules ?? []))
        } catch { }
    }
    zhFixesCache = { cells, rows, rules, hash: Object.keys(cells).length ? hash.digest("hex").slice(0, 12) : "" }
    return zhFixesCache
}
/** The tables the community fixes touch: their cells' tables, and every table a rule applies to that isn't excepted. */
function zhFixTables(knownTables) {
    const f = zhFixes()
    const out = new Set(Object.keys(f.cells))
    for (const rule of f.rules) for (const t of knownTables) if (!rule.except?.includes(t)) out.add(t)
    return out
}

/**
 * Applies the community fixes to one table of the game in Chinese (in place), after chineseTree: a fixed cell takes
 * their Chinese while CN's own copy (cnRoot) still has the text the fix was made from (so it reaches cells that were
 * English for CN's Japanese too); then the rules change their terms in every Chinese cell, unless the table is excepted.
 * @returns the number of cells changed
 */
function applyZhFixes(file, root, cnRoot) {
    const f = zhFixes()
    const fixes = f.cells[file]
    const rules = f.rules.filter(rule => !rule.except?.includes(file))
    if (!fixes && rules.length === 0) return 0
    const cnLeaves = fixes ? new Map(R.leaves(cnRoot).map(({ path: k, leaf }) => [k.join("/"), leaf.text])) : null
    let changed = 0
    for (const { path: keys, leaf } of R.leaves(root)) {
        if (typeof leaf.text !== "string") continue
        const key = keys.join("/")
        const rowFixes = fixes?.[key]
        const needsRule = rules.some(rule => leaf.text.includes(rule.from))
        if (!rowFixes && !needsRule) continue
        const recs = recordsOf(leaf.text)
        let n = 0
        if (rowFixes) {
            const cnRecs = recordsOf(cnLeaves.get(key) ?? "")
            for (const [at, [was, zh]] of Object.entries(rowFixes)) {
                const [r, c] = at.split(":").map(Number)
                if (recs[r]?.[c] === undefined || (cnRecs[r]?.[c] ?? "").replace(/\r/g, "").trim() !== was) continue
                if (recs[r][c] !== zh) { recs[r][c] = zh; n++ }
            }
        }
        for (const rule of rules) for (const rec of recs) for (let c = 0; c < rec.length; c++) {
            if (HAN.test(rec[c]) && rec[c].includes(rule.from)) { rec[c] = rec[c].split(rule.from).join(rule.to); n++ }
        }
        if (n > 0) { R.setLeafText(leaf, encodeRecords(recs, leaf.text.endsWith("\n"))); changed += n }
    }
    return changed
}
const HAN = /[㐀-鿿]/

// ---- pictures (assets/cn_lang_art.json, scripts/gen_cn_lang_art.cjs) ----
//
// A language switch also ships the pictures and sprite layouts StarPoint replaced: CN's originals in Chinese (from a
// PC's CN archives, or a phone's Chinese art pack in the slim folder's tables/), their English copies back in
// English. About 1.6 GB, so each set is zipped once into <cdn>/cn_patches/lang-art/<language>-<hash>/ and every later
// switch's update entry points at those same archives (a new version number, no new copy). The hash is of what's in
// it, so new English art (a later art update) makes a new set.

const ART_DIR = "lang-art"
const ART_LIMIT = 20 * 1024 * 1024

/** The pictures a switch ships (assets/cn_lang_art.json), or [] when the list isn't there. */
function artPaths() {
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets", "cn_lang_art.json"), "utf8")).paths ?? [] } catch { return [] }
}

/**
 * The archives of a language's picture set, made once and kept: [{ file, size, sha256 }] (file relative to the
 * update folder), and how many files. Chinese needs every listed picture from CN's originals (a partial set would mix
 * languages within a sheet): null when they aren't all there (no Chinese art pack on a phone).
 */
async function artArchives(language, patchDir, cnDir, paths) {
    if (paths.length === 0) return null
    let files
    if (language === "zh") {
        files = await readCnOriginals(cnDir, paths)
        if (files.size < paths.length) return null
    } else {
        files = await newestEnglishCopies(patchDir, paths)
        if (files.size === 0) return null
    }
    const crypto = require("crypto")
    const hash = crypto.createHash("sha1")
    for (const p of [...files.keys()].sort()) hash.update(p).update(crypto.createHash("sha1").update(files.get(p)).digest())
    const name = `${language}-${hash.digest("hex").slice(0, 12)}`
    const dir = path.join(patchDir, ART_DIR, name)
    const manifest = path.join(dir, "manifest.json")
    if (fs.existsSync(manifest)) {
        const kept = JSON.parse(fs.readFileSync(manifest, "utf8"))
        if (kept.archives.every(a => fs.existsSync(path.join(patchDir, a.file)))) return kept
    }
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(path.join(dir, "archive-common-diff"), { recursive: true })
    const { zip } = require("./gen_translation_mod.cjs")
    const archives = []
    let batch = [], size = 0
    const flush = () => {
        if (batch.length === 0) return
        const data = zip(batch)
        const file = `${ART_DIR}/${name}/archive-common-diff/pinball-${name}-${archives.length + 1}.zip`
        fs.writeFileSync(path.join(patchDir, file), data)
        archives.push({ file, size: data.length, sha256: crypto.createHash("sha256").update(data).digest("base64") })
        batch = []; size = 0
    }
    for (const p of [...files.keys()].sort()) {
        batch.push({ name: p, data: files.get(p) })
        size += files.get(p).length
        if (size >= ART_LIMIT) flush()
    }
    flush()
    const kept = { language, files: files.size, archives }
    fs.writeFileSync(manifest, JSON.stringify(kept, null, 1))
    return kept
}

/** Adds an update entry for a picture set (archives made by artArchives) to the update list. */
function registerArt(patchDir, version, from, art) {
    const listFile = path.join(patchDir, "patches.json")
    const patches = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, "utf8")) : []
    const kept = patches.filter(p => p.version !== version)
    kept.push({ version, from, files: art.files, archives: art.archives })
    kept.sort((a, b) => compareVersions(a.version, b.version))
    fs.writeFileSync(listFile, JSON.stringify(kept, null, 1))
}

module.exports = { chineseTree, readCnOriginals, newestEnglishCopies, translatedPaths, readLanguages, recordLanguage, LANGUAGES_FILE, artPaths, artArchives, registerArt, ART_DIR, zhFixes, zhFixTables, applyZhFixes }
