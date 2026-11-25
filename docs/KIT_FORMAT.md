# Kit file format

> 中文版：[zh-CN/KIT_FORMAT.md](zh-CN/KIT_FORMAT.md)

A **kit** is the file the dashboard's Unit editor makes when you download edited units or armaments
([UNIT_EDITOR.md](UNIT_EDITOR.md)). This page describes the file itself, so another CN World Flipper server or fork can
read one and put the same changes into its own game update. How a fork ships the result to the game is up to that fork;
everything the kit needs to describe the change is in the file.

A kit is plain JSON (UTF-8). It holds only what was changed in the editor, as rows of the game's own tables, named the
way the game names them. It doesn't depend on GlobalPoint's database, update numbers, hashed file names or other files.

## The whole file

```json
{
 "_format": "globalpoint-unit-kits",
 "_note": "Unit editor kits (GlobalPoint). ...",
 "111051": {
  "name": "Unit editor: Zeta",
  "rows": {
   "master/skill/action_skill.orderedmap#zeta/1": { "cols": { "0": "New skill name", "1": "First line\nSecond line", "7": "battle/action/skill/action/custom/111051_1_10d24bbbf1" } },
   "master/character/character_status.orderedmap#111051/80": "3000,620",
   "master/ability/ability.orderedmap#1110511": "<the whole row>",
   "master/ability/ability.orderedmap#1110512": "<the whole row>"
  },
  "scripts": {
   "battle/action/skill/action/custom/111051_1_10d24bbbf1": "<base64>"
  }
 }
}
```

- **`_format`**: `globalpoint-unit-kits` (units) or `globalpoint-armament-kits` (armaments). Keys starting with `_`
  aren't entries; ignore them.
- **Every other key** is a CN unit id or armament id, as a string (key order doesn't matter: JSON puts number-like
  keys first). Its entry has:
  - **`name`** (optional): a label for people. It isn't game data.
  - **`rows`**: the changed rows (below).
  - **`scripts`** (units only, optional): edited skill scripts the rows point at (below).

One file can hold many entries. The same layout is GlobalPoint's "change file" format, so a kit also works dropped into
GlobalPoint's `custom_units/changes/` folder. (Importing a kit on GlobalPoint's dashboard replaces that unit's earlier
editor changes with the kit's; it doesn't merge them.)

**Encoding:** write the file as UTF-8 **without a byte-order mark (BOM)**. Some Windows editors (Notepad's "UTF-8 with
BOM", PowerShell 5's `Out-File`) add one, and a strict JSON parser such as Node's `JSON.parse` rejects the file.
GlobalPoint's dashboard import accepts a BOM and UTF-16 anyway (it strips them before reading), but a kit with a BOM
dropped straight into `custom_units/changes/` is reported as a broken file and skipped. A reader on another fork may
want to strip a leading BOM itself, to be safe.

## Rows

Each key of `rows` is `<table>#<row key>`:

- **`<table>`** is the game's logical table name, e.g. `master/ability/ability.orderedmap`. Some older GlobalPoint change
  files use the stored name instead (`upload/5c/6a4f...`, `production/upload/...`); a reader can turn a logical name
  into the stored one with the rule under [File names](#file-names).
- **`<row key>`** is the key the game looks the row up by. Tables with rows inside rows (an "orderedmap" of
  orderedmaps) join the keys with `/`: `111051/80` is row `80` inside row `111051`.

Each value is one of two things:

- **A string: the whole row**, replacing the row's text. A row is CSV text and may have several lines (separated by
  `\n`); an ability row has one line per ability line. The kit leaves off the trailing newline that the stored row
  usually ends with. Keep the stored row's own trailing newline when you write it back.
- **`{ "cols": { "<index>": value } }`: some columns** of the row's **first line**, numbered from 0. Every other column
  and line stays as the fork has it. Values are strings (an older file may have numbers: treat them as their text).

CSV rules (the game's): fields are separated by `,`. A field containing `,`, `"`, a line break or a carriage return is
wrapped in `"`, with `"` inside written as `""`. So a description with a line break, set through `cols`, becomes a
quoted field when written into the row.

The row must already exist in the fork's table. Kits only change rows; they never add new ones.

### What the Unit editor writes

`<id>` is the unit id. `<skill>` is the unit's skill name: column 8 of its `master/character/character.orderedmap` row
(e.g. `wind_spgirl`).

| Table | Row key | Written as | What |
|---|---|---|---|
| `master/ability/ability.orderedmap` | `<id>1` … `<id>6` | whole row | Abilities 1-6, one CSV line per ability line (at most 8 lines). |
| `master/ability/leader_ability.orderedmap` | `<id>` | whole row | Leader skill, one line per line (at most 8). |
| `master/character/character_status.orderedmap` | `<id>/1`, `<id>/10`, `<id>/80`, `<id>/100` | whole row | `hp,atk` at that level. |
| `master/skill/action_skill.orderedmap` | `<skill>/1` (Skill), `<skill>/2` (Skill+) | `cols` | 0 name, 1 description (may have line breaks), 4 skill gauge at skill level 1, 5 skill gauge at the top skill level, 7 the skill script's path. |
| `master/character/character_text.orderedmap` | `<id>` | `cols` | 0 name, 2 description, 3 title. |
| `master/character/character.orderedmap` | `<id>` | `cols` | 6 class, 18 leader skill name, 26 role. |

Class values: 0 Swordsman, 1 Fighter, 2 Deadeye, 3 Support, 4 Special. Role values are the words the game uses:
Attacker, Tank, Healer, Supporter, Jammer, Balance. Ability and leader rows are copied as the editor built them, in the
client's own column layout (numbers as the table stores them: percentages and the like × 100,000); a reader doesn't need to understand them to
apply them. The trigger columns are described in [research/ability-triggers.md](research/ability-triggers.md), and
GlobalPoint's editor reads the full layout from `assets/unit_editor/ability_codes.json`. A leader row is the ability
layout without its columns 1 and 2.

### What the Armament editor writes

`<id>` is the armament id.

| Table | Row key | Written as | What |
|---|---|---|---|
| `master/item/equipment.orderedmap` | `<id>` | `cols` | 1 name, 7 description. |
| `master/item/equipment_status.orderedmap` | `<id>/<level>` | whole row | `hp,atk` at that armament level (the levels the table lists). |
| `master/ability/ability_soul.orderedmap` | `<id>` | whole row | One line per effect version: slot (0-9), learn level, then the unit ability layout from its column 5 (kind) on. |

## Skill scripts

When the Skill tab changed what a skill does, column 7 of its `action_skill` row points at a new script:

```
battle/action/skill/action/custom/<unit id>_<1 for Skill, 2 for Skill+>_<10 hex digits>
```

The script file is in the entry's `scripts`, keyed by that path, as **base64 of the file exactly as the game stores
it**: the skill program in AMF3, raw-deflated (no zlib header), the same format as CN's own
`*.action.dsl.amf3.deflate` files.

To use it, put the decoded bytes in the game update as the file **`<path>.action.dsl.amf3.deflate`**, stored under
its hashed name in the `upload` folder (see below). If column 7 points at a script the update doesn't carry, the game
can't find the file (it opens its asset recovery screen), so ship both or neither.

A script path only ever belongs to the unit in its name. GlobalPoint's importer refuses a script whose path names
another unit, and checks that the game can read the script.

## File names

The game stores every file under a hash of its logical path (same rule in global and CN):

```
production/<folder>/<first 2 hex digits>/<other 38 hex digits>
hash = SHA1(<logical path> + "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy")
```

Tables and skill scripts use the folder `upload`. For example, `master/ability/ability.orderedmap` is stored at
`production/upload/` + the hash of that text. GlobalPoint's copy of this rule is `scripts/cdn_hash.cjs`.

## Applying a kit

For each entry, and each row in it:

1. Find the table (logical name → stored file), decode it, and find the row by its key (`/` = one level deeper).
2. Whole row: replace the row's text, keeping its trailing newline if it had one.
   `cols`: split the row into CSV lines, split the first line into fields, set each listed column, join it again with
   the CSV rules above, and keep the other lines as they were.
3. Write the table back and add it to the game update. Add any skill scripts the rows point at (above).

When several kits change the same row, apply them in a fixed order; the later one wins for whole rows and for the
same column. GlobalPoint applies change files sorted by file name.

GlobalPoint's own code for this: `scripts/custom_units.cjs` (`readUnitChanges`) reads the files, and
`scripts/gen_cn_event_schedule.cjs` (`replaceRows`, and the "skill scripts" step) writes the tables and scripts into
the update. Table decoding and encoding is `scripts/cdn_rows.cjs`.

## Things to know

- **CN data only.** Ids, tables and columns are those of the final CN client (1.8.1). Every CN fork uses that client,
  so the layout matches. Global's tables differ; a kit isn't meant for them.
- **CN units and armaments only.** GlobalPoint's importer refuses an id that isn't in CN's tables. Edits to a
  GlobalPoint custom unit (one made from data) are saved in that unit's own file and never go into a kit.
- **Text is whatever was typed.** The editor fills its boxes from GlobalPoint's English tables, so most kits carry
  English names and descriptions, but any text works. How it looks depends on the game's fonts: the CN client draws
  Chinese, and Japanese kana should work; other scripts (Korean, emoji) may not show.
- **Whole rows replace the fork's own row.** If the fork changed the same ability or leader row itself, the kit's row
  replaces it. Column changes only touch their columns.
- **The game update is enough** for everything a kit changes, as far as GlobalPoint knows: its server keeps no copy of
  armament stats or abilities. A fork whose server keeps its own copy of a value (e.g. unit stats for a power number)
  may want to apply the change there too.
