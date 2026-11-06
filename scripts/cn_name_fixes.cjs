// CN event names the translation got wrong: it gave these rows the English of global's event with the same
// number (or of a different run), but in CN's files they're other events. Used by scripts/gen_cn_event_schedule.cjs
// (the in-game name) and scripts/gen_event_catalog.cjs --cn (the dashboard's).
//   table -> row -> [column, the wrong English, the right one]
module.exports = {
    "master/quest/event/advent_event.orderedmap": {
        // CN: 凉宫春日的跳跃 (the Haruhi Suzumiya collab); global's 100006 is the Re:Zero rerun
        "100006": [2, "Wanderers from Another World", "The Leap of Haruhi Suzumiya"],
        // CN: 光废龙讨伐复刻 (a Lightcrest Serpent rerun); global's 100007 is a collab
        "100007": [2, "Shifting Tracks, Distant Worlds", "Lightcrest Serpent"],
        "3001": [2, "Shifting Tracks, Distant Worlds", "Lightcrest Serpent"],
        // CN: 为你奏响的镇魂歌, like its other runs (9, 300002)
        "16": [2, "Not Today, Romero", "The Descension: A Requiem for You"],
    },
}
