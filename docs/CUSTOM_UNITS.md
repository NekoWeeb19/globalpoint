# Custom units (CN app)

New units for the CN app, made from game data and files only (no game-code change). How they were found
to work is in [research/new-units.md](research/new-units.md). This page is how to keep one for good.

A custom unit has two parts:

| Part | Where | Shipped by |
|---|---|---|
| **Rows** (the unit's lines in 19 game tables) and **server data** (character entry, Mana Boards, summon pools) | one JSON file, `assets/custom_units/<id>.json` | every CN schedule build (`scripts/gen_cn_event_schedule.cjs`) adds the rows to the tables it ships; the server reads the file at start |
| **Files** (art, voices, animations, skill scripts) | an art update, `1.4.9xx` | `scripts/build_cn_patch.cjs`, once |

Because the schedule build adds the rows itself, every rebuild (a dashboard schedule edit, a clock change, a
kit date) keeps the unit. Before this, a rebuild shipped CN's own tables without the unit's rows, and a save
holding it hit C8601.

## Adding a unit

1. **Make the unit.** Today the only maker is the clone script (a copy of an existing unit under a new id and
   string id; edit `SRC`/`NEW` at its top):

   ```bash
   node scripts/research/unit_files.cjs 111069 > files.txt
   ```
   ```bash
   node scripts/research/clone_cn_unit.cjs out --files files.txt
   ```

   It writes `out/custom_unit.json` (the unit file) and `out/art_files.json` (its files, no tables).
   (`out/files.json` is the old one-off test patch with the tables in it; don't ship that for a kept unit.)
2. **Build its art update**, numbered well above the schedule builds (memory rule: art patches are
   1.4.500, 600, 700, 800 so far; custom units use 1.4.9xx, and a phone builds its own schedule numbers):

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

Phones: the companion runs the same server and schedule build. Copy the unit file into its server assets and the
art update into its game updates (a Wi-Fi copy with "Game updates" ticked), then rebuild there.

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

The units it shipped are listed in `.database/cn_schedule_built.json` (`customUnits`).

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

Not tested: a summon from a listed banner after the merge, battles after the rebuild (same rows as the research
test), a real phone.

## Code

- `scripts/custom_units.cjs`: reads and checks unit files, adds rows to a table, adds units to summon pools.
- `scripts/gen_cn_event_schedule.cjs`: ships every table a unit touches, with its rows.
- `src/lib/assets.ts`: merges the units into the character, Mana Board and summon data at start.
- `scripts/test_custom_units.mjs` (`npm test`): offline test.
- `CUSTOM_UNITS_DIR` (relative to the repo folder) points at another folder of unit files, e.g. for tests.
