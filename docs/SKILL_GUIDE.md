# Making a skill with the Skill tab

> 中文版：[SKILL_GUIDE.zh-CN.md](SKILL_GUIDE.zh-CN.md)

> Written by Claude (AI) in a Claude Code session, with the repository owner choosing how it works.

The Unit editor's **Skill tab** (dashboard → **Unit editor** → pick a unit → **Skill**) lets you change what a unit's
skill does: where it hits, how hard, what it looks like, and what buffs it gives. This page is a beginner's guide:
what a skill needs, what's optional, what can go wrong, and some recipes to copy. Every button and setting of the tab
is listed in [UNIT_EDITOR.md](UNIT_EDITOR.md#skill-tab).

**You can see how a skill will look before you save.** **▶ Preview skill** plays it on the dashboard: the
unit's pose, the effects, where each area hits, and the hits on a pretend target. The numbers (how much damage
it really does, how buffs add up in a fight) can only be tested by playing it in the game.

**You can't break your save by trying things.** **▶ Preview skill** plays your skill before you save, the editor
refuses to save anything the game can't read, and **Reset to game** puts the unit's own skill back.

"Tested" below means seen working in a battle; anything not tested says so.

## Two things to know first

- **Time is counted in frames: 60 frames = 1 second.** So 120 = 2 seconds, and 720 = 12 seconds.
- **A skill is a list of commands, run from top to bottom.** When a unit uses its skill, the game first plays its
  usual skill pose, flash and cut-in picture and holds the ball for 1 second, all by itself. Then it runs the list.
  The Skill tab edits only that list; the pose, cut-in picture and voice stay the unit's own.

(Only if you place things by hand: positions use the battle's own units. The field is about 1500 wide and 2000 tall,
and a positive Y number means further **down** the screen.)

## The smallest skills

- **A skill that does nothing** is fine: the gauge empties, the cut-in plays, nothing else happens. CN's game has
  one like this itself.
- **A skill that hits** needs one command: an **Attack area** with a **Damage** inside it. Press **+ Add… → Attack
  area**: it comes ready to use, with a round area, an effect to show it, and a Damage inside. Tested.
- **A skill that buffs** needs one command too: a **Buff / debuff** on "the unit". To buff the whole party, put it
  inside a **Find a group** set to "the party", with the buff's target set to "the group". Tested.

What a ready-made Attack area looks like in the list:

```
Attack area            where it hits: shape, size, place, how long, how often
  when it appears:
    Effect             the picture you see (optional: the area hits without it)
  on each hit:
    Damage             what each hit does to the enemy
```

## The building blocks

| Command | Needed? | What it does |
|---|---|---|
| **Attack area** | to hit anything | The zone that hits. A **Circle** (radius), **Rectangle** (width × height) or **Sector**, a fan shape (radius and angle). You can't see it by itself. |
| **Damage** (inside an area's "on each hit") | for damage | How hard each hit is (a low and a high number, by skill level), its element (the unit's own is safest), break-gauge damage and Fever gained. Its **hit effect** is just the spark on the enemy: "None" still does full damage. |
| **Effect** | no | An animation. Put it in an area's "when it appears" to show where the area hits. |
| **Stop the ball** | no | Holds the ball still while the skill plays. Most of CN's skills start with it; without it the ball keeps moving. |
| **Wait**, **Repeat** | for timing | **Wait** runs what's inside it after some frames. **Repeat** runs what's inside right away, then again every so many frames, a set number of times. |
| **Buff / debuff** | no | Attack up, damage up, resistances and so on, on the unit, the party or the enemy that was hit. |
| **Camera shake**, **Heal**, **Fever / skill gauge** | no | What their names say. |

## When things happen

There's no separate "when" setting: **where a command sits in the list decides when it runs**, and inside a Find or
an area, also **who** it acts on. Commands at the top level run as soon as the skill starts (after the 1-second
cut-in). Commands inside other commands run later, or more than once:

| Put the command... | It runs | Example with a Buff / debuff |
|---|---|---|
| at the **top level** | once, as the skill starts | buff the unit as the skill fires |
| inside a **Wait** | once, that many frames later | a buff that lands after the attack |
| inside a **Repeat** | again and again: right away, then every so many frames | a buff given several times (it stacks, up to its max stacks) |
| in an Attack area's **when it appears** | once each time an area appears (5 areas: 5 times) | rarely used for buffs; mostly for effects |
| in an Attack area's **on each hit** | every time the area hits an enemy, once per enemy | a debuff on **"the hit target"**: only enemies the area touches get it |
| inside **Find a group** / **Find the nearest** | once for each one it found | buff every party member; debuff the nearest enemy |
| inside **If HP ≥ X %** / **If in Fever** | only if that's true at that moment (otherwise the other branch runs) | Clara's skill: attack up when her HP is 60 % or more, a shield and heal when it isn't |
| inside **Random pick** | one of its options, picked at random | a random bonus |
| inside **When the ball hits** | each time the unit's ball hits an enemy, for a while | a debuff on each enemy the ball touches |

## Buffs and debuffs: the settings

A **Buff / debuff** command has these settings. Some show the game's own names, given here in brackets.

- **target**: who gets it. "the unit", or, depending on where the command sits, "the group" (inside a Find) or "the
  hit target" (inside "on each hit").
- **conditions**: which buff, and its numbers. For example attack up (`ACAttackPoint`) has **frames** (how long it
  lasts: 720 = 12 seconds), **amount** (0.4 = +40 %; a negative number lowers it) and **max stacks**. You can give
  several at once.
- **chance it lands**: 1 = always.
- **given again even if it's already on**: off = a second copy does nothing while the first lasts; on = it stacks, up
  to max stacks.
- **can be removed**: whether skills that clear buffs can take it off.
- **who it may go to**: a unit, the party, or either. Keep the value it came with: a wrong one makes the game error.

Two examples:
- **Debuff every enemy the slash touches, once:** Attack area → "on each hit" → Buff / debuff, target **the hit
  target**, "given again" off.
- **Buff the unit each time the area hits:** the same place, but target **the unit** and max stacks above 1.

## Step by step

1. **Pick the unit** and open **Skill**. Start from its own skill, or press **Start from another unit's skill** to copy
   one.
2. **Add an Attack area** (**+ Add…** at the end of the list). Set its **shape and size**, **where** it is (attached
   to the unit or to its ball, and how far from it), **how long it lasts** and the **time between hits**.
3. **Pick its effect.** In the Effect card, the effects that fit the area's shape are listed first; **▶ View effect**
   plays one. Leave **Keep effects in step** on, so the picture matches the area's size.
4. **Set the Damage**: its low and high numbers, and its hit effect.
5. Optional: **Stop the ball** first, **Wait**s for timing, buffs, or a **Repeat** for a rhythm.
6. Press **▶ Preview skill** to watch it: the unit's pose, the effects, the outlines of where it hits, and the hits on
   a pretend target.
7. **Save.** It won't save while there are red notes; fix those first. Then close and reopen the game: it downloads
   the update at the title screen.
8. **Check both Skill and Skill+.** They're separate: changing one leaves the other as it was. The skill gauge is in
   the **Numbers** tab.

## Recipes

**One big blast around the unit:** Attack area, Circle, radius 250, attached to the unit's ball, lasting 40 frames,
hitting once (`CalculatedUsingMaxNumOfHits` 1). Effect *air blast* (Keep effects in step sets its scale: 5). Damage
from 5 to 10, hit effect Coarse.

**A slash in front of the ball:** Attack area, Rectangle 300 × 120, facing the way the ball moves (direction EF),
moved 150 ahead (offset Y −150). Effect *claw horizontal* at scale 1.5.

**Bursts every 20 frames for 5 seconds, at random angles:** a Repeat (every 20 frames, 15 times) → inside it a Random
pick with four options (Weight 1 each), each an Effect turned 0°, 90°, 180° and 270°. For the damage, add an Attack
area that lasts 300 frames and hits every 20 frames, so the hits keep pace with the bursts.

**Buff the whole party:** Find a group, set to "the party" → inside it a Buff / debuff on "the group": attack up
(`ACAttackPoint`), frames 720, amount 0.3 (+30 %), max stacks 1.

**Summon another unit's multiball:** **+ Add… → CreateSummonsMultiball**, then put a multiball's number in its second
setting. A multiball's number is its unit's number plus one digit (Gold Ship 113001 → 1130011; Marnie 311002 →
3110021, 3110022, 3110023). Every one CN has is listed in [research/skill-commands.md](research/skill-commands.md). The
third setting is how long it stays (9000 frames = 150 seconds in most CN skills). Tested: Clara summoned another
unit's multiball and it played. Not checked: whose stats it uses. The preview doesn't show multiballs.

## Things to watch out for

**These can make the game error, so avoid them:**
- **The hit effects Fine, Coarse, Slash and Critical slash with element "none".** These four have no colourless
  version, and the game stops with an error if a hit has no element. Keep the Damage's element on **the unit's own**,
  or on a real element, when you use them. (Whether "none" counts as no element isn't tested: just avoid the
  combination.)
- **Commands CN's skills never use** (only offered in Unrestricted mode, marked "untested"): they may do nothing, or
  crash the game.
- **Hand-edited ids** (Advanced and Unrestricted modes): an id is the name a command gives to "the area", "the hit
  target" or "the group" so that commands inside it can point at it. The editor won't save one that nothing names; in
  Default mode they're hidden, so this can't happen there.

**These are fine, but surprise people:**
- **The picture and the hit are separate.** Making an effect bigger doesn't make the area hit more, and the other way
  round. Keep effects in step (on by default) sizes the picture to the area, and the "Drawn:" line under an area warns
  when they don't match. No shared effect is fan-shaped, so on a Sector the picture looks round.
- **Most effects play once.** Showing one for longer doesn't repeat it: it plays once and it's gone. To repeat a burst,
  put the Effect in a **Repeat**, or in the area's "on each hit". (A few effects loop, such as whirlwind slash: those
  keep playing as long as they show.)
- **The hit effect is often most of what you see.** An area that hits every 20 frames shows its hit effect on every
  enemy, every hit (tested: Coarse, 15 times over a 5-second area).
- **The skill's name and description don't change by themselves.** The unit page still describes the old skill until
  you change the **Name** and **Description** boxes at the top of the skill on the Skill tab.

## On phones, and sharing

- **PC:** saved skills go into the game update the server builds. Close and reopen the game to get it.
- **Phones:** a phone copying from your PC (**Download from PC**) gets the skills too. A phone's own server needs
  **StarPoint Companion 0.8.92 or newer** to send edited skills to the game.
- **Kits:** a downloaded kit carries the unit's skills; importing it puts them back.

## More

- Every command and setting: [research/skill-commands.md](research/skill-commands.md).
- Effects, how they're placed, and their files: [research/skill-effects.md](research/skill-effects.md).
