# Custom unit tooling: ideas, ranked (2026-11-03)

> Written by Claude (AI) in a Claude Code session. Research-grade: a plan, then the tools built from it.

What exists ([../CUSTOM_UNITS.md](../CUSTOM_UNITS.md), [new-units.md](new-units.md)): custom unit files in
`assets/custom_units/` that every CN schedule build ships, change files for existing units, a unit maker that
copies one CN unit under a new id (`scripts/research/clone_cn_unit.cjs`, unit set by editing constants at its
top), a file lister (`unit_files.cjs`), and the server/dashboard side (Give, summon pools, Remove).

What's missing is everything between "a copy of Haruhi" and "my own unit": changing a copy in a readable way,
checking it before the game sees it, and bringing in other people's work.

## Ranking

Ranked by (how often it saves a failed test on a device) × (how many people it helps) ÷ effort.

| # | Tool | Value | Effort | Why this rank |
|---|---|---|---|---|
| 1 | **Validator** (`unit_check`) | high | small | Every failure met so far (missing file → asset recovery, frame naming the old unit → C8003, bad node id → C8601, null where a file name belongs) can be found offline. One emulator round trip costs minutes; the check costs a second. Works on any unit file, and on mods. |
| 2 | **Unit maker from a spec** (`make_unit`) | high | medium | Today a new unit means editing a script's constants and then hand-editing 19 tables of CSV. A short spec (template unit, id, names, stats, text, "abilities from unit X", "skill from unit Y", "art from folder Z") covers the common "remix" units without touching CSV. |
| 3 | **Mod import** | medium | medium–large | Packed mods (hashed `production/...` files) are easy: a files list for `build_cn_patch.cjs`, plus a check of which CN unit each file belongs to. Unpacked mods (`assets/<logical path>` + whole `orderedmap/*.json` table dumps from *global*) need a diff against global's tables and a column check against CN's, which may differ per table. Art-only swaps (the gojo/haruhi picture mods) are the realistic first target. |
| 4 | **Art drop-in** | medium | small (pictures) / large (animations) | Pictures: put `full_shot_1440_1920_0.png` etc. in a folder by their game names, the tool checks sizes, writes the lowercase PNG signature, hashes the names. Pixel animations: wfax-style unpacked frames + `.atlas.json` can be packed back to sheet + AMF3 (`amf3.cjs`, `cn_sprite_merge.cjs`); drawing new frames is the real cost. The `.atf` battle cut-in needs Adobe's `png2atf`: untested. |
| 5 | **Skill script helpers** | medium | small (dump/copy) / large (authoring) | Dump a skill as readable JSON, list the effect files it names, copy a skill from one unit to another (with its effects). Writing new skills needs the command list documented first. |
| 6 | **Dashboard page** | low–medium | medium | List custom units with their check results, Give, banner choice. Nice for players, but the dashboard already gives by id; the tools above come first. |

## 1. Validator

`node scripts/units/unit_check.cjs <unit file or unit folder> [--files art_files.json]`

Checks, each a line with the table/row/column it found:

- **Ids**: the unit file's own rules (`custom_units.cjs` `unitProblems`), plus: every row key uses the new id or
  string id; ability ids `id×10+1..6`, leader id, identity id, encyclopedia keys and unlock condition all
  name the new unit (a leftover template id is the codex-unlock bug the research fixed by hand).
- **Leftovers**: any row or AMF3 file still naming the template's string id (→ C8003, or the template's files
  being loaded).
- **Columns**: each row has the same column count as CN's rows of that table (taken from the template or any
  CN row), and `null`/`undefined` never appears where CN has text.
- **Files**: every file the game will read exists in the unit's files, StarPoint's updates or CN: the names the
  game builds from the string id (pixelart sheets, ui pictures, battle voices, preview `.battle` files), plus
  the names inside the rows (skill script path, home voices, story pictures, trimmed_image keys), plus the
  names inside the skill scripts (effect paths). Missing = the asset recovery screen.
- **Formats**: PNG signature (`\x89png`), picture sizes against the template's, AMF3 files decode, MP3 headers.

## 2. Unit maker from a spec

```jsonc
{
  "template": "111069",          // any CN unit: rows and files are copied from it
  "id": "111908", "dev": "my_unit", "name": "My Unit",
  "text": { "name": "My Unit", "nickname": "…", "description": "…", "skill_name_1": "…" },
  "stats": { "1": [47, 13], "80": [3000, 800], "100": [3300, 850] },   // HP, ATK by level
  "element": "fire", "rarity": 5,
  "abilities": { "3": { "from": "151165/3" } },    // ability 3 copied from Alk's 3rd
  "leader": { "from": "151165" },
  "skill": { "from": "151165" },                   // skill rows + script (+ its effects) from another unit
  "art": "D:/my art/my_unit"                        // files by game name replace the template's
}
```

Output: the same unit folder `clone_cn_unit.cjs` writes (`custom_unit.json`, `art_files.json`, files), then
the validator runs on it.

## 3–6

Kept as notes until 1 and 2 are built; see the table above. For import, the safe first step is a report:
"this mod touches units X, Y; these files replace these game files; these table rows differ from global's".

## User's picks (2026-11-03)

Asked for first, in this order. Both are notes only; nothing built yet.

### A. Numbers editor (the simplest tool: change a number, that's it)

Export a unit's numbers to a readable file, edit, apply. Only numbers that already exist; nothing added or
removed. Every number in the game is stored as a **min → max pair**, and the game fills the steps between on
a straight line (client: `AbilityPowerValue.resolve`, linear between Lv 1 and max):

| What | Min | Max | What moves it | Where |
|---|---|---|---|---|
| Ability 1–6 values (effect size, duration, thresholds) | 1st Mana node | 6th node (`max_ability_powers`, 6) | each ability has 6 "ability +1" nodes; Lv 2–5 evenly spaced. 0 nodes = ability off | ability row, cols 51/52 (instant value), 57/58 (duration), 113/114 (while value), 30/31 and 100/101 (thresholds) |
| Leader skill values | before awakening | after awakening | the awakening (`LeaderAbilityLogic`: `LevelScale(evolution + 1, 2)`) | leader_ability row, same columns − 2 (49/50, 55/56, 111/112) |
| Skill gauge | skill Lv 1 | max skill Lv | "skill +1" nodes; Skill+ (`/2` row) after the evolution node | action_skill cols 4/5 |
| Skill damage, buffs, durations | skill Lv 1 | max skill Lv | same | skill script (`{"min","max"}` objects in the ActionDsl); a file, so it needs an art update. Second version |
| HP / ATK | Lv 1, 10, 80, 100 | | unit level (no Mana node adds stats) | character_status |

Mana nodes hold no numbers of their own: each is "ability N +1", "skill +1" or "skill → Skill+"
(`ManaNodeValues.parseAt5`). Units: values are ×100000 (10000 = 10%), durations frames × 100000
(90000000 = 15 s), counts ×100000.

Output: for a custom unit, its unit file's rows; for a CN unit, a change file in
`assets/custom_units/changes/` (single-line rows as `{ cols }`, multi-line ability/leader rows as the whole
row). Left out: Mana Board costs (the server keeps its own copy in `assets/mana_node*.json`).

### B. Ability editor: add or remove what an ability does (abilities only)

An ability row is a list of **effect lines**, one CSV line each (126 columns): "when X happens: do Y" (instant,
col 5 = 0) or "while X: Y" (during, col 5 = 1). Removing an effect = dropping a line; adding one = a line copied
from any unit's ability (every CN ability is a library of working effect lines) and renumbered. Shown in a
digestible form, e.g.:

```
Ability 3 (Amelia, 2022 kit)
  1. When Fever starts: heal 9% → 18%, this unit          [mermaid_3 line 1]
  + add: "When Fever starts: Fever gauge +X%"  (from <unit> ability N line M)
  - remove line 2
```

**Worked example: Amelia's partial de-work** (221003, `assets/kit_dates.json`, verified in game 2026-11-02).
Her 2022 kit, rebuilt from her current rows by hand:
- ability 1: one line, *while in Fever* (97 = 4): water party attack +17.5% → 35%;
- ability 2: one line, *while HP above 60%*: water party attack +10% → 20%;
- ability 3: *when Fever starts* (27 = 8): heal 9% → 18% (effect 206);
- ability 4: *when Fever starts*: leader attack +25% → 50% for 15 s;
- ability 5: *when Fever starts*: healing received +5% → 10%, up to 3 stacks (effect 195, col 34);
- ability 6: *when the leader is water* (6 = 43) and *heals 2000 HP* (27 = 78): leader attack +50% → 100% for 30 s;
- leader: 2 lines (water HP +15% → 20%; Fever time +18.75% → 25%).

The tool would have done this as: open Amelia's current abilities, remove the lines the rework added, add
the old ones from the effect library (or type their numbers), save as a change. The `kit_dates.json` stage
format stays the output when a date is wanted (Balance by Date).

What it needs that isn't decoded yet: names for more trigger, condition, effect and target codes (the known
ones are in the memory note kit-rows-decode and `new-units.md`'s appendix). An effect library can label every
line in CN by the English ability text of the unit it comes from, so unknown codes can still be picked by
example. Skills are out (their behaviour is the skill script); leader skills use the same line format
(columns − 2), so they may work the same way later, but that's untested.
