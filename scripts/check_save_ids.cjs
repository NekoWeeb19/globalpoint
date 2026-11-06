// Finds units, armaments and ability souls in a save that the CN game doesn't have (a crash on screens
// that list them, like the team Edit screen). Reads a save file (dashboard Download Save / companion Export
// save) or, with --db, every player in this server's database.
//
//   node scripts/check_save_ids.cjs save-1.json
//   node scripts/check_save_ids.cjs --db
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCn } = require("./cn_read.cjs")

const ROOT = path.join(__dirname, "..")

async function cnIds(table) {
    const buf = await readCn(table)
    if (!buf) throw new Error(`CN table not found: ${table}`)
    return new Set(R.leaves(R.decodeFile(buf)).map(l => String(l.path[0])))
}

/** { units, armaments, souls, parties: [{ where, units, armaments, souls }] } of one save. */
function fromSave(save) {
    const d = save.data ?? save
    const keysOf = v => Array.isArray(v) ? v.map(x => String(x.character_id ?? x.equipment_id ?? x.id)) : Object.keys(v ?? {})
    const parties = []
    for (const [group, g] of Object.entries(d.user_party_group_list ?? {})) {
        for (const [slot, p] of Object.entries(g.list ?? {})) parties.push({
            where: `party group ${group}, slot ${slot}`,
            units: [...(p.character_ids ?? []), ...(p.unison_character_ids ?? [])],
            armaments: p.equipment_ids ?? [],
            souls: p.ability_soul_ids ?? [],
        })
    }
    return { units: keysOf(d.user_character_list), armaments: keysOf(d.user_equipment_list), parties }
}

function fromDb() {
    const Database = require("better-sqlite3")
    const db = new Database(path.join(process.cwd(), ".database", "wdfp_data.db"), { readonly: true })
    const out = new Map()
    for (const { id } of db.prepare("SELECT id FROM players").all()) out.set(id, { units: [], armaments: [], parties: [] })
    for (const r of db.prepare("SELECT player_id, id AS character_id FROM players_characters").all()) out.get(r.player_id)?.units.push(String(r.character_id))
    for (const r of db.prepare("SELECT player_id, id AS equipment_id FROM players_equipment").all()) out.get(r.player_id)?.armaments.push(String(r.equipment_id))
    for (const p of db.prepare("SELECT * FROM players_parties").all()) out.get(p.player_id)?.parties.push({
        where: `party category ${p.category}, group ${p.group_id}, slot ${p.slot}`,
        units: [p.character_id_1, p.character_id_2, p.character_id_3, p.unison_character_1, p.unison_character_2, p.unison_character_3],
        armaments: [p.equipment_1, p.equipment_2, p.equipment_3],
        souls: [p.ability_soul_1, p.ability_soul_2, p.ability_soul_3],
    })
    return out
}

;(async () => {
    const units = await cnIds("master/character/character.orderedmap")
    const armaments = await cnIds("master/item/equipment.orderedmap")
    const souls = await cnIds("master/ability/ability_soul.orderedmap")
    // custom units (assets/custom_units) are in the CN update too
    try { for (const u of require(path.join(ROOT, "assets", "custom_units", "units.json")).units ?? []) units.add(String(u.id)) } catch { }

    const saves = process.argv.includes("--db")
        ? fromDb()
        : new Map(process.argv.slice(2).map(f => [f, fromSave(JSON.parse(fs.readFileSync(f, "utf8")))]))
    if (saves.size === 0) { console.log("usage: node scripts/check_save_ids.cjs <save.json> | --db"); process.exit(2) }
    let problems = 0
    for (const [who, s] of saves) {
        const lines = []
        const bad = (list, known) => [...new Set(list.filter(id => id !== null && id !== undefined && id !== "" && !known.has(String(id))).map(String))]
        const u = bad(s.units, units), a = bad(s.armaments, armaments)
        if (u.length) lines.push(`  units the CN game doesn't have: ${u.join(", ")}`)
        if (a.length) lines.push(`  armaments the CN game doesn't have: ${a.join(", ")}`)
        for (const p of s.parties) {
            const pu = bad(p.units, units), pa = bad(p.armaments, armaments), ps = bad(p.souls, souls)
            if (pu.length || pa.length || ps.length) lines.push(`  ${p.where}: ${[pu.length ? `units ${pu}` : "", pa.length ? `armaments ${pa}` : "", ps.length ? `ability souls ${ps}` : ""].filter(Boolean).join("; ")}`)
        }
        console.log(`${typeof who === "number" ? `player ${who}` : who}: ${s.units.length} units, ${s.armaments.length} armaments${lines.length ? "" : ", all known to the CN game"}`)
        for (const l of lines) console.log(l)
        problems += lines.length
    }
    process.exit(problems ? 1 : 0)
})()
