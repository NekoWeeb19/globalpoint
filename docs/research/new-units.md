# New units in the CN app from data only (research, 2026-11-03)

**Result: it works.** A brand-new unit (id 111907, string id `gp_test_haruhi`, "Haruhi (GP Test)") was added to the
patched CN 1.8.1 app with **no game-code change**: table rows plus files, shipped as an ordinary StarPoint update
patch, plus two server data entries. On the StarPointTest emulator it was mailed to a save and claimed, and it showed in
the unit list. Its detail page worked, and so did its skill **Preview** (a real battle run, with the new skill script,
skill effects and voices). It was leveled to 80, uncapped and EX Boosted. Mana Board 1 was unlocked in full,
**awakening included** (awakened art, voice line and upgraded leader talent), it **finished a single-player quest battle and a co-op battle**, and it took an armament and
an ability soul. A second copy stacked as a normal duplicate (with its Fire EX Boost material), and it
**dropped from a real summon banner** once its id was added to that banner's pool. Level 100, both amity scrolls and
a fully unlocked **Mana Board 2** work too.

The test unit is a clone of Haruhi Suzumiya (111069) under a new id and string id, so every one of its files is a
*new* file. That makes it the same path a hand-made unit would take. What a hand-made unit would still need is new
content: art, a kit, a skill script. The full list of what a unit needs is the
[Checklist](#checklist-everything-a-custom-unit-needs); tooling ideas are in [What a "new unit" tool needs](#what-a-new-unit-tool-needs).

| | |
|---|---|
| ![detail](images/new-unit-detail.png) | ![skill](images/new-unit-skill.png) |
| ![skill preview battle](images/new-unit-skill-preview.png) | ![awakening](images/new-unit-awakening.png) |

## Where this came from

- **Community mod (global app, 2024).** duosii's `haruhi_mod` added Haruhi to global, building her on Alk's files
  (`alk_3halfanv`). Every table change in it is additive, and it adds about 380 new files. Two failures were
  reported: "game crashes when entering battle & opening character details", and an "asset check" that sends you
  to the download screen. Both are explained below; they were the two bugs this research hit first, too.
- **Tools.** [wfax](https://github.com/blead/wfax) (Go: `fetch`, `extract`, `pack`) and
  [wdfp-extractor](https://github.com/ScripterSugar/wdfp-extractor) (Electron, newer) extract and repack files.
  Their path lists (67,645 and 61,894 logical paths) mostly hold paths that appear inside tables. Neither lists a
  unit's portraits, sprites or battle voices: those names are built in game code. GlobalPoint already has its own
  equivalents (`scripts/cdn_hash.cjs`, `cdn_rows.cjs`, `amf3.cjs`, `build_cn_patch.cjs`).
- **Decompiled CN client** (`F:\WF client\cn\decompiled\scripts`): the source of everything marked *(code)* below.
  `pinball/master/generated/*Values.as` holds a parser for each of the 785 tables, which names every column.

## How the game finds a unit

- **The id** (`111907`) keys most tables. Digit 1 = rarity (1 = 5★), digit 2 = element (1 fire … 6 dark). Unused ids
  work; nothing checks a range.
- **The string id** (character column 0, `gp_test_haruhi`) is the folder of every file:
  `character/<string id>/ui/...`, `/pixelart/...`, `/voice/...`, `/battle/...`. *(code)*
- **Character column 8** names the skill (`master/skill/action_skill` key `<name>/1`, `/2`). The skill row's
  column 7 names the skill script `battle/action/skill/action/rare5/<name>$<name>_N`. *(code: CharacterValues)*
- **Mana Board node ids are not free numbers.** The game finds a node's row from its id:
  `board = id / 200 % 10`, `index = id % 200`, so `id = unit × 2000 + board × 200 + index`
  (Haruhi 222138201 = 111069 × 2000 + 200 + 1; Meteor Light's MB2 ids 302306201… = 151153 × 2000 + …).
  *(code: GeneralManaNodeLogic.get_values)* Other ids crash the detail page with C8601 "key 5".

## The tables (19)

Found by decoding every CN table (3,895) and searching for the id and the string id. The keys are the new unit's.

| Table | Key | Notes |
|---|---|---|
| master/character/character | id | col 0 string id, 8 skill name, 17 leader id, 18 leader name, 19-24 ability ids, 27 identity id |
| master/character/character_text | id | col 0 name, 3 title, then skill/ability texts (already English in GlobalPoint's tables) |
| character_status `5c/6a4f…` | id/level | "HP,ATK" at 1/10/80/100 |
| master/character/character_speech | id | home lines; col 4 = voice file under `voice/` |
| ability `1e/664c…` | id×10+1..6 | two lines per row (layout in the memory note kit-rows-decode) |
| leader_ability `ff/8435…` | id | |
| master/skill/action_skill | skill name / 1, 2 | col 7 skill script path, 4/5 gauge |
| skill_preview_character `aa/abdd…` | id | which preview stage |
| character stance_detail `d7/50c2…` | id | |
| full_shot_image_attribute `b9/132d…`, character_image `3e/b411…`, trimmed_image `fb/ab43…` | id/0,1; picture path | picture crops |
| upskill `57/8872…` | id | |
| battle sound effects `ac/b038…` | id/frame | |
| master/mana_board/mana_node | id/board/index | node ids as above |
| master/generated/mana_board | id/board/index | layout; col 5 = parent node ids |
| master/mana_board/mana_board2_open_condition | id | |
| master/encyclopedia/encyclopedia | 1<id> | |
| master/story/story_character | string id | name, voice folder, expressions |

Not needed for a playable unit (tested: nothing breaks without them): degree (title), degree_mission, gacha/banner rows, shops, event stories.
Rows can be appended anywhere: lookups are by key (`OrderedMap`, `indexOf`), not binary search.

## The files (76 for Haruhi)

- `pixelart/` 8: `pixelart`, `special` `.frame` + `.timeline`, `sprite_sheet` and `special_sprite_sheet` `.png` + `.atlas`
- `ui/` 41 (most in `medium_upload`): `square_*`, `thumb_*`, `full_shot_1440_1920_0/1`, `skill_cutin_0/1`,
  `cutin_skill_chain_*`, `battle_*`, `episode_banner_0`, `illustration_setting_sprite_sheet`, `story/<expression>`
- `voice/` 22: `battle/` (battle_start, skill, skill_ready, outhole, power_flip, normal_attack, win; `_0`/`_1`),
  `login/login_0..2`, `home/…` (from character_speech)
- `ui/skill_cutin_0/1.atf.deflate` 2 (Android-only folder `android_upload`): the battle skill cut-in textures
- `battle/character_detail_skill_preview` and `character_info_skill_preview` `.battle`: recorded preview inputs
- skill scripts `battle/action/skill/action/rare5/<skill>$<skill>_1/_2.action.dsl`; skill effects under
  `battle/effect/skill_unique/...` (the skill script names them, so a new unit can reuse another unit's effects)

Stored names: `<logical path>.<type>` hashed with `scripts/cdn_hash.cjs`; JSON-like files are AMF3 + deflate
(`.atlas.amf3.deflate`, `.frame.amf3.deflate`, `.action.dsl.amf3.deflate`); pictures `.png`; voices `.mp3`.
`scripts/research/unit_files.cjs <id>` lists a unit's files (it tries every name the game builds).

**Files that name themselves.** `.frame` and `.atlas` files hold their own path (`"name":
"character/suzumiya_haruhi/pixelart/special"`). A renamed copy must be rewritten inside, or the game asks for the
old animation: C8003 "…pixelart/special 的影像短片尚未加载". This is very likely duosii's crash on battle and
character details. `scripts/amf3.cjs` reads and writes these (decode, edit, encode: same values on re-read). Some
files are raw deflate, some zlib.

## The "asset check"

There is no manifest check. Whenever the game reads a file that isn't on disk, it goes to the "Insufficient data.
Returning to the title screen" screen, or throws error 8100 *(code: FileReader → AssetSufficiencyCheckLoadingTask)*.
The game reports the exact path to the server's crash log (`/cn/crash` in `cn_requests.log`):
`notify_asset_recovery 未找到素材 character/gp_test_haruhi/battle/character_detail_skill_preview.battle.amf3.deflate`.
So a missing file is easy to diagnose: open the screen, read the log, add the file.
The Haruhi mod shipped no voice files and no `battle/` preview files, which explains its download screen.

A related trap: when a table lookup fails (C8601), the game **deletes its copy of that table**. The next update that
ships the table restores it.

## Shipping

- An update patch can add any new file, in `upload/` or `medium_upload/` (`scripts/build_cn_patch.cjs`; the
  1.4.600 home banners already did this).
- **Server**: `assets/character.json` (`{ name, rarity, element, skill_count: 6, cn: true }`) so the server can give
  the unit (dashboard Give → mail), and `assets/mana_node_cn.json` (same node ids) so Mana Board unlocks are accepted.
- **The schedule rebuild is the catch.** Seven of the tables (character, character_status, ability,
  leader_ability, action_skill, encyclopedia, mana_board2_open_condition) are re-shipped by every schedule build
  (`scripts/gen_cn_event_schedule.cjs`), from CN's own rows, so the new rows would vanish at the next rebuild,
  and a save holding the unit would then hit C8601. The kit-by-date mechanism (`assets/kit_dates.json`) only
  *replaces* existing rows. A permanent version needs a small server-side step that *adds* custom-unit rows
  inside the schedule build (data only; no game-code change).

## The proof of concept

`scripts/research/clone_cn_unit.cjs` (unit and names set at the top) writes the 19 tables with the new rows, the
76 files under the new string id (renamed inside where needed), `files.json` for `build_cn_patch.cjs`, and
`server.json` for the two server files. It takes tables from the newest copy the device has
(CN → this PC's patches → `--newer` folders, e.g. a phone's own schedule builds), so translations stay English.

Test run (emulator 5556, companion server, game at schedule build 1.4.805):

1. 1.4.950: everything except the files' inner names → mail icon fine, **C8003** on claiming (frame names).
2. 1.4.951: frame/atlas names rewritten → unit list fine, detail page **C8601** (Mana Board node ids).
3. 1.4.952: node ids = unit × 2000 + … → detail page, skill, leader, abilities fine; Preview → **asset recovery**
   for `battle/character_detail_skill_preview.battle`.
4. 1.4.953: the two preview files added → Preview battle with the skill firing; Mana Board unlocks accepted by the
   server; levels 1-80, uncap, EX Boost, Mana Board 1 with awakening all work. A quest battle → **asset recovery**
   for `ui/skill_cutin_1.atf.deflate`.
5. 1.4.954: the two `.atf.deflate` cut-ins added (Android folder) → single-player quest battle and co-op battle
   finished; equipping an armament and an ability soul works. A second copy by mail: the unit-obtained scene, stack +1
   and a Fire EX Boost item. Added to banner 1613's 5★ pool (`assets/gacha.json`): pulled with the normal result screen.

6. Same 1.4.954: Lv 100, both amity scrolls (`receive_bond_token`), Mana Board 2 opened and all its nodes learned
   (board 2 ids 111907 × 2000 + 400 + index). No title is awarded, since the degree rows weren't copied, and
   there's no error.

Not tested yet: multiplayer with another device, a real phone, a schedule rebuild (known to drop the rows).

## Checklist: everything a custom unit needs

How sure each part is:
- **Proven in game:** a unit with exactly these ids, rows, files and server entries works in everything tested
  (see the proof of concept). Every failure listed under error codes was seen, explained and fixed.
- **Measured:** sizes, formats, the lowercase `png` signature, the MP3 frame headers (`7FFB`, checked), the ATF header,
  the animation sequence names: what Haruhi's files are, not tested limits.
- **Not tested:** whether the "required by screens" tables are all really required (everything Haruhi has was
  copied; none was left out to see); whether screens not opened in the test (Town, home-screen character, codex) ask
  for more files (the log would name them); whether plain PNG / plain MP3 / a `png2atf` cut-in are accepted for new
  art; the id digit rule below 5★ and the `character.json` element numbering beyond Fire. "Optional" items were
  tested only where said (titles, the Rates list).

### 1. Ids (pick first; everything else derives from them)

| Id | Rule | Test unit |
|---|---|---|
| Unit id | 6 digits; digit 1 = rarity (1 = 5★ … 5 = 1★), digit 2 = element (1 fire, 2 water, 3 thunder, 4 wind, 5 light, 6 dark); never used by CN | 111907 |
| String id | lowercase folder name for every file; unique | `gp_test_haruhi` |
| Skill name | character column 8, key of the skill rows (usually = string id) | `gp_test_haruhi` |
| Ability ids | unit id × 10 + 1..6 | 1119071-1119076 |
| Leader id | = unit id | 111907 |
| Encyclopedia key / entry id | `1` + unit id / `1` + unit id + `01` | 1111907 / 111190701 |
| Mana Board node ids | unit id × 2000 + board × 200 + index (board 1-2, index 1-199); the game derives board and row from the id | 223814201… |

### 2. Table rows (19 tables, shipped in a game update)

All copied from a template unit and edited. Text fields are what players read (English in GlobalPoint's tables).

- **Required for the unit to exist:** character, character_text (name, title, skill and ability text),
  character_status (HP/ATK at Lv 1/10/80/100), ability ×6, leader_ability, action_skill (2 rows: skill and skill+),
  mana_node + generated/mana_board (both boards), mana_board2_open_condition (board 2 open date).
- **Required by screens:** character_speech (home lines, voice names), story_character (name, expressions),
  stance_detail, skill_preview_character, upskill, full_shot_image_attribute, character_image and
  trimmed_image (picture crops), encyclopedia, the battle sound-effect table (`ac/b038…`).
- **Optional:** degree + degree_mission + degree_mission_reward (Lv 100 / board titles), gacha_odds (Rates list),
  gacha / feature banner rows, character episodes, event stories.

### 3. Files (76; most players never see the folder names)

Names are hashed (`scripts/cdn_hash.cjs`); each file keeps its folder kind (`upload`, `medium_upload`,
`android_upload`). Pictures are PNG with the signature written in lower case (`\x89png`, as all of the game's own);
AMF3 files are raw-deflated except where noted.

| Files | Folder | Format / size | Notes |
|---|---|---|---|
| `pixelart/sprite_sheet.png` + `.atlas.amf3.deflate` | upload | PNG ~250×255; atlas of frames | frames are 256×256 cells at scale 6, named `character/<id>/pixelart/pixelart0001`… |
| `pixelart/pixelart.frame` + `.timeline` `.amf3.deflate` | upload | AMF3 | frame names its own path; timeline sequences: `neutral`, `walk_back`, `walk_front`, `skill_ready`, `kachidoki`, `into_coffin`, `ghost_raise`, `ghost_neutral`, `revive` |
| `pixelart/special_sprite_sheet.png` + `.atlas`, `special.frame` + `.timeline` | upload | PNG 128×512 | skill pose: sequences `special_land`, `special_pose` |
| `ui/full_shot_1440_1920_0/1.png` | medium | ~1400×1700 / ~1560×1500 | portrait, `_1` = awakened |
| `ui/skill_cutin_0/1.png` | medium | 1024×512 | |
| `ui/skill_cutin_0/1.atf.deflate` | **android** | ATF texture (`ATF` header), zlib | battle cut-in; needs an ATF encoder (Adobe AIR SDK `png2atf`) for new art |
| `ui/square_0/1`, `square_132_132_*`, `square_round_136_136_*`, `square_round_95_95_*` | medium | 212², 132², 136², 95² | icons |
| `ui/thumb_party_main_*`, `thumb_party_unison_*`, `thumb_level_up_*` | medium | 186×392, 144×188, 252×329 | |
| `ui/battle_control_board_*`, `battle_member_status_*`, `cutin_skill_chain_*` | medium | 104×268, 58×58, 276×319 | battle HUD |
| `ui/episode_banner_0` | medium | 430×215 | |
| `ui/illustration_setting_sprite_sheet.png` + `.atlas` | medium + upload | 362×792 | two crops `full_shot_illustration_setting_0/1` |
| `ui/story/base_0/1` + one per expression in story_character | medium | 570×~600; expressions ~200×290 | |
| `battle/character_detail_skill_preview` / `character_info_skill_preview` `.battle.amf3.deflate` | upload | AMF3, zlib | recorded skill-preview input; can be copied from any unit |
| `battle/action/skill/action/rare5/<skill>$<skill>_1/_2.action.dsl.amf3.deflate` | upload | AMF3 skill script | names effect files under `battle/effect/skill_unique/…` (reuse any unit's, or add new) |
| `voice/battle/` battle_start_0/1, skill_0/1, skill_ready, outhole_0/1, power_flip_0/1, win_0/1 (normal_attack_* for some units) | upload | MP3 (ID3-tagged; frame sync 0xFF stored as 0x7F) | |
| `voice/login/login_0..2`, `voice/home/*`, `voice/ally/join`, `voice/ally/evolution` | upload | MP3 | names come from character_speech |

A missing file shows as "Insufficient data. Returning to the title screen" (or error 8100); the exact path is in the
companion's `files/server/logs/cn_requests.log` (`/cn/crash`, `未找到素材 <path>`).

### 4. Server data

- `assets/character.json`: `"<id>": { "name": "", "rarity": 5, "element": 0, "skill_count": 6, "cn": true }`
  (element here is 0 fire … 5 dark). Needed to give, level, uncap and stack the unit.
- `assets/mana_node_cn.json`: both boards, node id → items, mana cost (needed to unlock nodes).
- Optional: `assets/gacha.json` pools (first in the tier's list, or rescale weights; see Summoning).

### 5. Shipping

- One game update (`scripts/build_cn_patch.cjs`) with the tables and files, numbered far above schedule builds
  (art patches 1.4.9xx; never on a number a phone's own schedule build could take).
- The tables the schedule rebuilds (character, character_status, ability, leader_ability, action_skill,
  encyclopedia, mana_board2_open_condition) must get the unit's rows from the schedule build itself, or they're
  lost at the next rebuild and a save holding the unit stops loading (C8601). Being built in the follow-up
  session "Custom units in the CN schedule build".
- Phones get it like any update (Wi-Fi copy with game updates ticked).

### 6. Error codes met on the way

| Code | Meaning | Cause here |
|---|---|---|
| 8100 / asset recovery screen | a file the game read isn't there | a file left out (path in the log) |
| C8003 `…的影像短片尚未加载` | animation not loaded | a `.frame`/`.atlas` still naming the template unit's path |
| C8601 `指定的Key不存在` | table row missing (and the game deletes that table) | wrong Mana Board node ids; or rows dropped by a rebuild |

## What a "new unit" tool needs

1. **Rows.** A unit as a small JSON file (id, string id, rarity, element, stats, ability rows, leader, skill rows,
   Mana Board), compiled into the 19 tables. Ability/leader columns are decoded already (memory note
   kit-rows-decode, `scripts/build_kit_*.cjs`), and `*Values.as` names every column of every table.
2. **Schedule integration.** Add those rows in `gen_cn_event_schedule.cjs` (like kit_dates, but appending), and
   write `character.json` / `mana_node_cn.json` entries, so rebuilds keep the unit.
3. **Art pipeline.** Pixel sprites as sheets + `.atlas` (frame rects, AMF3) + `.frame`/`.timeline` (animation
   sequences such as `special_land`/`special_pose`); portraits and icons at fixed sizes (the `ui/` list above);
   `trimmed_image`/`character_image` crop rows. `scripts/cn_sprite_merge.cjs`/`amf3.cjs` already write sheets and
   atlases. Drawing the art is the real cost.
4. **Skills.** A skill script is a JSON-shaped AMF3 tree (`["ActionDsl", 2, …, ["Block", [["Command",
   ["StopBall", …]], ["Command", ["ShowEffect", …, "battle/effect/skill_unique/<x>/<y>"]] …]]]`). New skills can
   combine existing commands and reuse any unit's effects. Writing one by hand needs the command list documented
   (wfax/wdfp-extractor decode the format but don't explain it). New *effect* animations are art, like sprites.
5. **Voices.** Optional. Game MP3s have each frame's sync byte 0xFF stored as 0x7F (wdfp-extractor's restoreMp3);
   a new clip should be stored the same way (untested whether plain MP3 also plays).
6. **Ids.** Pick an id with the right rarity/element digits that CN never used; Mana Board ids follow from it.

## Summoning

The draw is server data: each banner in `assets/gacha.json` lists its pool by tier, and adding the unit's id there is
enough to pull it (tested on banner 1613). The result screen uses files the unit already has. Two details:
- `src/lib/gacha.ts` rolls 0-1000 and walks the tier's list in order, so the weights (`rarity`, per mille) must still
  sum to about 1000: rescale the others, or the added unit at the end is almost never picked.
- The banner's Rates screen comes from CN's odds table (`master/gacha_odds/<id>`), so without a row there the unit
  drops but isn't listed. A featured banner (pictures, feature content, pickup movie) is a much larger job.

An id the server doesn't know is skipped (the roll is lost, no error); an id the server knows but the game's tables
don't would be saved and then break the save (C8601), so pools must only name units that exist on both sides.

**Bosses and events** follow the same rules (data tables + files + the server's own quest data); the Haunt and
the event schedule already add rows that way. They weren't tested here.
