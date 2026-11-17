# Making a skill with the Skill tab

> Written by Claude (AI) in a Claude Code session, with the repository owner choosing how it works.

A practical guide to the Unit editor's **Skill tab** (dashboard → **Unit editor** → a unit → **Skill**): what a skill
needs to work, what's optional, what can break, and a few recipes. How the tab itself works (every button, the modes,
saving) is in [UNIT_EDITOR.md](UNIT_EDITOR.md#skill-tab). "Tested" below means seen working in battle on the emulator;
"from the client" means read in the CN 1.8.1 game code; anything else is marked.

## What a skill is

When a skill fires, the game does three things by itself, whatever the script says:

1. the unit's sprite plays its **skill pose** (`skill_ready`), a **skill flash** shows at the unit, and the **cut-in**
   picture appears;
2. the ball holds for **60 frames** (1 second);
3. then it runs the skill's **script**: a list of commands, top to bottom.

The Skill tab edits only step 3. The pose, cut-in and voice are the unit's own files and stay as they are.

Times are in **frames: 60 = 1 second**. Positions are in battle units (the field is about 1500 wide and 2000 tall);
**positive Y is down** the screen.

## The minimum

**A skill that does nothing at all is valid.** An empty script doesn't crash: CN itself has one
(`battle/action/skill/action/empty`). The gauge empties, the cut-in plays, nothing happens. (An emptied Skill+ is
exactly this.)

**The smallest skill that hits is one command:** an **Attack area** with a **Damage** in its "on each hit". In the
editor: **+ Add… → Attack area**. It comes ready (CN's most common attack area): a round area with a blast effect on
it and a Damage inside. Tested: an area like this, attached to the unit, with no Stop the ball, hit and damaged
enemies.

```
Attack area            the zone that hits: shape, size, where, how long, how often
  when it appears:
    Effect             the picture (optional: the area hits without it)
  on each hit:
    Damage             what a hit does to the enemy hit
```

**The smallest buff skill is one command:** a **Buff / debuff** on "the unit" (or a **Find a group** → the party, with
the buff inside on "the group"). Tested: attack up on the unit showed and applied.

## The parts, and what's optional

| Part | Needed? | What it's for |
|---|---|---|
| **Attack area** | to hit anything | The hit zone: Circle (radius), Rectangle (width × height) or Sector (a fan: radius + angle). Invisible on its own. |
| **Damage** (in the area's "on each hit") | for damage | Damage multiplier (low → high by skill level), element (the unit's own is safest), break-gauge damage, Fever gained. Its **hit effect** is only the spark on the enemy; "None" still does full damage. |
| **Effect** | no | The animation. On an area ("when it appears", attached to the new area) it shows where the area hits. |
| **Stop the ball** | no | Holds the ball while the skill plays (most CN skills start with it). Without it the ball keeps moving. |
| **Wait / Repeat** | for timing | Wait N frames then run what's inside; Repeat runs what's inside right away, then every N frames, M times. |
| **Buff / debuff** | no | Attack up, damage up, resistances... on the unit, the party or the enemy hit. |
| **Camera shake, Heal, Fever / skill gauge** | no | As named. |

## What can break a skill

The checker (red "Can't save" notes) refuses anything the game can't read, so a saved skill always *loads*. These are
the things that can still go wrong:

- **Fine, Coarse, Slash and Critical slash hit effects with element "none".** These four have no colourless art; the
  client stops with an error (ClientError 10013, from the client) if the hit's element is colourless. Keep Damage's
  element on **the unit's own** (always a real element) or a real element when using them. *(Whether "none" counts as
  colourless isn't tested; avoid the combination.)*
- **An id nothing named.** Ids are how commands inside an area or a Find point at "the area", "the one hit", "the
  group". The checker refuses an id nothing above has named; in Default mode the ids are hidden, so this only comes up
  when editing them by hand (Advanced/Unrestricted).
- **Commands CN's skills never use** (Unrestricted mode, marked "untested"): they may do nothing, or crash.
- **Skill and Skill+ are separate scripts.** Editing one leaves the other as it was; check both.

Things that **don't** break anything but surprise people:

- **The picture and the hit are separate.** An Effect's scale doesn't change what hits, and an area's size doesn't
  change the picture. "Keep effects in step" (on by default) sizes the effect to its area; the "Drawn:" line under an
  area warns when they differ. **No shared effect is fan-shaped**: on a Sector, the picture will look round.
- **Most effects play once.** 1,084 of the effects CN uses have no loop: showing one for longer doesn't repeat it, it
  plays once and is gone. To repeat a burst, put the Effect in a **Repeat**, or in the area's "on each hit". (The 219
  with a loop, e.g. whirlwind slash, loop for as long as they show.)
- **The hit effect is often most of what you see.** A long area that hits every 20 frames plays its Damage's hit
  effect on every enemy, every hit (tested: Coarse, 15 times over a 5-second area).
- **The skill's text doesn't change.** The unit page still describes the old skill (name and description aren't
  editable yet).

## Step by step

1. **Pick the unit**, open **Skill**. Start from its own skill, or **Start from another unit's skill** to copy one.
2. **Add an Attack area** (+ Add… at the end of the list) and set its **shape and size**, **where** (attached to the
   unit or its ball, offset; direction AB = fixed up the screen, EF = the way the ball moves), **how long it lasts**
   and **time between hits**.
3. **Pick the effect** on it (the Effect card's effect box suggests the ones that fit the area's shape first;
   **▶ View effect** plays it). Leave "Keep effects in step" on.
4. **Set the Damage**: multiplier low → high, hit effect.
5. Optional: **Stop the ball** first, **Wait**s for timing, buffs, a **Repeat** for rhythm.
6. **▶ Preview skill** to see it play (the unit's pose, the effects, the hit outlines, hits on a pretend target).
7. **Save** (no red notes). Then close and reopen the game: it downloads the update at the title screen.
8. **Check both Skill and Skill+**, and the skill gauge in the **Numbers** tab.

## Recipes

**One big blast around the unit:** Attack area, Circle radius 250, attached to the unit's ball, lasts 40 frames,
CalculatedUsingMaxNumOfHits 1; effect *air blast* (scale fits itself: 5); Damage multiplier 5 → 10, hit effect Coarse.

**A slash in front of the ball:** Attack area, Rectangle 300 × 120, direction EF (the way the ball moves), offset Y
−150 (ahead); effect *claw horizontal* (it's drawn for a 200 × 80 rectangle per 1 scale, so scale 1.5).

**Bursts every 20 frames for 5 seconds, at random angles:** Repeat (20 frames between, 15 times) → Random pick →
four options (Weight 1 each), each an Effect at rotation 0°, 90°, 180°, 270°. Put the Damage in a long Attack area
(300 frames, hits every 20 frames) so the hits keep pace.

**Buff the whole party:** Find a group → which group "the party" → inside it, Buff / debuff on "the group": e.g.
ACAttackPoint frames 720, amount 0.3 (+30 %), max stacks 1.

## Sharing and other devices

- **PC:** saved skills go into the CN game update the server builds; close and reopen the game.
- **Phones with Download from PC:** the scripts come along. A phone's *own* server only ships them with a companion
  app built after the Skill tab (until then, phones get edited skills through the PC's server).
- **Kits:** a downloaded kit carries the unit's skill scripts; importing it writes them back.

## More

- Every command and setting: [research/skill-commands.md](research/skill-commands.md).
- Effects, how they're placed, their files and animation format: [research/skill-effects.md](research/skill-effects.md).
