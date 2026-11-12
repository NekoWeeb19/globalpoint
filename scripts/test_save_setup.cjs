// Testing helper (no dashboard): gets a test save ready without replaying the game. It can clear every main story
// stage, so all chapters are open, and set the player rank. It works on a database you name (use a copy or the
// emulator's test database, never someone's real save). Close the game completely before running it and reopen it
// after: the game reads the save at login.
//
//   node scripts/test_save_setup.cjs --db <path to wdfp_data.db> --list
//   node scripts/test_save_setup.cjs --db <path> --player 2 --unlock-chapters
//   node scripts/test_save_setup.cjs --db <path> --player 2 --rank 120
//
// --player can be left out when the database has only one player.
// --unlock-chapters: every stage in assets/main_quest.json is marked cleared. Stages already cleared keep their
//   score and rank. No clear rewards are given. Units that join during the story arrive at the next login
//   (catchUpQuestJoinUnitsSync).
// --rank N (1-250): the rank points are set to where that rank starts (assets/player_rank.json). This also works
//   downwards.
//
// (A community member made these two as dashboard buttons, 2026-11-12. They stay a testing tool until a player asks
// for them.)
const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..")
const MAIN_SECTION = 1 // QuestCategory.MAIN

function argValue(name) {
    const i = process.argv.indexOf(name)
    return i >= 0 ? process.argv[i + 1] : undefined
}
const has = name => process.argv.includes(name)
function fail(message) {
    console.error(message)
    process.exit(1)
}

const dbPath = argValue("--db")
if (!dbPath) fail("Name the database with --db <path to wdfp_data.db> (a test copy, not a real save).")
if (!fs.existsSync(dbPath)) fail(`No database at ${dbPath}.`)
const listOnly = has("--list"), unlock = has("--unlock-chapters"), rankArg = argValue("--rank")
if (!listOnly && !unlock && rankArg === undefined) fail("Nothing to do: give --list, --unlock-chapters and/or --rank N.")

const rankData = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "player_rank.json"), "utf-8"))
const rankOf = rp => rankData.filter(r => r.total_rp <= rp).pop()?.rank ?? 1

const Database = require("better-sqlite3")
const db = new Database(dbPath)
const players = db.prepare("SELECT id, name, rank_point FROM players ORDER BY id").all()

if (listOnly) {
    if (players.length === 0) console.log("No players in this database.")
    for (const p of players) {
        const cleared = db.prepare("SELECT COUNT(*) AS n FROM players_quest_progress WHERE player_id = ? AND section = ? AND finished = 1").get(p.id, MAIN_SECTION).n
        console.log(`Player ${p.id}${p.name ? ` (${p.name})` : ""}: rank ${rankOf(p.rank_point)}, ${cleared} story stage(s) cleared`)
    }
    if (!unlock && rankArg === undefined) process.exit(0)
}

let playerId = argValue("--player")
if (playerId === undefined) {
    if (players.length !== 1) fail(`This database has ${players.length} players: pick one with --player <id> (see --list).`)
    playerId = players[0].id
}
playerId = Number(playerId)
if (!players.some(p => p.id === playerId)) fail(`There's no player ${playerId} in this database.`)

if (unlock) {
    const questIds = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "main_quest.json"), "utf-8"))).map(Number)
    const count = () => db.prepare("SELECT COUNT(*) AS n FROM players_quest_progress WHERE player_id = ? AND section = ? AND finished = 1").get(playerId, MAIN_SECTION).n
    const before = count()
    const upsert = db.prepare(`INSERT INTO players_quest_progress (section, quest_id, finished, player_id) VALUES (?, ?, 1, ?)
        ON CONFLICT (section, quest_id, player_id) DO UPDATE SET finished = 1`)
    db.transaction(() => { for (const id of questIds) upsert.run(MAIN_SECTION, id, playerId) })()
    const chapters = [...new Set(questIds.map(id => Math.floor(id / 1_000_000)))].sort((a, b) => a - b)
    console.log(`Player ${playerId}: all story stages cleared (${count() - before} newly, ${questIds.length} in chapters ${chapters[0]}-${chapters[chapters.length - 1]}).`)
}

if (rankArg !== undefined) {
    const rank = Number(rankArg)
    if (!Number.isInteger(rank) || rank < 1 || rank > rankData.length) fail(`--rank must be a whole number from 1 to ${rankData.length}.`)
    const rp = rankData[rank - 1].total_rp
    db.prepare("UPDATE players SET rank_point = ? WHERE id = ?").run(rp, playerId)
    console.log(`Player ${playerId}: rank set to ${rank} (${rp} rank points).`)
}

db.close()
