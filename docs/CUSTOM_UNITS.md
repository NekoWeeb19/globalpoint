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

## Getting a custom unit onto your device (or emulator)

This part is for players. Setups A–D are the ones in the README's
[Ways to play](../README.md#ways-to-play).

**What you need:** a unit, as the unit maker (`scripts/research/clone_cn_unit.cjs`) writes it: a folder with
`custom_unit.json` (the unit file), `art_files.json` and the unit's pictures and voices. Custom units never
come inside the APKs, the data zip or the OBB: you add them yourself, on a PC.

### On a PC (setup A, and setup D)

In setup D the phone plays against your PC's server, so these steps are all it needs too.

1. **Stop the server.**
2. **Build the unit's art update** (once per unit). In the GlobalPoint folder:
   ```bash
   node scripts/build_cn_patch.cjs 1.4.900 <newest version> <unit folder>/art_files.json
   ```
   `<newest version>` is the last `"version"` in `.cdn/cn_patches/patches.json`. Pick a number for the new
   update well above it and above the game's own version (the **ResVer** on the title screen), e.g. 50
   higher. Phones build their own updates with the next numbers, so leave room. Write the number into the unit
   file's `"art": { "patch": … }` so messages can name it.
3. **Add the unit file:** copy `custom_unit.json` to `assets/custom_units/<id>.json` (e.g. `111907.json`).
4. **Start the server.** It sees the new unit and rebuilds the game update by itself. The log says:
   - `[custom units] 111907 Haruhi (GP Test)`: the server knows the unit;
   - `Custom units: 111907 Haruhi (GP Test) (1 of 1, rows in 19 tables)`: the game update has it.

   If it says `Custom unit 111907 skipped: … files aren't in the game files yet`, the art update from step 2
   is missing.
5. **Open the game.** It downloads a small update at the title screen. Then give or summon the unit (below).

### On a phone, copying from your PC (setup B)

1. Do the PC steps above first, and check the PC's log lines.
2. Start the PC's server so the phone can reach it (`LISTEN_HOST="0.0.0.0"`, as in setup B).
3. In **StarPoint Companion**, tap **Game data**, then **Download from PC**, and tick **Game updates**:
   it brings the unit's art update. The unit files always come along, whatever you tick. (Leave **My save**
   unticked unless you mean to replace the phone's save with the PC's.)
4. Back on the main screen the server starts, sees the new unit and rebuilds its own game update (a minute
   or two). Nothing else to do.
5. **Check it worked:** the companion's log shows `[custom units] 111907 Haruhi (GP Test)` and "rebuilding the
   CN schedule update". Open the game: it downloads a small update at the title screen. Then give the unit
   (below): it arrives in Mail and shows in your unit list.

If you forgot **Game updates**, the phone leaves the unit out for now. Copy again with it ticked: the phone
then rebuilds by itself.

### On a phone without a PC (setup C)

**Not supported.** The OBB and the data zip never carry custom units, and the companion can't add a unit
file on its own. You need a PC once, for setup B's copy. After that the unit stays on the phone (its file and
art survive companion updates and save imports).

### On an emulator

- **Setup A's emulator** plays against the PC's server: the PC steps are all it needs.
- **An emulator running StarPoint Companion** is the same as a phone: setup B.

### Giving and summoning it

- **Give:** in the dashboard, open **Players** > the player, and under **Give** choose **Character**. Type the unit's id
  (e.g. `111907`) and press **Send Mail**. In the game, open **Mail** and claim it.
  Only give it once the game has downloaded the update with the unit, or the game stops with C8601.
- **Summon:** list summon banner ids in the unit file's `"banners"` (e.g. `["1613"]`), then restart the server.
  The unit then drops from those banners as often as any other unit of its rarity. The banner's **Rates**
  screen won't list it. For a summonable unit the id's first digit must match its rarity (1 = 5★, 2 = 4★…).

### Removing a unit safely

A save that holds a unit the server or game no longer knows fails with **C8601**. So **first take the unit out
of every save that has it.** There's no dashboard button for that yet. The ways are:
- keep the unit (simplest: it does no harm), or
- go back to a save backup from before you got it (dashboard **Players** > a player > **Download Save**/**Upload Save**; companion
  **Export save**/**Import save**).

Then delete `assets/custom_units/<id>.json` on the PC and restart the server. On a phone, copy from the PC
again: the phone deletes unit files the PC no longer has. The art update can stay.

### Troubleshooting

- **"Insufficient data. Returning to the title screen"** (asset recovery), or **error 8100**: one of the unit's
  files is missing on the device. The server's request log (`logs/cn_requests.log`; on a phone it's in the
  companion's server folder, readable with adb) has a line `notify_asset_recovery 未找到素材 <file>`
  naming the file. Usually the art update isn't on the device: on a PC, check step 2; on a phone, copy again
  with **Game updates** ticked. If the art update is there, the unit's `art_files.json` lacks that file:
  remake the unit with it.
- **C8003** "…pixelart/special 的影像短片尚未加载" (an animation isn't loaded): an animation file of the unit
  still names the unit it was copied from. The unit maker renames these; remake the unit with it.
- **C8601** "指定的Key不存在" (a key that doesn't exist): the game is missing one of the unit's rows. Usually:
  - the game hasn't downloaded the update with the unit yet: restart it, and check the server log says
    `Custom units: <id>`;
  - the unit was removed while a save still holds it (see above);
  - the unit file is broken, e.g. its Mana Board node ids are wrong: the server leaves such a file out and
    logs `[custom units] skipped: …` with the reason.

  After a C8601 the game deletes its copy of that table; the next update puts it back. Fix the cause, then
  restart the server so it rebuilds.

## Adding a unit (details)

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
