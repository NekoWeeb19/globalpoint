# Making custom units

How to make a custom unit for the CN app, change an existing one by hand, and what the server and the
build do with them. Getting a finished unit into the game, giving it and removing it is in
[CUSTOM_UNITS.md](CUSTOM_UNITS.md). For abilities and numbers, the dashboard's
[Unit editor](UNIT_EDITOR.md) is easier than editing files by hand.

A custom unit has two parts:

| Part | Where | Shipped by |
|---|---|---|
| **Rows** (the unit's lines in 19 game tables) and **server data** (character entry, Mana Boards, summon pools) | one JSON file, `assets/custom_units/<id>.json` | every CN schedule build (`scripts/gen_cn_event_schedule.cjs`) adds the rows to the tables it ships; the server reads the file at start |
| **Files** (art, voices, animations, skill scripts) | an art update, `1.4.9xx` | `scripts/build_cn_patch.cjs`, once |

Because the schedule build adds the rows itself, every rebuild (a dashboard schedule edit, a clock change, a
kit date) keeps the unit. Before this, a rebuild shipped CN's own tables without the unit's rows, and a save
holding it hit C8601.

## Changing an existing unit by hand

Custom unit files are only for new units: a file that uses a CN unit's id or string id is refused. The
[Unit editor](UNIT_EDITOR.md) covers abilities, leader skill, stats, skill gauge, name and class. For
anything else, use one of these; both last through every schedule rebuild.

### Other rows: a change file by hand

The editor saves change files, and you can write one yourself for rows it doesn't edit (another of the
[19 tables](research/new-units.md#the-tables-19), e.g. a picture's crop rows). Put it in
`assets/custom_units/changes/` (any name ending in `.json`):

```json
{ "111069": { "name": "Haruhi: my changes", "rows": {
    "upload/5c/6a4f0e2ceb1dbcf60f9b306b0f7bfd0eca55c9#111069/80": { "cols": { "0": 3000 } },
    "master/ability/ability.orderedmap#1110691": "<the whole row>" } } }
```

- A row is named `<table>#<row key>`. The table is a logical name or a stored path (`upload/5c/6a4f…`), and nested
  keys join with `/` (stats are `<id>/<level>`). The value is the whole row, or `{ "cols": { … } }` for some columns
  of its first line. The [column appendix](research/new-units.md#appendix-the-19-tables-column-by-column) lists every
  table and column.
- Restart the server to rebuild; the log says `Unit changes: N of N row(s) in <table>` (fewer found than listed
  means a row name doesn't exist). Changes apply on top of the game's rows and of
  [Balance by date](DETAILS.md#balance-by-date); for the same row, the file whose name sorts last wins.
- Phones get change files with **Download from PC**, whatever is ticked. The copy makes the phone's change files
  match the PC's, so a file deleted on the PC goes away on the phone too.
- Element, rarity and Mana Board costs also live in the server's own data (`assets/character.json`,
  `assets/mana_node.json`): change those to match if you change them in the rows.

### Its pictures, voices and animations: an art update

An update can carry a file under the same name as the game's own; the newest copy wins (StarPoint's translation
and art updates replace CN files this way). Make a files list with the unit's existing file names and your new
files, and build it like a custom unit's art update:

```json
[{ "path": "production/medium_upload/ab/cdef…", "from": "D:/my art/square_0.png" }]
```
```bash
node scripts/build_cn_patch.cjs 1.4.950 <newest version> my_art.json
```

- `scripts/research/unit_files.cjs <id>` lists the unit's files by logical path. The stored name is
  `uploadPath(<logical path>, <folder>)` from `scripts/cdn_hash.cjs`, in the same folder (`upload`,
  `medium_upload` or `android_upload`) the game's copy is in. `clone_cn_unit.cjs` shows how to look the folder up.
- Keep the formats and sizes (see [the files](research/new-units.md#3-files-76-most-players-never-see-the-folder-names)).
  An animation's sprite sheet, `.atlas` and `.frame` files must match each other, and a picture of another shape
  may need its crop rows (`trimmed_image`, `character_image`) changed too, with a change file above.
- Phones get it like any game update: **Download from PC** with **Game updates** ticked.

## Adding a unit (details)

1. **Make the unit**: a unit file (format in [The unit file](#the-unit-file)) plus its files. Nothing after this
   step cares how they were made. Two ways:

   **a. Copy an existing CN unit** under a new id and string id with the clone script. Set `SRC` (the unit to
   copy: any CN unit, Haruhi 111069 is only the default) and `NEW` at the top of
   `scripts/research/clone_cn_unit.cjs`:

   ```bash
   node scripts/research/unit_files.cjs <SRC id> > files.txt
   ```
   ```bash
   node scripts/research/clone_cn_unit.cjs out --files files.txt
   ```

   It writes `out/custom_unit.json` (the unit file), `out/art_files.json` (its files, no tables) and the files.
   (`out/files.json` is the old one-off test patch with the tables in it; don't ship that for a kept unit.)
   A copy is also a good starting point for a new unit: change its abilities, stats and name in the
   [Unit editor](UNIT_EDITOR.md) (it edits custom units too), and replace its files.

   **b. Make one by hand (or with your own tool).** You need:
   - **The unit file** with its rows in the 19 tables. The tables, and every column with the client's names,
     are in the research doc's [checklist](research/new-units.md#checklist-everything-a-custom-unit-needs) and
     [column appendix](research/new-units.md#appendix-the-19-tables-column-by-column). Every row must
     use the new id and string id. The Mana Board node ids follow the rule below, in both `manaNodes` and the
     `mana_node` rows, and `character` must match the character row's rarity.
   - **The files**, under `character/<string id>/...` with the names and formats the research doc lists
     ([checklist, part 3](research/new-units.md#3-files-76-most-players-never-see-the-folder-names): pictures at their fixed sizes, AMF3 `.atlas`/`.frame`/`.timeline` that name the new folder inside, MP3
     voices, the skill script and preview `.battle` files). Each is stored under its hashed name
     (`scripts/cdn_hash.cjs` `uploadPath(<logical path>, <folder>)`), in the folder the game reads it from
     (`upload`, `medium_upload` or `android_upload`; the doc says which).
   - **`art_files.json`** for the art update: `[{ "path": "production/<folder>/ab/cdef…", "from": "<file on this PC>" }, …]`,
     and the same paths in the unit file's `art.files`.

   What the game can do is fixed: abilities, leader talents and skills must be built from kinds and commands
   the game already has (new numbers and combinations are fine; new mechanics are not). Mistakes show up
   clearly: the build and the server name a bad id or node id, a missing file shows as the asset recovery
   screen with its path in `logs/cn_requests.log`, and a bad row as C8601 (see
   [Troubleshooting](CUSTOM_UNITS.md#troubleshooting)). Every unit tested so far is a copy of Haruhi; a hand-made one hasn't
   been tried yet.
2. **Build its art update**, numbered well above the schedule builds (StarPoint's art updates are 1.4.500,
   600, 700 and 800 so far; custom units use 1.4.9xx, and a phone builds its own schedule numbers):

   ```bash
   node scripts/build_cn_patch.cjs 1.4.900 <last version in .cdn/cn_patches/patches.json> out/art_files.json
   ```

   Put the number in the unit file's `art.patch` so the build can name it when the files are missing.
3. **Add the unit file**: copy `out/custom_unit.json` to `assets/custom_units/<id>.json`. Optionally list
   summon banners in `banners` (see below).
4. **Rebuild the CN schedule** (dashboard: any schedule save; or `npx tsc && node scripts/gen_cn_event_schedule.cjs`).
   The server also rebuilds on start when a unit file was added or changed (it's part of the schedule
   fingerprint, `scripts/schedule_fingerprint.cjs`). The log says
   `Custom units: 111907 Haruhi (GP Test) (1 of 1, rows in 19 tables)`.
5. **Restart the server** so it reads the unit (log: `[custom units] 111907 Haruhi (GP Test)`). Then Give
   works from the dashboard, Mana Board unlocks are accepted, and the listed banners can drop it.

### On a phone (companion app)

Custom units are never put in the APK, data packs or OBBs. Add them on your PC (steps above), then on the
phone use **Download from PC** with **Game updates** ticked:

- The unit files always come along (whatever is ticked) into `files/data/.cdn/custom_units/`, the phone
  server's `CUSTOM_UNITS_DIR`. That folder survives companion updates and save imports.
- **Game updates** brings the unit's art update (an ordinary game update).
- When the server starts again it sees the new units and rebuilds its own schedule with them; the game
  downloads that update at its next start.
- **Removing a unit**: delete its file on the PC, then copy again: the phone deletes unit files the PC no
  longer has. (Mind the warning below about saves that hold it.)

If the unit files arrive before the art (Game updates not ticked), the phone's build leaves the unit out
and rebuilds by itself once a newer game update is on its list.

## The unit file

```jsonc
{
  "id": "111907",                 // 6 digits, not a CN id; first digit = 6 − rarity (1 = 5★) if it's in a banner
  "dev": "gp_test_haruhi",        // the string id: the folder of all its files, not used by CN
  "name": "Haruhi (GP Test)",     // for logs only (the game's name is in the character_text row)
  "character": { "name": "", "rarity": 5, "element": 0, "skill_count": 6, "cn": true },  // = assets/character.json entry
  "manaNodes": { "1": { "223814201": { "items": {…}, "manaCost": 0, … } }, "2": {…} },  // = mana_node_cn.json boards
  "banners": ["1613"],            // optional: summon banners whose pool gets the unit
  "art": { "patch": "1.4.900", "files": ["production/medium_upload/ab/cd…", …] },
  "rows": {
    "upload/2d/5cb9b28d18f984a51b345a4d7aab03d77bddfc": { "111907": "gp_test_haruhi,…" },
    "upload/5c/6a4f0e2ceb1dbcf60f9b306b0f7bfd0eca55c9": { "111907": { "1": "…", "10": "…", "80": "…", "100": "…" } },
    …
  }
}
```

- **Tables** are named by stored path (`upload/xx/…`, as most CN tables have no known logical name) or by
  logical name (`master/character/character.orderedmap`). Rows nest like the table: a string is a row, an
  object is a map of rows. The rows are added at the end of the table (the game looks rows up by key);
  a row with the same key is replaced.
- **Id**: the game reads rarity and element from the character row, not the id (CN itself has 700000-700019 and
  999999). Only StarPoint's summon uses the first digit (★ = 6 − digit), so a unit listed in `banners` must start
  with the digit of its rarity. The second digit (1 fire … 6 dark) is just the usual convention.
- **Mana Board node ids** must be `unit × 2000 + board × 200 + index` (the game finds a node's row from its
  id). Files that break this are refused, in `manaNodes` and in the `mana_node` table's rows.
- **Summon pools**: the unit goes into each listed banner's tier of its rarity at the tier's average weight,
  and the others are scaled down so the tier still sums to the same total. The banner's Rates screen
  won't list it (that's CN's odds table).
- A worked example (the research test unit, not active): [examples/custom_units/111907.json](examples/custom_units/111907.json).

## What the build checks

The schedule build leaves a unit out (and says why in its log) when:

- its id or string id is a CN unit's;
- any file in `art.files` isn't in the CN files or StarPoint's updates yet (the game would stop with
  "Insufficient data" when it reads one). Build the art update first, then rebuild;
- the file has a problem (bad JSON, bad id, Mana Board ids off the rule).

The units it shipped are listed in `.database/cn_schedule_built.json` (`customUnits`); the ones still waiting
for their files are in `customWaitingForFiles`, and the server rebuilds on start once a newer game update is
listed (e.g. their art update was built or copied in).

Things to know:

- **Taking a unit away**: the tables keep its rows on devices that have them, until a later update ships
  those tables without them. Don't remove a unit a save still holds: the server would no longer know it.
- **Don't Give a unit before its rows are on the device** (art update + schedule rebuild installed): the
  game would hit C8601 and drop the table until the next update.
- A translation update ships whole tables without the unit's rows, so rebuild the schedule after one (the
  usual rule for translation updates).

## Tested (2026-11-03, emulator, companion server)

The research test unit 111907 moved to a custom unit file on the emulator that already had it (save at Lv 100,
Mana Boards 1+2 complete). Its rows and server entries were taken out of the bundled `character.json`,
`mana_node_cn.json` and `gacha.json`, so the server only knew it from `assets/custom_units/111907.json`.
- The server logged `[custom units] 111907 Haruhi (GP Test)` and rebuilt the schedule on start by itself (fingerprint).
- The phone's own build 1.4.955 had all 19 tables with the rows; the Mana Board 2 date was moved to 2015 because
  the save uses board 2 (the usual keep-open fix).
- The game took the 7 MB update. The save loaded with no C8601. The home screen showed the unit, and so did the
  detail page (Lv 100, uncap 4) and Mana Board 2 (complete). No crash reports.
- Dashboard Give (`/api/server/give`) → mail → claim: the unit-obtained scene and its Fire EX Boost item.

Then with companion 0.6.24 (same emulator, 2026-11-03; 0.6.24 was a test build only, and its changes ship in companion 0.7.0):
- Installed over 0.6.23 with the unit file moved to `files/data/.cdn/custom_units/` first: the server found it there
  and rebuilt by itself (1.4.957).
- **Download from PC** from a PC server running this code, with nothing ticked: the unit file, a change file
  (`changes/`, Lv 100 stats of 111907) and the index arrived; after **Start** the phone rebuilt (1.4.958), and in the
  game Lv 100 HP/ATK went from 4038/1023 to 11799/1239. With the change file deleted on the PC, the next copy
  deleted it on the phone, the rebuild (1.4.959) shipped the game's own rows, and the stats were back to 4038/1023.
- **Remove a unit** on 111907 (the leader of the selected party): the first version emptied the leader slot and the
  game stopped with C2330 ("the leader can't be empty"); fixed (the hero takes the slot), and the save then loaded
  with Alk leading that party. The save was put back afterwards.
- Seen on the way: after a copy the server stays stopped until **Start** is pressed, although the copy screen says
  it starts by itself (not caused by this change).

Not tested: a summon from a listed banner after the merge, battles after the rebuild (same rows as the research
test), a real phone.

## Code

- `scripts/custom_units.cjs`: reads and checks unit files, adds rows to a table, adds units to summon pools.
- `scripts/gen_cn_event_schedule.cjs`: ships every table a unit touches, with its rows.
- `src/lib/assets.ts`: merges the units into the character, Mana Board and summon data at start.
- `scripts/test_custom_units.mjs` (`npm test`): offline test.
- `CUSTOM_UNITS_DIR` (relative to the repo folder) points at another folder of unit files, e.g. for tests.
  The phone companion sets it to `files/data/.cdn/custom_units` (`companion/server/companion-main.js`).
- `src/routes/companion.ts` sends the PC's unit files with every Wi-Fi copy; the phone app
  (`DataTransfer.java`) always fetches them and removes the ones the PC dropped.
