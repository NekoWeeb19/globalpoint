// Hand-made kit changes for assets/kit_dates.json: balance patch lines the other builders can't do
// (an effect the patch added, or numbers the note's text doesn't place). Each edit starts from the unit's
// row as of its patch (a later patch's old row if there is one, else CN's current row), and the stage it
// lands in also goes into the unit's earlier stages that don't have the row (stages are cumulative).
// These change codes, not just numbers: check them in game (the unit page text).
//
//   node scripts/build_kit_manual.cjs [--units <id>,<id>...] [--write]
//
// --units: only those kit keys (unit ids, "armament:<id>"). An edit starts from its own stage's row when there is
// one, so re-running a "drop" edit on a row it already made drops another line: run new edits with --units.
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("./cn_read.cjs")

const KIT_FILE = path.join(__dirname, "..", "assets", "kit_dates.json")
const AB = "master/ability/ability.orderedmap", LD = "master/ability/leader_ability.orderedmap", SOUL = "master/ability/ability_soul.orderedmap"
// on CN's calendar: each stage 6 weeks before global's date (CN had the 2022 multiball rework on 2022-04-19, global on
// 2022-05-31; the later two keep that lead, decided 2026-11-22). The sources name global's posts.
const P2022 = { until: "2022-04-19 06:00:00", source: "global news 1241 (live 2022-05-31)" }
const P2022A = { until: "2022-04-19 06:00:00", source: "global news 1242 (live 2022-05-31)" }
const P2023 = { until: "2023-08-01 06:00:00", source: "global news 2610 (live 2023-09-12)" }
const P2024 = { until: "2024-04-15 06:00:00", source: "global 2.1.108 game files (2024-05-27)" }

// cols: { column: value } for the first line of a row of any table, kept as a column patch;
// drop: line indexes to leave out; set: { line: { column: value } } (indexes of the starting row)
// lines: the whole new row, line by line (instead of drop): { line: n } = line n of the starting row, { copy:
// "ab:<row key>/<n>" | "ld:<row key>/<n>" } = line n of another CN ability / leader row (put in this table's layout,
// with this row's name in column 0), each with an optional set: { column: value } (this table's layout)
const EDITS = [
    // leader skills: the attack line the patch added is left out
    { unit: "121002", name: "Top-class Diviner Suizen", ...P2022, table: LD, key: "121002", drop: [1], note: "Leader: +40% HP only (the +40% attack was added)" },
    { unit: "131005", name: "King of the Ring Barrek", ...P2022, table: LD, key: "131005", set: { 0: { 49: "48750", 50: "65000" } }, drop: [2, 3], note: "Leader: +65% attack, no Power Flip damage" },
    { unit: "131013", name: "Midsummer Magician Illumine", ...P2022, table: LD, key: "131013", drop: [1], note: "Leader: +20% HP / Fever gauge on skill, no +40% attack" },
    { unit: "251002", name: "Knight of the White Helm Gerard", ...P2022, table: LD, key: "251002", drop: [2], note: "Leader: +20% HP & +15% Dark resistance, no +20% attack" },
    // abilities: the attack line the patch added is left out
    { unit: "241002", name: "Halcyon Hunter Aurore", ...P2022, table: AB, key: "2410021", drop: [2], note: "Ability 1: +15% HP only" },
    { unit: "261011", name: "Uncouth Alchemist Bryce", ...P2022, table: AB, key: "2610111", drop: [1], note: "Ability 1: +50% skill gauge on first skill only" },
    // numbers the note's text doesn't place
    { unit: "261010", name: "Aspiring First-Class Adventurer Grieg", ...P2022, table: AB, key: "2610103", set: { 0: { 30: "400000", 31: "400000", 51: "4000", 52: "8000" } }, note: "Ability 3: every 4 kills +8% Power Flip damage (Max +80%)" },
    { unit: "211004", name: "Demon-born Hunter Asukirimaru", ...P2022, table: AB, key: "2110043", set: { 1: { 51: "20000", 52: "40000" } }, note: "Ability 3: +40% attack (combo -3 unchanged)" },
    { unit: "161005", name: "Dare Devil Carla", ...P2022, table: AB, key: "1610051", set: { 0: { 51: "5000", 52: "10000" } }, note: "Ability 1: +10% attack per skill (Max +50%)" },
    { unit: "261005", name: "Seeker of the Abyss Liam", ...P2022, table: AB, key: "2610053", set: { 0: { 57: "15000000", 58: "30000000" } }, note: "Ability 3: Pierce for 5 seconds" },
    // 2022-05-31, the lines build_kit_text skipped (2026-11-22)
    { unit: "221001", name: "Swallow Knight Yuwel", ...P2022, table: AB, key: "2210011", set: { 0: { 113: "7500", 114: "15000" } }, note: "Ability 1: +15% attack for the party while HP above 50% (the note's '.' kept it out)" },
    { unit: "231003", name: "Gentlebot Regis", ...P2022, table: AB, key: "2310031", drop: [1], note: "Ability 1: first-skill +50% skill gauge only (the +15% attack was added)" },
    { unit: "241004", name: "Daughter of the Wind Melsele", ...P2022, table: AB, key: "2410041", drop: [1], note: "Ability 1: +15% HP only (the +15% attack was added)" },
    { unit: "251001", name: "Diva Divine Dia", ...P2022, table: AB, key: "2510013", drop: [1], note: "Ability 3: Fever heal only (the Fever +30% attack was added)" },
    { unit: "141004", name: "The One Who Survived Leon", ...P2022, table: AB, key: "1410043", set: { 0: { 34: "4" } }, note: "Ability 3: every 3 hits taken +20% attack, Max +80% (4 stacks)" },
    { unit: "241001", name: "Treasure-hunting Tiger Mia", ...P2022, table: AB, key: "2410013", set: { 0: { 51: "3000", 52: "6000" } }, note: "Ability 3: every 10 direct hits +6% attack for Wind (Max +60%)" },
    { unit: "141008", name: "Gale of Calamity Schult", ...P2022, table: AB, key: "9200553", set: { 2: { 51: "-2000000", 52: "-2000000" } }, note: "Ability 3: Power Flip Lv3 with 20 fewer combo (was 10)" },
    { unit: "121006", name: "Draconic Defender Remnith", ...P2022, table: AB, key: "1210063", set: { 0: { 113: "50000", 114: "40000" } }, note: "Ability 3: +50% direct hit damage per Attack Buff (the note's number is column 113; 114 kept at the 2024 old row's 40000)" },
    { unit: "231002", name: "Mad Scientist Renoir", ...P2022, table: LD, key: "231002", set: { 0: { 45: "32", 49: "45000", 50: "60000" }, 1: { 45: "119" } }, note: "Leader: +60% attack (was skill damage) & +15% damage against Slowed foes (was Paralysed); ability 1's old text is cut off in the note, so it stays" },
    // a "while" condition CN's units don't use (SkillDamageUp, 76); the client reads it and the game wording has it
    { unit: "161007", name: "Catty Sorceress Karyl", ...P2022, table: AB, key: "1610073", set: { 0: { 5: "1", 27: "", 39: "", 46: "", 47: "", 48: "", 51: "", 52: "", 85: "(None)", 97: "76", 98: "0", 100: "500000", 101: "500000", 108: "false", 109: "2", 110: "0", 113: "100000", 114: "200000" } }, note: "Ability 3: +200% skill damage while this unit's skill damage is boosted at least 500%" },
    // 2022-05-31 armaments build_kit_armaments skipped (soul layout: values 48/49 or 110/111; an added awakening line left out)
    { unit: "armament:5090001", name: "Kaleido Drop Pendant", ...P2022A, table: SOUL, key: "5090001", set: { 0: { 48: "10000", 49: "20000" } }, drop: [1], note: "+10% / +20% skill damage per element (Max x6), no awakening attack line" },
    { unit: "armament:5090003", name: "Crossed Fang Necklace", ...P2022A, table: SOUL, key: "5090003", set: { 0: { 48: "4000", 49: "8000" } }, drop: [2], note: "+4% / +8% attack for Leader per Lv3 Power Flip, no awakening Power Flip line" },
    { unit: "armament:5090007", name: "Kaleido Drop Bracelet", ...P2022A, table: SOUL, key: "5090007", set: { 1: { 48: "10000", 49: "20000" } }, note: "+10% / +20% attack for Leader" },
    { unit: "armament:5040016", name: "Predator", ...P2022A, table: SOUL, key: "5040016", set: { 0: { 48: "50000", 49: "100000" } }, drop: [2, 3], note: "+50% / +100% attack (Fire), no awakening Power Flip lines" },
    { unit: "armament:5030025", name: "Storm Trident", ...P2022A, table: SOUL, key: "5030025", drop: [2, 3], note: "no awakening skill-activated attack lines" },
    { unit: "armament:5060017", name: "Staff of the Ancient King", ...P2022A, table: SOUL, key: "5060017", set: { 0: { 48: "10000", 49: "40000" } }, note: "+10% / +40% attack for Multiballs per Fire unit" },
    { unit: "armament:5010005", name: "Durendal", ...P2022A, table: SOUL, key: "5010005", set: { 0: { 48: "140000", 49: "140000" } }, drop: [1], note: "+140% attack, no +15% HP" },
    { unit: "armament:5010025", name: "Spine of the Deep", ...P2022A, table: SOUL, key: "5010025", set: { 0: { 48: "12500", 49: "50000" }, 1: { 48: "150000" } }, note: "+12.5% / +50% per Water unit, +150% against Poisoned at every level" },
    { unit: "armament:5010028", name: "Tyrfing", ...P2022A, table: SOUL, key: "5010028", drop: [2, 3], note: "no awakening Pierce time lines" },
    { unit: "armament:4020007", name: "Tomahawk", ...P2022A, table: SOUL, key: "4020007", set: { 0: { 48: "25000", 49: "50000" } }, drop: [2], note: "+25% / +50% attack, no awakening skill line" },
    { unit: "armament:3080009", name: "Knight's Shield", ...P2022A, table: SOUL, key: "3080009", set: { 0: { 48: "2500", 49: "5000" } }, drop: [1], note: "+2.5% / +5% all resistance for Wind, no awakening line" },
    // 2023-09-12 reworks: leader skill and abilities rebuilt from the note's "before" text, with CN lines of the same
    // trigger/effect as templates (2026-11-22). The skill stays today's: what a skill does is in its action file, and
    // no copy of the old ones exists. Leader lines: level 1 = 75% of max; abilities: level 1 = half of max.
    // X Marks the Spot Mia
    { unit: "111009", name: "X Marks the Spot Mia", ...P2023, table: LD, key: "111009", lines: [{ line: 0 }, { line: 1, set: { 25: "12", 26: "", 28: "2000000", 29: "2000000", 32: "12", 49: "5625", 50: "7500" } }], note: "Leader: +40% attack (Fire) / combo 20 → +7.5% attack (Fire, Max +90%); no Power Flip combo line" },
    { unit: "111009", name: "X Marks the Spot Mia", ...P2023, table: AB, key: "1110091", lines: [{ line: 0, set: { 27: "12", 28: "", 30: "2000000", 31: "2000000", 57: "60000000", 58: "60000000" } }, { line: 1 }], note: "Ability 1: combo 20 → 10 s +80% attack / 8% Mana" },
    { unit: "111009", name: "X Marks the Spot Mia", ...P2023, table: AB, key: "1110092", lines: [{ line: 0, set: { 27: "24" } }], note: "Ability 2: skill gauge full → 20 s Multihit" },
    { unit: "111009", name: "X Marks the Spot Mia", ...P2023, table: AB, key: "1110093", lines: [{ line: 0, set: { 27: "107", 28: "0", 34: "100", 51: "1000", 52: "2000" } }], note: "Ability 3: skill hits → +2% attack (Max +200%)" },
    // Hotheaded Swordsman Kuramaru (2023, then the 2022 numbers on top: these come after the 2023 edits)
    { unit: "211013", name: "Hotheaded Swordsman Kuramaru", ...P2023, table: LD, key: "211013", lines: [{ line: 0, set: { 45: "205", 49: "11250", 50: "15000" } }, { line: 0, set: { 49: "48750", 50: "65000" } }], note: "Leader: +15% HP & +65% attack (Fire)" },
    { unit: "211013", name: "Hotheaded Swordsman Kuramaru", ...P2023, table: AB, key: "2110131", lines: [{ copy: "ab:3110116/0", set: { 2: "attack_common", 100: "1000000", 101: "1000000", 110: "0", 111: "", 113: "55000", 114: "110000" } }], note: "Ability 1: combo 10+ → +110% direct hit damage" },
    { unit: "211013", name: "Hotheaded Swordsman Kuramaru", ...P2023, table: AB, key: "2110132", lines: [{ copy: "ab:3610034/0", set: { 51: "40000", 52: "80000" } }], note: "Ability 2: +80% direct hit damage" },
    { unit: "211013", name: "Hotheaded Swordsman Kuramaru", ...P2023, table: AB, key: "2110133", lines: [{ line: 1, set: { 51: "20000", 52: "40000" } }], note: "Ability 3: every 5 Power Flips → 10 s Multihit [2 / +40%]" },
    { unit: "211013", name: "Hotheaded Swordsman Kuramaru", ...P2023, table: AB, key: "2110135", lines: [{ copy: "ab:1110095/0", set: { 109: "1", 113: "25000", 114: "50000" } }], note: "Ability 5: while Multihit, +50% direct hit damage" },
    { unit: "211013", name: "Hotheaded Swordsman Kuramaru", ...P2022, table: LD, key: "211013", lines: [{ line: 0, set: { 49: "9000", 50: "12000" } }, { line: 1, set: { 49: "30000", 50: "40000" } }], note: "Leader: +12% HP & +40% attack (Fire)" },
    { unit: "211013", name: "Hotheaded Swordsman Kuramaru", ...P2022, table: AB, key: "2110131", lines: [{ line: 0, set: { 113: "50000", 114: "100000" } }], note: "Ability 1: combo 10+ → +100% direct hit damage" },
    { unit: "211013", name: "Hotheaded Swordsman Kuramaru", ...P2022, table: AB, key: "2110132", lines: [{ line: 0, set: { 51: "30000", 52: "60000" } }], note: "Ability 2: +60% direct hit damage" },
    // Saintly Samurai Soushiro
    { unit: "131003", name: "Saintly Samurai Soushiro", ...P2023, table: LD, key: "131003", lines: [{ line: 0, set: { 49: "30000", 50: "40000" } }, { copy: "ab:1310131/1", set: { 46: "5", 47: "Yellow", 49: "15000", 50: "20000" } }], note: "Leader: +40% attack (Thunder) / Fever → first 3 times heal 20% HP (Thunder)" },
    { unit: "131003", name: "Saintly Samurai Soushiro", ...P2023, table: AB, key: "1310031", lines: [{ copy: "ab:1310033/0", set: { 1: "true", 51: "15000", 52: "30000" } }], note: "Ability 1: +30% attack" },
    { unit: "131003", name: "Saintly Samurai Soushiro", ...P2023, table: AB, key: "1310032", lines: [{ copy: "ab:1510011/0" }], note: "Ability 2: +20% Fever Mode time" },
    { unit: "131003", name: "Saintly Samurai Soushiro", ...P2023, table: AB, key: "1310033", lines: [{ copy: "ab:1510013/0", set: { 2: "attack_yellow", 111: "Yellow", 113: "25000", 114: "50000" } }, { copy: "ab:1510011/0", set: { 1: "false" } }], note: "Ability 3: Fever → +50% attack (Thunder) / +20% Fever Mode time" },
    // "while there are 1 or fewer enemies": EnemyLow (65), which CN's units don't use (EnemyHigh 64 they do)
    ...["1310035", "1310036"].map(key => ({ unit: "131003", name: "Saintly Samurai Soushiro", ...P2023, table: AB, key, lines: [{ copy: "ab:1510016/0", set: { 2: "attack_common", 97: "65", 100: "100000", 101: "100000", 102: "1", 110: "0", 111: "", 113: "30000", 114: "60000" } }], note: `Ability ${key.slice(-1)}: 1 or fewer enemies → +60% attack` })),
    // Daughter of Nine Tails Inaho
    { unit: "131001", name: "Daughter of Nine Tails Inaho", ...P2023, table: LD, key: "131001", lines: [{ line: 0, set: { 49: "30000", 50: "40000" } }, { copy: "ld:151001/1" }], note: "Leader: +40% attack (Thunder) / +30% Fever Mode time" },
    { unit: "131001", name: "Daughter of Nine Tails Inaho", ...P2023, table: AB, key: "1310011", lines: [{ copy: "ab:1310033/0", set: { 1: "true", 2: "attack_yellow", 48: "5", 49: "Yellow", 51: "7500", 52: "15000" } }], note: "Ability 1: +15% attack (Thunder)" },
    { unit: "131001", name: "Daughter of Nine Tails Inaho", ...P2023, table: AB, key: "1310012", lines: [{ line: 0, set: { 6: "0", 51: "1250000", 52: "2500000" } }], note: "Ability 2: Thunder skill → +25 Fever gauge (also in Fever)" },
    { unit: "131001", name: "Daughter of Nine Tails Inaho", ...P2023, table: AB, key: "1310013", lines: [{ copy: "ab:1510013/0", set: { 2: "attack_common", 110: "0", 111: "", 113: "100000", 114: "200000" } }], note: "Ability 3: in Fever → +200% attack" },
    { unit: "131001", name: "Daughter of Nine Tails Inaho", ...P2023, table: AB, key: "1310014", lines: [{ line: 0, set: { 2: "attack_common", 48: "0", 49: "", 51: "7500", 52: "15000" } }], note: "Ability 4: +15% damage against Broken foes (this unit)" },
    // The Girl and the Goliath Rhode ([Electrify] = unique condition 2, its column 4 = max level)
    { unit: "131032", name: "The Girl and the Goliath Rhode", ...P2023, table: LD, key: "131032", lines: [{ line: 0 }, { line: 1, set: { 111: "37500", 112: "50000" } }], note: "Leader: Thunder HP below 50% → +50% attack" },
    { unit: "131032", name: "The Girl and the Goliath Rhode", ...P2023, table: AB, key: "1310322", lines: [{ line: 0, set: { 2: "attack_common", 110: "0", 111: "", 113: "35000", 114: "70000" } }], note: "Ability 2: HP below 50% → +70% attack (this unit)" },
    { unit: "131032", name: "The Girl and the Goliath Rhode", ...P2023, table: AB, key: "1310323", lines: [{ line: 1 }, { line: 2, set: { 102: "3", 113: "10000", 114: "20000" } }, { line: 3, set: { 100: "300000", 101: "300000", 113: "30000", 114: "60000" } }], note: "Ability 3: Leader HP 50%+ skill → Electrify +1 / +20% per level (Max +60%) / level 3+ → +60%" },
    { unit: "131032", name: "The Girl and the Goliath Rhode", ...P2023, table: AB, key: "1310326", lines: [{ copy: "ab:1310323/3", set: { 1: "true", 2: "attack_yellow", 100: "300000", 101: "300000", 113: "20000", 114: "40000" } }], note: "Ability 6: Leader HP below 50% and Electrify 3+ → +40% attack (Thunder)" },
    { unit: "131032", name: "The Girl and the Goliath Rhode", ...P2023, table: "master/character/unique_condition.orderedmap", key: "2", cols: { 4: "3" }, note: "[Electrify] max level 3" },
    // Starflame Eleanor ("the combo reaches" = trigger 12, "the combo count reaches" = 70, as the note words them)
    { unit: "231004", name: "Starflame Eleanor", ...P2023, table: LD, key: "231004", lines: [{ line: 0, set: { 49: "22500", 50: "30000" } }, { copy: "ld:241033/1", set: { 107: "0", 109: "Yellow", 111: "37500", 112: "50000" } }], note: "Leader: +30% attack / combo 10+ → +50% attack (Thunder)" },
    { unit: "231004", name: "Starflame Eleanor", ...P2023, table: AB, key: "2310041", lines: [{ line: 0, set: { 51: "12500", 52: "25000" } }], note: "Ability 1: +25% attack" },
    { unit: "231004", name: "Starflame Eleanor", ...P2023, table: AB, key: "2310042", lines: [{ copy: "ab:1210011/0", set: { 34: "4" } }], note: "Ability 2: combo 30 → +10% attack (Max +40%)" },
    { unit: "231004", name: "Starflame Eleanor", ...P2023, table: AB, key: "2310043", lines: [{ line: 0, set: { 51: "20000", 52: "40000", 57: "60000000", 58: "60000000" } }], note: "Ability 3: skill → 10 s Multihit [2 / +40%]" },
    { unit: "231004", name: "Starflame Eleanor", ...P2023, table: AB, key: "2310044", lines: [{ line: 0, set: { 27: "107", 30: "1000000", 31: "1000000", 51: "100000", 52: "200000" } }, { copy: "ab:1610054/0", set: { 2: "special", 30: "1000000", 31: "1000000", 34: "3", 51: "2500", 52: "5000" } }], note: "Ability 4: every 10 skill hits → +2 combo & +5% attack (Max +15%)" },
    { unit: "231004", name: "Starflame Eleanor", ...P2023, table: AB, key: "2310045", lines: [{ line: 0, set: { 30: "5000000", 31: "5000000", 34: "10", 35: "0" } }], note: "Ability 5: combo count 50 → first 10 times +5% skill gauge" },
    { unit: "231004", name: "Starflame Eleanor", ...P2023, table: AB, key: "2310046", lines: [{ line: 0, set: { 27: "12", 30: "5000000", 31: "5000000", 34: "1", 51: "10000", 52: "20000" } }, { line: 1, set: { 27: "12", 30: "10000000", 31: "10000000", 34: "1", 51: "15000", 52: "30000" } }], note: "Ability 6: combo 50 → +20% / combo 100 → +30% attack (once each)" },
    // Tigerman Nimbus (ability rows 81-86, named in his character row; the 2022 stage gets this row too)
    { unit: "10", name: "Tigerman Nimbus", ...P2023, table: AB, key: "82", lines: [{ line: 0, set: { 2: "power_flip", 30: "500000", 31: "500000", 47: "55", 48: "", 51: "5000", 52: "10000" } }], note: "Ability 2: every 5 Power Flips → +10% Power Flip damage (Max +50%)" },
    // Bubbly Bottomless Pit Pecorine (her rows are 151008 / 151008<n>, named in her character row; her old stats aren't given)
    { unit: "151011", name: "Bubbly Bottomless Pit Pecorine", ...P2023, table: LD, key: "151008", lines: [{ line: 0 }, { line: 1, set: { 111: "41250", 112: "55000" } }], note: "Leader: +50% attack / Light HP 60%+ → +55% attack (Light)" },
    { unit: "151011", name: "Bubbly Bottomless Pit Pecorine", ...P2023, table: AB, key: "1510081", lines: [{ copy: "ab:1210392/0", set: { 2: "defense_common", 30: "3000000", 31: "3000000", 35: "0", 47: "2", 48: "0", 49: "", 51: "10000", 52: "20000", 57: "60000000", 58: "60000000" } }, { copy: "ab:2530013/1", set: { 1: "true", 2: "defense_common", 30: "3000000", 31: "3000000", 34: "10", 48: "0", 49: "" } }], note: "Ability 1: every 30 direct hits → 10 s +20% all resistance & first 10 times heal 4%" },
    { unit: "151011", name: "Bubbly Bottomless Pit Pecorine", ...P2023, table: AB, key: "1510082", lines: [{ line: 1 }, { copy: "ab:1510081/0", set: { 2: "attack_common", 6: "0", 11: "", 113: "20000", 114: "40000" } }], note: "Ability 2: +10% HP / HP 60%+ → +40% attack" },
    { unit: "151011", name: "Bubbly Bottomless Pit Pecorine", ...P2023, table: AB, key: "1510083", lines: [{ line: 0 }, { line: 2, set: { 113: "60000", 114: "120000" } }], note: "Ability 3: skill → Barrier 12% / HP 80%+ → +120% attack" },
    { unit: "151011", name: "Bubbly Bottomless Pit Pecorine", ...P2023, table: AB, key: "1510084", lines: [{ copy: "ab:1110091/0", set: { 51: "7500", 52: "15000", 57: "60000000", 58: "60000000" } }, { copy: "ab:1110091/0", set: { 2: "defense_common", 47: "2", 51: "3750", 52: "7500", 57: "60000000", 58: "60000000" } }], note: "Ability 4: skill → 10 s +15% attack & +7.5% all resistance" },
    // Wandering Blade Mormia
    { unit: "161004", name: "Wandering Blade Mormia", ...P2023, table: LD, key: "161004", lines: [{ line: 0, set: { 49: "30000", 50: "40000" } }, { line: 0, set: { 45: "34", 49: "30000", 50: "40000" } }], note: "Leader: +40% attack & +40% skill damage (Dark)" },
    { unit: "161004", name: "Wandering Blade Mormia", ...P2023, table: AB, key: "1610041", lines: [{ copy: "ab:1310033/0", set: { 1: "true", 51: "10000", 52: "20000" } }, { copy: "ab:1310034/0", set: { 51: "10000", 52: "20000" } }], note: "Ability 1: +20% attack & +20% skill damage" },
    { unit: "161004", name: "Wandering Blade Mormia", ...P2023, table: AB, key: "1610042", lines: [{ line: 0, set: { 113: "10000", 114: "20000" } }], note: "Ability 2: Pierce → 2 direct hits, +20% total damage" },
    { unit: "161004", name: "Wandering Blade Mormia", ...P2023, table: AB, key: "1610043", lines: [{ copy: "ab:1210043/1", set: { 2: "attack_black", 99: "Black", 100: "40000", 101: "40000", 113: "17500", 114: "35000" } }, { copy: "ab:1210043/1", set: { 2: "attack_black", 97: "1", 99: "Black", 100: "60000", 101: "60000", 109: "2", 113: "25000", 114: "50000" } }], note: "Ability 3: Dark HP 40%+ → +35% attack / Dark HP below 60% → +50% skill damage (that unit)" },
    { unit: "161004", name: "Wandering Blade Mormia", ...P2023, table: AB, key: "1610044", lines: [{ copy: "ab:1310322/0", set: { 2: "attack_black", 97: "0", 100: "40000", 101: "40000", 111: "Black", 113: "15000", 114: "30000" } }], note: "Ability 4: HP 40%+ → +30% attack (Dark)" },
    { unit: "161004", name: "Wandering Blade Mormia", ...P2023, table: AB, key: "1610045", lines: [{ copy: "ab:1310322/0", set: { 2: "attack_black", 100: "60000", 101: "60000", 111: "Black", 113: "7500", 114: "15000" } }], note: "Ability 5: HP below 60% → +15% attack (Dark)" },
    { unit: "161004", name: "Wandering Blade Mormia", ...P2023, table: AB, key: "1610046", lines: [{ copy: "ab:2530013/1", set: { 1: "true", 2: "hp_skill", 6: "9", 7: "0", 9: "55000", 10: "55000", 34: "50", 48: "0", 49: "", 51: "1000", 52: "2000" } }], note: "Ability 6: HP below 55%, every 20 direct hits → first 50 times heal 2%" },
    // Marine Nightmare Alice ("Enemies Destroyed: +1" = CountUpEnemyKill 247, which CN's units don't use; CountUpPowerFlip 248 they do)
    { unit: "161008", name: "Marine Nightmare Alice", ...P2023, table: LD, key: "161008", lines: [{ line: 0, set: { 49: "37500", 50: "50000" } }, { line: 1, set: { 49: "7500", 50: "10000" } }], note: "Leader: +50% attack (Dark) / per Dark unit +10% attack (Max +60%)" },
    { unit: "161008", name: "Marine Nightmare Alice", ...P2023, table: AB, key: "1610081", lines: [{ copy: "ab:2110042/0", set: { 30: "400000", 31: "400000", 34: "10" } }], note: "Ability 1: every 4 kills → +10% attack (Max +100%)" },
    { unit: "161008", name: "Marine Nightmare Alice", ...P2023, table: AB, key: "1610082", lines: [{ copy: "ab:2210113/1", set: { 1: "true", 2: "attack_common", 113: "40000", 114: "80000" } }], note: "Ability 2: Barrier → +80% attack" },
    { unit: "161008", name: "Marine Nightmare Alice", ...P2023, table: AB, key: "1610083", lines: [{ copy: "ab:2110042/0", set: { 1: "false", 2: "special", 30: "300000", 31: "300000", 34: "(None)", 47: "247", 48: "", 51: "100000", 52: "100000" } }, { copy: "ab:1310033/0", set: { 51: "30000", 52: "60000" } }], note: "Ability 3: every 3 kills → Enemies Destroyed +1 / +60% attack" },
    ...["1610085", "1610086"].map(key => ({ unit: "161008", name: "Marine Nightmare Alice", ...P2023, table: AB, key, lines: [{ copy: "ab:2110042/0", set: { 30: "400000", 31: "400000", 34: "10", 51: "2000", 52: "4000" } }], note: `Ability ${key.slice(-1)}: every 4 kills → +4% attack (Max +40%)` })),
    // Cat Girl Cosplayer Falsche (Light resistance = effect 41)
    { unit: "261017", name: "Cat Girl Cosplayer Falsche", ...P2023, table: LD, key: "261017", lines: [{ line: 0, set: { 49: "22500", 50: "30000" } }, { line: 0, set: { 45: "41", 47: "(None)", 49: "15000", 50: "20000" } }], note: "Leader: +30% attack (Dark) / +20% Light resistance (party)" },
    { unit: "261017", name: "Cat Girl Cosplayer Falsche", ...P2023, table: AB, key: "2610171", lines: [{ copy: "ab:1310033/0", set: { 1: "true", 2: "attack_black", 48: "5", 49: "Black", 51: "5000", 52: "10000" } }, { copy: "ab:1310033/0", set: { 1: "true", 2: "attack_black", 47: "41", 48: "5", 49: "Black", 51: "5000", 52: "10000" } }], note: "Ability 1: +10% attack & +10% Light resistance (Dark)" },
    { unit: "261017", name: "Cat Girl Cosplayer Falsche", ...P2023, table: AB, key: "2610172", lines: [{ copy: "ab:1310033/0", set: { 1: "true", 2: "defense_black", 47: "41", 51: "5000", 52: "10000" } }, { copy: "ab:2610173/1", set: { 1: "true", 2: "defense_black", 34: "3", 47: "206", 51: "5000", 52: "10000" } }], note: "Ability 2: +10% Light resistance / another Dark unit becomes a coffin → first 3 times heal 10%" },
    { unit: "261017", name: "Cat Girl Cosplayer Falsche", ...P2023, table: AB, key: "2610173", lines: [{ line: 0 }, { line: 1 }], note: "Ability 3: without the resurrection heal line" },
    { unit: "261017", name: "Cat Girl Cosplayer Falsche", ...P2023, table: AB, key: "2610174", lines: [{ copy: "ab:1310033/0", set: { 1: "true", 2: "defense_black", 47: "41", 51: "5000", 52: "10000" } }], note: "Ability 4: +10% Light resistance" },
    { unit: "261017", name: "Cat Girl Cosplayer Falsche", ...P2023, table: AB, key: "2610176", lines: [{ copy: "ab:2610171/1", set: { 2: "defense_black", 28: "6", 30: "500000", 31: "500000", 34: "1", 47: "41", 51: "5000", 52: "10000" } }], note: "Ability 6: every 5 resurrections of another Dark unit → +10% Light resistance (Dark, Max +10%)" },
    // Ingenue of Ruin Arum
    { unit: "261001", name: "Ingenue of Ruin Arum", ...P2023, table: LD, key: "261001", lines: [{ copy: "ld:151008/1", set: { 95: "1", 97: "Black", 98: "50000", 99: "50000", 111: "82500", 112: "110000" } }], note: "Leader: Dark HP below 50% → +110% attack (that unit)" },
    { unit: "261001", name: "Ingenue of Ruin Arum", ...P2023, table: AB, key: "2610011", lines: [{ copy: "ab:1311582/1", set: { 2: "attack_common", 6: "0", 11: "", 51: "20000", 52: "20000" } }, { copy: "ab:1310033/0", set: { 1: "true", 51: "17500", 52: "35000" } }], note: "Ability 1: battle start → 20% max HP damage to self & +35% attack" },
    { unit: "261001", name: "Ingenue of Ruin Arum", ...P2023, table: AB, key: "2610012", lines: [{ copy: "ab:1310322/0", set: { 2: "attack_common", 110: "0", 111: "", 113: "25000", 114: "50000" } }], note: "Ability 2: HP below 50% → +50% attack" },
    { unit: "261001", name: "Ingenue of Ruin Arum", ...P2023, table: AB, key: "2610013", lines: [{ copy: "ab:1310322/0", set: { 1: "false", 2: "attack_common", 110: "0", 111: "", 113: "40000", 114: "80000" } }, { copy: "ab:1310322/0", set: { 1: "false", 2: "attack_common", 110: "8", 111: "", 113: "12500", 114: "25000" } }], note: "Ability 3: HP below 50% → +80% attack & +25% attack for Multiballs" },
    { unit: "261001", name: "Ingenue of Ruin Arum", ...P2023, table: AB, key: "2610014", lines: [{ copy: "ab:2610174/0" }], note: "Ability 4: battle start → +35% skill gauge" },
    { unit: "261001", name: "Ingenue of Ruin Arum", ...P2023, table: AB, key: "2610015", lines: [{ copy: "ab:1310322/0", set: { 2: "attack_common", 110: "0", 111: "", 113: "20000", 114: "40000" } }], note: "Ability 5: HP below 50% → +40% attack" },
    { unit: "261001", name: "Ingenue of Ruin Arum", ...P2023, table: AB, key: "2610016", lines: [{ copy: "ab:1610273/0", set: { 1: "true", 113: "20000", 114: "40000" } }, { copy: "ab:1610273/1", set: { 1: "true", 113: "20000", 114: "40000" } }], note: "Ability 6: party HP below 80% → +40% / below 50% → +40% attack" },
    // 2024-05-27 rows whose old values replaced a fixed value
    { unit: "131098", name: "Lavender Widow Mayuzuki", ...P2024, table: AB, key: "1310983", set: { 2: { 113: "60000", 114: "120000" } }, note: "Ability 3: old values from the game files" },
    { unit: "161027", name: "Hope in the Darkness Adjudicus", ...P2024, table: AB, key: "1610273", set: { 1: { 113: "87500", 114: "175000" } }, note: "Ability 3: old values from the game files" },
]

const stagesOf = kit => kit === undefined ? [] : Array.isArray(kit.stages) ? kit.stages : kit.rows ? [{ until: kit.until, source: kit.source, rows: kit.rows }] : []

;(async () => {
    const tables = { [AB]: await readCnTable(AB), [LD]: await readCnTable(LD), [SOUL]: await readCnTable(SOUL) }
    const only = process.argv.includes("--units") ? new Set(process.argv[process.argv.indexOf("--units") + 1].split(",")) : null
    const lineOf = (from, layout) => {
        const [, t, key, n] = from.match(/^(ab|ld):(.+)\/(\d+)$/) ?? []
        const text = t && tables[t === "ab" ? AB : LD][key]
        if (text === undefined) return null
        const c = R.splitCsv(R.splitCsvLines(String(text).replace(/\n$/, ""))[Number(n)] ?? "")
        if (c.length < 2) return null
        const src = t === "ab" ? AB : LD
        if (src === layout) return c
        return layout === LD ? [c[0], ...c.slice(3)] : [c[0], "", "", ...c.slice(1)]
    }
    const kits = fs.existsSync(KIT_FILE) ? JSON.parse(fs.readFileSync(KIT_FILE, "utf8")) : {}
    const problems = []
    for (const e of EDITS) {
        if (only && !only.has(e.unit)) continue
        const ref = `${e.table}#${e.key}`
        const kit = kits[e.unit] ?? { name: e.name }
        const stages = stagesOf(kit)
        const here = stages.find(s => s.until === e.until)
        const later = stages.filter(s => s.until > e.until).sort((a, b) => a.until.localeCompare(b.until))[0]
        let text
        if (e.cols) text = { cols: e.cols } // some columns of the first line, on whatever text the game has (translated names stay)
        else {
            // a "lines" edit always starts from the row before this patch (the next stage's or CN's), so it can be re-run
            const start = !e.lines && typeof here?.rows[ref] === "string" ? here.rows[ref] : typeof later?.rows[ref] === "string" ? later.rows[ref] : tables[e.table][e.key]
            if (start === undefined) { problems.push(`${e.name}: no row ${e.key}`); continue }
            let lines = R.splitCsvLines(String(start).replace(/\n$/, "")).map(l => R.splitCsv(l))
            if (e.lines) {
                const own = lines[0][0]
                const made = e.lines.map(spec => {
                    const c = spec.copy ? lineOf(spec.copy, e.table) : lines[spec.line] ? [...lines[spec.line]] : null
                    if (!c) { problems.push(`${e.name}: no line ${spec.copy ?? spec.line}`); return null }
                    if (spec.copy) c[0] = own
                    for (const [col, v] of Object.entries(spec.set ?? {})) c[col] = v
                    return c
                })
                if (made.includes(null)) continue
                lines = made
            }
            for (const [n, cols] of Object.entries(e.set ?? {})) {
                if (!lines[n]) { problems.push(`${e.name}: no line ${n}`); continue }
                for (const [c, v] of Object.entries(cols)) lines[n][c] = v
            }
            text = lines.filter((_, i) => !(e.drop ?? []).includes(i)).map(l => l.map(R.csvField).join(",")).join("\n")
        }
        // into this patch's stage (made with the next stage's rows if new), and the earlier stages lacking it
        let stage = here
        if (!stage) { stage = { until: e.until, source: e.source, rows: { ...(later?.rows ?? {}) } }; stages.push(stage) }
        const old = stage.rows[ref]
        stage.rows[ref] = text
        // earlier stages without the row, or with this stage's old copy of it (a re-run), get it too
        for (const s of stages) if (s.until < e.until && (s.rows[ref] === undefined || (old !== undefined && s.rows[ref] === old))) s.rows[ref] = text
        stages.sort((a, b) => a.until.localeCompare(b.until))
        kits[e.unit] = { name: kit.name ?? e.name, stages }
        console.log(`${e.name}: ${e.note}`)
    }
    for (const p of problems) console.log("  problem: " + p)
    if (process.argv.includes("--write")) { fs.writeFileSync(KIT_FILE, JSON.stringify(kits, null, 1) + "\n"); console.log("written " + KIT_FILE) }
})()
