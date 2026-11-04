# Unit editor (dashboard)

> Written by Claude (AI) in a Claude Code session, with the repository owner choosing how it works.

Change what a unit's abilities do, and its numbers, from the dashboard: **Unit editor** in the menu
(`/unit-editor`). Works for every CN unit and for custom units ([CUSTOM_UNITS.md](CUSTOM_UNITS.md)).
No unit ids change, so saves are never at risk.

## What it edits

- **Abilities tab**: every ability (1-6) and the leader skill, as lines. Each line is one effect:
  - **Only if**: up to 3 conditions ("this unit is Water", "6+ Water units in the party", "HP at or above 80%"...);
  - **Kind**: *when* (the moment something happens) or *while* (as long as something is true), and the trigger
    ("Fever starts", "uses its skill", "every X seconds"...), with only the fields that trigger uses (every N times,
    seconds, HP %, who, times (max), cooldown);
  - **Do**: the effect, its target and its numbers (value, duration, max stacks...).

  Leader skill lines also have **Shown**: always, before awakening only, or after awakening only (the game keeps a
  separate line for each where the numbers change at awakening, e.g. Barrek's "+ 55 %" before and "+ 70 %" after).

  Lines can be removed, added (at most **8 lines** per ability or leader skill; CN's own units use up to 6 and 8), or
  copied from any other unit. **Reset to game** on an ability gives its own lines back.

  Under each ability, **In game** shows it in the unit page's own words, at both ends of its range (first Mana node
  and all six; leader skills before and after awakening). Lines with the same conditions and trigger are one sentence
  with their effects joined by "&" ("& " between lasting effects, "&" between timed ones), as the game does; a new
  trigger starts a new paragraph. "When a battle starts," is written for one-off effects (Skill Gauge, Fever gauge),
  not for lasting ones (attack, HP). Example: e.g. "When this unit is a/the ⟨Water⟩ unit → 6 seconds have
  passed → +50 Combo". It's built from the game's own English text pieces (the UI string table) filled in the way the
  client does; 92% of CN's 4,928 ability and leader lines are covered, and all of Amelia's lines matched her unit page on the emulator word for
  word (elements show as ⟨Water⟩ where the game draws an icon). Lines it can't word yet (skill switching,
  multiball groups, unit-specific buffs) say so, and a tick box there, **Use the editor's wording where the game's
  can't be shown**, puts the editor's own sentence for that line in its place (marked "(editor's wording)"); the unit
  page shows the game's text after saving either way.
- **Numbers tab**: HP/ATK at Lv 1/10/80/100, the skill gauge (skill and Skill+), and every min → max pair of every
  line (the same values as the Abilities tab).
- **Details tab**: name, title, description, leader skill name, **class** and **role**. Class (Swordsman, Fighter,
  Deadeye, Support, Special) also picks the unit's Power Flip attack and counts for abilities that target a class;
  role (Attacker, Tank, Healer, Supporter, Jammer, Balance) is a label, icon and list filter only. No stat depends on
  either (client: SpecialityTypeTools, StanceLogic). The story, codex and other screens keep their own text.

**Min → max**: abilities go from their first Mana node to the sixth (the game fills the steps between in a straight
line; with no nodes the ability is off); leader skills from before to after awakening; the skill gauge from skill
level 1 to the highest. Numbers are shown in plain units (%, seconds, points, combo); the tables store them
× 100,000, and the editor converts both ways. An effect whose unit isn't known shows its stored number,
"(game value)".

Not editable here: what a skill does (its damage is in the skill's script, a file), skill text (the game writes
ability text itself from the rows, so it always matches), element and rarity (the server keeps its own copy), Mana
Board costs.

## Sharing kits

**Edited units and kits** (top of the page) lists every unit the editor changed. **Download** one, the ticked ones,
or all: one JSON file with their changes. It is itself a unit change file, so it works two ways: **Import a kit file**
on this page (each unit's changes become its editor file, after the same checks as saving; a kit for a unit that
doesn't exist, rows of another unit, or a line the game can't read is refused), or drop it into the custom units
folder's `changes/`. Custom units' changes are in their own files and aren't listed.

## The guard rails

- **Default mode** offers only the triggers CN's own units use (every CN unit's 4,928 ability and leader lines):
  their triggers, conditions, condition + trigger pairs and "who" choices. **Any effect goes with any of these
  triggers, with no warning**: the game fires the trigger, then applies the effect the same way whatever fired it
  (tested: "every X seconds" + "combo +", a pair no CN unit has, worked in battle).
- **Advanced mode** (the Mode picker) keeps to the conditions, triggers, "who" and effects CN's units use, in any
  combination: e.g. "not in Fever" with "while this unit has attack up" or "while a multiball is out", which no CN unit
  pairs. Such a line gets a note ("Not used together by CN's units"), not a block.
- **Unrestricted mode** also offers the conditions, triggers, "who" and effects CN never uses (marked "untested").
  Those show "Unused trigger / condition / effect: may not work or crash the game." Triggers are what decides whether a
  line works. (The mode is remembered in the browser.)
- **Unit-specific buffs** ("Energy Drain", "Cursed"...: 19 in CN, each tied to its unit) can only be used by a unit
  whose own kit uses them; a line that names another unit's buff is refused in both modes.
- **Always refused**: contradictions (a condition that rules out the line's own trigger, e.g. "not in Fever" +
  "while in Fever"; the leader being two elements; HP above X and below a lower Y), "for the unit that triggered it" with
  a trigger that has no "who" (e.g. "every X seconds": nobody triggered it; that target isn't offered then), and
  anything the game can't read (an unknown code, a word where a number belongs). Save stays greyed out until they're fixed.

If the unit page shows your text, the game read the row. For a new combination, a quick battle shows whether it
works (the battle code is separate from the description code).

## Saving and getting it into the game

- **Save** writes only the rows that differ from the game's own: for a CN unit
  `assets/custom_units/changes/unit-editor-<id>.json` (a unit change file, [CUSTOM_UNITS.md](CUSTOM_UNITS.md#changing-an-existing-unit));
  for a custom unit, its own file. The server rebuilds the CN game update right away.
- **Close and reopen the game**: it downloads the update at the title screen.
- **Phone only (no PC)**: the editor is also in StarPoint Companion's **Dashboard**. Saving there writes the change
  file on the phone, and the phone rebuilds its own game update.
- **With a PC**: phones get the PC's edits with **Download from PC** (change files always come along). That copy
  replaces the phone's own edits with the PC's, so either edit on one side only, or **Download** a kit on the phone
  first and import it on the PC.
- **Reset unit to game** deletes the editor's change file and rebuilds. Other change files and Balance by Date kits
  for the unit are listed on the page and stay as they are (changes apply on top of a dated kit).

## Armaments

The **Units / Armaments** switch at the top of the page edits armaments (all 436 of CN's) the same way, with the
same guard rails, saving, kits and reset (`/unit-editor?armament=<id>`).

- **Abilities tab**: each of the armament's abilities is an **Effect** (at most **10**, the game's own limit: slots 0-9;
  CN uses up to 10). An effect has up to **3 versions**, each with **From level**: the game uses, per effect, the
  version from the highest armament level reached (e.g. Ukonvasara: + 50 % skill damage from level 3, + 100 % from
  level 5). Two versions can't be from the same level. CN uses at most 2 versions. **In game** shows the whole
  armament at level 1 and at its max level.
- **Numbers tab**: HP/ATK at the levels the game lists (1, and 3 and 5 for most), and every min → max pair. Values
  scale from armament level 1 to its max level (5, or 1 for 51 armaments).
- **Details tab**: name and description.
- **Armaments with only level 1** can't scale: every min must equal its max (the client stops with an error
  otherwise), so the editor refuses a line where they differ.
- Unit-specific buffs work only if the armament's own rows use them, as for units.

Saved as `changes/armament-editor-<id>.json`, with these tables (from the CN 1.8.1 client's parsers):
`master/item/equipment` (name column 1, description 7, max level 8), `master/item/equipment_status`
(`<id>/<level>`: hp, atk) and `master/ability/ability_soul` (one line per effect version: slot, learn level, kind,
then the unit ability layout). The server keeps no copy of armament stats or abilities (`src/lib/equipment.ts` only
stores owner, level, enhancement and stack), so the update alone changes them.

**Tested (2026-11-04, StarPointTest emulator, companion 0.7.4):** change files from the armament editor in the
phone's `custom_units/changes/`; the phone rebuilt its update (1.4.966, both armament tables in it) and the game took
it (7 MB). At max level, Protostar Bident's page read "Protostar Bident (Edited)" and "+ 90 % to attack for this unit"
(was + 70 %), and Infernal Axe's "Infernal Axe (Edited)" and "+ 40 % to HP for multiballs" (was + 20 %). The game's
armament page lists the version reached and tags a later version "Awakening Lv5". The files were then removed
(update 1.4.967, the game's own rows).

## Code

- `scripts/armament_editor.cjs`: the armament side (uses the unit editor's checks and wording);
  `scripts/test_armament_editor.mjs` (`npm test`): its offline test.
- `scripts/unit_editor.cjs`: reading units, the checks, saving. `src/routes/web_api/unitEditor.ts`: its API
  (`/api/unit-editor/...`). `web/pages/unit-editor.html`: the page.
- `assets/unit_editor/ability_codes.json`: every condition, trigger, effect, who and target code with the fields
  (columns) it reads, from the CN 1.8.1 client's own table parser (`scripts/research/ability_codes_from_pcode.cjs`;
  the research is [research/ability-triggers.md](research/ability-triggers.md)).
- `assets/unit_editor/words.json`: plain words, and which effects are percentages or on the base scale.
- `scripts/unit_editor_text.cjs`: lines in the game's own words (a copy of the game's template engine, and its
  wording rules for the common triggers, conditions and effects).
- `scripts/test_unit_editor.mjs` (`npm test`): offline test.

## Tested (2026-11-03, StarPointTest emulator, companion 0.6.24 server)

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
