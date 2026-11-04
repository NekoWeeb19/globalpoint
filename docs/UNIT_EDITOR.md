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

  Lines can be removed, added, or copied from any other unit. **Reset to game** on an ability gives its own lines back.
- **Numbers tab**: HP/ATK at Lv 1/10/80/100, the skill gauge (skill and Skill+), and every min → max pair of every
  line (the same values as the Abilities tab).

**Min → max**: abilities go from their first Mana node to the sixth (the game fills the steps between in a straight
line; with no nodes the ability is off); leader skills from before to after awakening; the skill gauge from skill
level 1 to the highest. Numbers are shown in plain units (%, seconds, points, combo); the tables store them
× 100,000, and the editor converts both ways. An effect whose unit isn't known shows its stored number,
"(game value)".

Not editable here: what a skill does (its damage is in the skill's script, a file), skill and unit text (the game
writes ability text itself from the rows, so it always matches), Mana Board costs.

## The guard rails

- **Default mode** offers only what CN's own units use (every CN unit's 4,928 ability and leader lines): their
  triggers, conditions, condition + trigger pairs and "who" choices. Any effect goes with any trigger; when CN never
  pairs them, the line shows "The game has not seen this combination before. It may or may not work."
- **Advanced mode** (tick box) offers every kind the game can read. Anything CN doesn't use shows
  "Untested: … May lead to crashes."
- **Always refused**: contradictions (a condition that rules out the line's own trigger, e.g. "not in Fever" +
  "while in Fever"; the leader being two elements; HP above X and below a lower Y), and anything the game can't read
  (an unknown code, a word where a number belongs). Save stays greyed out until they're fixed.

If the unit page shows your text, the game read the row. For a new combination, a quick battle shows whether it
works (the battle code is separate from the description code).

## Saving and getting it into the game

- **Save** writes only the rows that differ from the game's own: for a CN unit
  `assets/custom_units/changes/unit-editor-<id>.json` (a unit change file, [CUSTOM_UNITS.md](CUSTOM_UNITS.md#changing-an-existing-unit));
  for a custom unit, its own file. The server rebuilds the CN game update right away.
- **Close and reopen the game**: it downloads the update at the title screen.
- **Phones** get it with **Download from PC** in StarPoint Companion (change files always come along). Edit on the
  PC: a phone's own copy is replaced by the PC's at each copy.
- **Reset unit to game** deletes the editor's change file and rebuilds. Other change files and Balance by Date kits
  for the unit are listed on the page and stay as they are (changes apply on top of a dated kit).

## Code

- `scripts/unit_editor.cjs`: reading units, the checks, saving. `src/routes/web_api/unitEditor.ts`: its API
  (`/api/unit-editor/...`). `web/pages/unit-editor.html`: the page.
- `assets/unit_editor/ability_codes.json`: every condition, trigger, effect, who and target code with the fields
  (columns) it reads, from the CN 1.8.1 client's own table parser (`scripts/research/ability_codes_from_pcode.cjs`;
  the research is [research/ability-triggers.md](research/ability-triggers.md)).
- `assets/unit_editor/words.json`: plain words, and which effects are percentages or on the base scale.
- `scripts/test_unit_editor.mjs` (`npm test`): offline test.

## Tested (2026-11-03, StarPointTest emulator, companion 0.6.24 server)

Amelia (221003) ability 1 edited in the editor to "if this unit is Water: every 6 → 1 s → combo +50 → 100" (a
combination no CN unit has: the "not seen before" notice) and Lv 80 HP 3000. The change file went into the companion's
`custom_units/changes/`; the server rebuilt by itself (update 1.4.960, both rows in it); the game took the 7 MB
update. Her unit page showed the line in the game's own words ("When this unit is a/the ⟨Water⟩ unit → 6 seconds have
passed → +50 Combo", locked until her Mana node), and in a quest battle with the node learned the combo jumped by 50
every few seconds (108 combo 11 s in). Not tested yet: a custom unit's edit, a phone getting it by Download from PC.
