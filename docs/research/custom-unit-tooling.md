# Custom unit tooling (2026-11-03 to 2026-11-04)

> Written by Claude (AI) in a Claude Code session, with the repository owner deciding what to build and testing in
> the game. Research-grade: what was built, why, and what was learned on the way.

The [custom units research](new-units.md) showed that units are data: rows in about 20 tables plus files. This
session's job was to make working with them practical. The result is one tool, the **unit editor**, a dashboard
page for changing any unit's kit. How to use it is in [../UNIT_EDITOR.md](../UNIT_EDITOR.md); this page is the
background.

## What was built

**The unit editor** (dashboard: Unit editor, `/unit-editor`), for any CN unit or custom unit:

- **Abilities and leader skills** as lines in a form: conditions ("only if"), when/while, the trigger, who, the effect,
  its target and its numbers. Lines can be added, removed, or copied from any other unit.
- **Numbers**: HP/ATK, skill gauge, and every value of every line as **min → max**.
- **Details**: name, title, description, leader skill name, class, role.
- **Kit sharing**: download one, some or all edited units as one file (itself a change file), and import them.
- **In game**: each ability in the unit page's own words, at both ends of its range.
- **Saving** writes a unit change file (`assets/custom_units/changes/unit-editor-<id>.json`) and rebuilds the CN game
  update; phones get it with Download from PC.

**Tested in game** (StarPointTest emulator, 2026-11-03): Amelia's ability 1 changed to "every 6 → 1 s: combo +50 → 100",
a combination no CN unit has. The update rebuilt by itself, her unit page showed the new line in the game's words,
and in battle the combo jumped by 50 every few seconds. The test change was removed afterwards.

**Code**: `scripts/unit_editor.cjs` (reading, checks, saving), `scripts/unit_editor_text.cjs` (the game's wording),
`src/routes/web_api/unitEditor.ts` (API), `web/pages/unit-editor.html` (page), `assets/unit_editor/` (code tables
and plain words), `scripts/test_unit_editor.mjs` (offline test, `npm test`).

## Rules decided with the user

**Guard rails** (default mode):
- Only **triggers** CN's own units use: their triggers, conditions, condition + trigger pairs and "who" choices
  (built from every CN unit: 4,928 ability and leader lines). Triggers decide whether a line works.
- **Effects are free**: any effect goes with any of those triggers, with no warning. The game fires the trigger,
  then applies the effect the same way whatever fired it; the emulator test confirmed a new pairing works.
- **Advanced mode** (tick box) offers everything the game can read, marked "Unused trigger / condition / effect:
  may not work or crash the game."

**Always refused**, in both modes:
- contradictions: a condition that rules out the line's own trigger ("not in Fever" + "while in Fever"), the leader
  being two elements, HP above X and below a lower Y;
- "for the unit that triggered it" on a trigger with no "who" (nobody triggered it);
- a **unit-specific buff** ("Energy Drain", "Cursed"... 19 in CN) on a unit whose own kit doesn't use it;
- anything the game can't read (an unknown code, a word where a number belongs).

**Not done on purpose**: guessing whether a line is "useful", and a validator for community-made units (no support
is given for those unless GlobalPoint itself broke them).

## What the game does (learned on the way)

All checked in the CN 1.8.1 client's code (FFDec p-code of the installed SWF; the older 2.1.125 decompile numbers
codes 1-4 off) and, where marked, on real unit pages or in battle.

- **Every number** in the tables is the value × 100,000: 15 % attack = 15,000; 10 times = 1,000,000; Fever gauge 750
  points = 75,000,000. Durations count frames (60 a second): 15 s = 900 frames = 90,000,000; "every X seconds"
  triggers and cooldowns count frames too.
- **Min → max**: an ability's value goes from its 1st Mana node to its 6th in a straight line (no node = off). A
  leader skill goes from before to after awakening. The skill gauge goes from skill level 1 to the top.
- **Mana nodes** hold no numbers: each one is "ability N +1", "skill +1" or "skill → Skill+". No node adds stats.
- **Leader lines have an awakening tag** (leader column 1): 0 always, 1 only before awakening, 2 only after. A
  leader that changes at awakening keeps one line for each (Barrek: "+ 55 %" before, "+ 70 %" after).
- **Class** (character column 6) also picks the unit's Power Flip attack, and counts for abilities that target a
  class. **Role** is a label, icon and list filter only. No stat depends on either.
- **Fever gauge**: each battle quest sets its own size (main story mostly 120 points), × 1.25 after each Fever.
  Amelia's "+750 → +1000 to Fever Gauge" means she starts ready to Fever.
- **"the first N time(s):"** and **"(Max …)"** are the same setting, the line's limit ("times (max)"): one-off
  effects show "the first N time(s)", stacking ones show the total at N stacks.
- **Ability text** is written by the game from the rows, so a saved change always shows correctly on the unit page.
  The editor's "In game" box rebuilds that text from the game's English pieces (the UI string table) with a copy of
  its template engine: 92 % of CN lines, matched word for word against about 20 units' pages. Lines involving
  unit-specific buff names, skill upgrades and a few rare damage effects aren't worded yet.
- Every trigger, condition and effect code, with its client name and the fields it reads:
  [ability-triggers.md](ability-triggers.md) and `assets/unit_editor/ability_codes.json`.

## Dropped by the user, and why

| Idea | Why not |
|---|---|
| New unit from the dashboard | Editing any unit's kit covers it; a new unit only adds a second copy or its own art, and extra copies are confusing. |
| Skill editing | Skills are scripts of many commands, hits and conditions (a hit's `{min: 6.11, max: 7}` is its damage multiplier by skill level); too much for an easy editor. |
| Validator | No support is given for community-made units. |
| Mana Board editor | Nodes follow the abilities' own min/max; costs stay as they are. |
| Pixel art tools | Animation frames have to be drawn by hand. |

Not taken up: **mod import** (the picture-only reskins gojo / wf-modded `dimension_witch`; V1.0.0's pixel-sprite
reskin `flame_witch`, `wild_wolfgirl`; the Haruhi mod is a whole new unit) and an **art drop-in**. Replacing an
existing unit's files is described in [new-units.md](new-units.md#replacing-an-existing-units-files-reskins-voice-swaps).

## The original plan (for reference)

The first ranked plan (2026-11-03), before the user chose: 1 validator, 2 unit maker from a short spec, 3 mod import,
4 art drop-in, 5 skill script helpers, 6 a dashboard page for custom units. The user asked instead for a
**numbers editor** ("change a number, that's it") and an **ability editor** (add or remove what an ability does),
which became the unit editor. Amelia's partial de-work (`assets/kit_dates.json`, 2026-11-02) was the worked example:
the editor does it as "remove the lines the rework added, add the old ones back".

## Unit editor: code

- `scripts/armament_editor.cjs`: the armament side (uses the unit editor's checks and wording);
  `scripts/test_armament_editor.mjs` (`npm test`): its offline test.
- `scripts/unit_editor.cjs`: reading units, the checks, saving. `src/routes/web_api/unitEditor.ts`: its API
  (`/api/unit-editor/...`). `web/pages/unit-editor.html`: the page.
- `assets/unit_editor/ability_codes.json`: every condition, trigger, effect, who and target code with the fields
  (columns) it reads, from the CN 1.8.1 client's own table parser (`scripts/research/ability_codes_from_pcode.cjs`;
  the research is [research/ability-triggers.md](ability-triggers.md)).
- `assets/unit_editor/words.json`: plain words, and which effects are percentages or on the base scale.
- `scripts/unit_editor_text.cjs`: lines in the game's own words (a copy of the game's template engine, and its
  wording rules for the common triggers, conditions and effects).
- `scripts/test_unit_editor.mjs` (`npm test`): offline test.

## Unit editor: tested (2026-11-03, StarPointTest emulator, companion 0.6.24 server)

Amelia (221003) ability 1 edited in the editor to "if this unit is Water: every 6 → 1 s → combo +50 → 100" (a
combination no CN unit has: the "not seen before" notice) and Lv 80 HP 3000. The change file went into the companion's
`custom_units/changes/`; the server rebuilt by itself (update 1.4.960, both rows in it); the game took the 7 MB
update. Her unit page showed the line in the game's own words ("When this unit is a/the ⟨Water⟩ unit → 6 seconds have
passed → +50 Combo", locked until her Mana node), and in a quest battle with the node learned the combo jumped by 50
every few seconds (108 combo 11 s in). Not tested yet: a custom unit's edit, a phone getting it by Download from PC.

**Phone only (2026-11-04, StarPointTest emulator, companion 0.7.1):** with no PC involved, Amelia's ability 1 was
edited and saved through the companion's own server (15 → 30% attack made 40 → 80%). The change file was written to
the phone's `custom_units/changes/`, the phone rebuilt its update (1.4.963), the game downloaded it (21 MB) at the
title screen, and her unit page read "+ 80 % to attack for this unit (Max + 240 %)". **Reset unit to game** removed
the file and rebuilt. At phone width (375 px) some of the page's dropdowns (e.g. an effect's "Do") ran past the
right edge of the screen; since companion 0.7.2 they fit the screen and long choices end in "…".
