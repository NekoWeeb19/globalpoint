// Campaign mission groups (the "Promo Missions" rounds and Treasure Hunts: master/reward/event/collect_item_event, open
// from/until in columns 20/21) and their missions (master/mission/collect_item_event_mission, group in column 0). CN's
// real calendar (scripts/cn_calendar.cjs) moved some groups' missions but not the groups (CN's fork didn't have that
// table), so a group could be closed while its missions run: its mission tab hidden and its battle drops off. A group
// whose missions start outside its window takes its missions' window. Used by scripts/gen_cn_event_schedule.cjs (the
// table the game gets) and scripts/gen_event_drops.cjs (the server's drop windows). Times are the tables' (China time).
const R = require("./cdn_rows.cjs")

const DATE = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/

/** { group id: { from, until } }: each group's missions' earliest start and latest end, from { row key: csv text }. */
function missionWindows(rows) {
    const out = {}
    for (const text of Object.values(rows)) {
        const c = R.splitCsv(R.splitCsvLines(String(text).replace(/\n$/, ""))[0])
        const dates = c.filter(x => DATE.test(x))
        if (!c[0] || dates.length < 2) continue
        const w = out[c[0]] ??= { from: dates[0], until: dates[1] }
        if (dates[0] < w.from) w.from = dates[0]
        if (dates[1] > w.until) w.until = dates[1]
    }
    return out
}

/** The window a group should have ([from, until]), or null when its own already holds its missions' start. */
function alignedWindow(from, until, missions) {
    if (!missions || !DATE.test(String(from)) || !DATE.test(String(until))) return null
    if (missions.from >= from && missions.from <= until) return null
    return [missions.from, missions.until]
}

module.exports = { missionWindows, alignedWindow }
