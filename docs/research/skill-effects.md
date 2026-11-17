# Skill effects: shared and unit-only (research, 2026-11-16)

> [!IMPORTANT]
> ## 🤖 Written by AI
> This research and write-up were done by **Claude** (Anthropic's AI) in a Claude Code session. The facts come from
> the game's own files: every CN skill script (`master/skill/action_skill` column 7, `*.action.dsl`) was read and
> each effect it shows was listed. The plain descriptions of the effects come from their file names and the game's
> own (Japanese) labels for them; they were not each watched in game.

Why: a new unit (for example one of the cut units, see [new-units.md](new-units.md)) needs a skill. The easy way
is to borrow one that already exists, and whether that needs new art depends on the effects the skill shows.

## How a skill is put together

- **The skill script** (`battle/action/skill/action/<rarity>/<unit>$<unit>_1` for the skill, `_2` for Skill+) holds
  what the skill does (damage areas, buffs, heals, branches such as "HP at or above 60%") and the **effects** it
  shows (`ShowEffect`). It never names the unit's own sprite.
- **Effects** live in two places:
  - `battle/effect/skill_general/...`: **shared**, used by many units. Almost all are drawn in the unit's element
    colour (`ResolveByElement`); a few long-range ones have one fixed colour (`SpecifyEffectDirectly`).
  - `battle/effect/skill_unique/<unit>/...`: drawn **for one unit** (e.g. Hidden Blader's knives). Borrowing such
    a skill shows that unit's art.
- **The unit's own sprite** comes in through the game, not the script: its `skill_ready` sequence (the wind-up,
  Clara: 4 drawings held over 48 frames), the skill cut-in picture (`ui/skill_cutin_0/1`, plus an `.atf` copy
  for battle) and the skill voice. Some units also have a separate `pixelart/special` animation; Clara has none.
- A skill can show **several effects**, each at its own moment: of the skills with only shared effects, 35 show 1,
  36 show 2, 12 show 3 and one shows 4 (typically a glow on the unit, then the attack: Folus = charge, thrown ball,
  blast where it lands). 29 skills mix shared effects with their own unit-only art.

## Where an effect's files are

"In the element's colour" isn't a tint: every shared effect has a **ready-made copy per element**. The client
(`EffectTools.resolveEffectByElement` / `createPathFromElementSuffix`) builds the path as

```
<effect>/<name>_<colour>/<name>_<colour>      e.g. battle/effect/skill_general/area/whirlwind_slash/whirlwind_slash_green/whirlwind_slash_green
```

with `<colour>` = `red` (Fire), `blue` (Water), `yellow` (Thunder), `green` (Wind), `white` (Light), `black` (Dark)
or `colorless`. A fixed-colour effect (`SpecifyEffectDirectly`) is used at its own path. Each copy is 4 files:

| File | What it is |
|---|---|
| `.png` | the sprite sheet: the effect's art pieces (the game stores it with a scrambled signature, `\x89png`: put `PNG` back to open it) |
| `.atlas.amf3.deflate` | where each piece is on the sheet |
| `.parts.amf3.deflate` | the animation: the pieces, and how they move, scale, turn and fade on every frame |
| `.timeline.amf3.deflate` | the named sequences (e.g. spread: `neutral` 1-40, then `end` 41-68) and the sounds |

Unit-only effects (`skill_unique/...`) are found the same way at their own path (Hidden Blader's throw:
`.timeline` and `.parts`), but **their pictures are one sheet per folder**: `skill_unique/<unit>/<unit>.png` and
`.atlas` (e.g. `wind_oracle_1anv/wind_oracle_1anv`), named by the effect's images (`<folder>/.gen/<effect>/a`).
Because file names are hashed, a folder can't be listed: a file is found by its exact name only.

**The unit's own sprite** (for the skill pose): `character/<unit>/pixelart/sprite_sheet.png` and `.atlas`, plus
`pixelart.timeline` (sequences: `neutral`, `walk_back`, `walk_front`, `skill_ready`, `kachidoki`, `into_coffin`,
`ghost_raise`, `ghost_neutral`, `revive`; the body circle; the HP gauge point). A frame animation: images
`pixelart0051`..., each in a 256 × 256 frame; frame *f* shows the first image numbered *f* or later
(`flatomo.animation.frame.FrameAnimationSource`). In battle it's drawn × 6 (`BattleConstants.SCALE_RENDERER`). When a
skill fires, the sprite plays `skill_ready` with a skill flash and the cut-in (`MemberImpl.startSkillCutinAnimation`),
the ball holds 60 frames (`BallImpl.startToSkillCutin`), then the script runs.

### How an effect's animation is stored (`.parts`)

Read from the CN 1.8.1 client's own player (the `flatomo.animation.parts` package: `PartsAnimationSource`,
`GraphicsSource`, `PartsAnimationImageProvider.moveImage`, `LayoutTools.apply`, `CustomTweenRecord`) and ported to
`web/public/js/parts-player.js`, which the unit editor's effect viewer uses. Checked by eye against the game
(Clara's whirlwind slash, the spread blast).

- **`t`**: matrices `{a, b, c, d, x, y}` in fixed point, 4096 = 1.0.
- **`i`**: the images, by atlas name. **Atlas** frames: `x, y, w, h` on the sheet; `r: true` = stored turned 90°
  clockwise (`w × h` is the turned size); `fx, fy, fw, fh` = trimmed (the pixels sit at `-fx, -fy`). The image's
  origin is its untrimmed top-left; effects are drawn around (0, 0).
- **`g`**: graphics; `g[0]` is the effect. Each has `t` (frames) and `s` (segments, drawn in order). A segment's
  `s` = kind `<< 30` | start frame (kind 0 an image, 1 a movie, 2 another graphic), `i` = the image or graphic, `l` =
  its keys, one after another:
  - `t` = duration (low 16 bits) | tween `<< 16` (0 none, 1 a custom curve from `c`, 2 ease in/out by N %) | easing
    value `<< 18`; between keys, the matrix, alpha and colour go from one key to the next along the curve.
  - `m` = matrix index `<< 12` | blend mode `<< 8` (0 normal, 1 add, 2 multiply, 3 overlay, 4 screen) | alpha (0-255).
  - `c` = colour: multiplier % `<< 24` | red, green, blue offsets (default `0x64000000`: 100 %, no offsets).
  - `r` (a graphic): loop kind `<< 30` | its start frame (0 hold that frame, 1 play once, 2 loop).
- A nested graphic's matrix, alpha and colour multiply into its parent's.
- **`c`**: custom easing curves, six numbers per cubic Bezier segment (control 1, control 2, end), × 1,000,000.
- Drawn size against what hits: the editor measured each shared effect's size per scale from CN's own skills
  (e.g. air_blast radius 50 per scale); the pictures reach a little past that (air_blast's burst is about 1.5 × the
  hit radius).

## How an effect is placed (`ShowEffect`)

The skill script places every effect itself. `ShowEffect` has 12 settings (client: `ActionDslCommand.ShowEffect`,
used in `ActionEvaluator` and `ActionEffect`):

| # | Setting | What it does |
|---|---|---|
| 1 | label | a name for the effect (Japanese, e.g. 斬撃大 "big slash"); the script can hide it again by this name |
| 2 | effect | the file (`ResolveByElement` + path, or `SpecifyEffectDirectly` + path) |
| 3 | attached to | a subject number from the script: the unit, an attack area the skill made, a shot, an enemy... |
| 4 | layer | drawn in front of or behind the units (e.g. `ForesideOfCharacter`) |
| 5 | lifetime | how long it shows (e.g. `UntilTargetTerminates`: until what it's attached to is gone) |
| 6 | coordinate system | which way is "forward" for the effect (below) |
| 7, 8 | offset X, Y | moves it away from what it's attached to, along that "forward" (the offset turns with the direction) |
| 9 | rotation | turns it a bit more, on top of the direction |
| 10 | follow position | keeps following the target as it moves (or stays where it appeared) |
| 11 | follow direction | keeps turning with the target |
| 12 | scale | how big it's drawn (optional) |

The coordinate systems (`ActionEffect.calcDir`; the script's rotation is added on top):

| | "Forward" is |
|---|---|
| `AB` | straight up on the screen: the effect never turns (round effects) |
| `EF` | the way the target is moving: a unit's ball's flying direction, an attack area's travel |
| `CD` | an attack area's own rotation (attack areas only: on a unit or a ball the game stops with an error) |
| `GH(other)` | from the target toward another subject, e.g. from the unit at the nearest enemy |

Position = what it's attached to + the offset turned by that direction (`ActionEffect.stepPos`).

**Example, Clara's whirlwind slash** (`junior_yearngirl_1`, at 60% HP or more): the script makes a round attack
area (radius 200, centred, 80 frames) and shows `area/whirlwind_slash` on it: attached to that area, `AB` (round, so
it doesn't turn), offset 0, 0, rotation 0, follow position and direction on (it moves with her ball), scale 4, in
front of the units, until the area ends. A slash in front or a dash aura would use `EF`, to point the way the ball
flies.

A borrowed skill brings all these settings along. A new skill (written from scratch) chooses them per effect.

## Blueprint: a skill for a new unit

What a working skill is made of, and what each way of getting one needs. "Borrowed" = point the new unit at an
existing skill's script (how the test unit in [new-units.md](new-units.md) was made); "new" = a script written for it.

| Piece | Where | Borrowed skill | New skill |
|---|---|---|---|
| Script: skill `_1` and Skill+ `_2` | `battle/action/skill/action/<rarity>/<unit>$<unit>_1` / `_2` (`.action.dsl`) | reused as it is | written: gameplay, effects and their placement (below) |
| Effect art | shared (`skill_general`, every element ready) or the unit's own (`skill_unique`) | comes along | shared: free; own: new art (4 files per colour, see above) |
| Skill rows (skill and Skill+) | `master/skill/action_skill` | copied, then renamed | name, description, skill icon type (column 2, e.g. `dynamic/skill/atk_surround`), gauge cost (columns 4, 5), script path (column 7) |
| Description | column 1 of the skill row | hand-written: the game doesn't build it from the script | must say what the script does |
| Wind-up pose | the unit's `pixelart` timeline, sequence `skill_ready` | the new unit needs its own | same |
| Skill cut-in | the unit's `ui/skill_cutin_0/1` (`.png`, plus `.atf` for battle) | the new unit needs its own | same |
| Skill voice | the unit's `voice/battle/skill_*` | optional (no script plays sounds) | optional |
| `pixelart/special` animation | the unit's pixelart | only if the source unit has one | only if wanted |
| Skill preview | the unit's `battle/character_detail_skill_preview` and `character_info_skill_preview` (`.battle`, a recorded input) | copy the source unit's | reuse one (it then shows that recording's movement) or record one; with none the unit page reports a missing file |
| Skill+ upgrade | the unit's Mana Board evolution node | points at `_2` | same |

**Writing a new script** is the real work. The script is mostly gameplay; the effects are the paint on it:

- **Attack areas** (`CreateHitArea`, `MoveHitArea`, `RotateHitArea`): shape (circle, arc, donut...), size, alignment,
  how long they last, how many hits, and what they do when they hit (`CreateNormalAttack` = damage).
- **Buffs, debuffs, heals** (`CreateCondition`, `DeleteCondition`, `CreateRatioHeal`, `CreateBarrier`...) and who
  gets them (`FindAllSubjects`, `FindNearSubjects`, `TargetMate`).
- **The ball** (`StopBall`, `MoveBall`, `HideCharacter`, `StartPiercing`) and the camera (`ShakeCamera`).
- **Branches** (`ConditionalsHealthPointRatio` = Clara's "60% HP or more", `ConditionalsFeverMode`,
  `ConditionalsMultiballNumber`, `IfThisCharacterIsLeader`...).
- **Effects** (`ShowEffect`, `HideEffect`) with the placement settings above.
- **Skill level scaling**: almost every number is a `{min, max}` pair, skill level 1 to max (Clara's attack-up is
  `{720, 720}`: it doesn't scale). Skill+ is usually the same script with better numbers.

The commands CN's unit skills use, by how many skills use each (from the scan):

| Command | Skills | Command | Skills |
|---|---|---|---|
| `ShowEffect` | 952 | `CreateRatioHeal` | 143 |
| `CreateCondition` | 775 | `DeleteCondition` | 126 |
| `CreateHitArea` | 773 | `HideCharacter` | 109 |
| `CreateNormalAttack` | 755 | `ConditionalsChangeSkillFlag` | 54 |
| `ShakeCamera` | 668 | `HideEffect`, `AddFeverPoint` | 49 each |
| `StopBall` | 658 | `RemoveEvent` | 40 |
| `FindAllSubjects` | 564 | `CreateRatioAttack` | 33 |
| `CreateReferencePoint` | 322 | `CreateSummonsMultiball` | 29 |
| `FindNearSubjects` | 255 | `ConditionalsFeverMode` | 26 |
| `MoveHitArea` | 175 | `CreateBarrier` | 21 |
| `MoveBall` | 154 | `AddSkillPoint` | 16 |

Rarer ones (under 16 skills each): `ConditionalsHealthPointRatio`, `AddCombo`, `DecreaseCoffinCount`,
`IfThisCharacterIsBoss`, `ConditionalsRelativePositionVertical`, `CreateReferencePointAtSpecifiedPosition`,
`CreateBombMultiball`, `StartPiercing`, `ConditionalsHealthPointRatioOf`, `TargetMate`, `ConditionalsMultiballNumber`,
`RemoveMultiball`, `BindCoffinRevivalCountVariable(Of)`, `CreateCollider`, `SuppressBallActivity`,
`ConditionalsProbability`, `ProbabilityWeight`, `BindConditionAccumulationVariable`, `IfThisCharacterIsLeader`,
`RotateHitArea`, `ConditionalsSkillPoint200Percent`, `ConditionalsNumCoffins`, `StartModifierField`, `CreateFixedAttack`.
Each command's settings are in the client's `ActionDslCommand` (one function per command, with its parameter types);
**[skill-commands.md](skill-commands.md)** lists every command with each parameter's type, meaning and the values CN's
scripts use.

## Tested: a skill script of our own (2026-11-16, emulator)

Research only (not a GlobalPoint feature). A skill script written by us ran in battle.

**The test skill** (`scripts/research/make_test_skill.cjs`): Clara's script (`junior_yearngirl_1`) with her HP branch
removed, her self attack-up kept (+40 % for 720 frames), the party Power Flip buff removed, and her one round attack
area (radius 200, whirlwind slash shown on it) moved below her: `CreateHitArea` offset Y 120, then 500.

**How it got into the game** (StarPointTest emulator, companion server; the PC's files untouched):
1. The script was written with `scripts/amf3.cjs` (`writeAmf3`, then raw deflate) at a **new** path,
   `battle/action/skill/action/rare3/gp_test_harpy$gp_test_harpy_2`, so no game file was replaced.
2. It was shipped as a CN update numbered above every build on that device (1.4.5000, then 1.4.6000):
   `scripts/build_cn_patch.cjs` with `CDN_DIR` pointing at a scratch folder holding a copy of the device's
   `cn_patches/patches.json`; the zip and the new list entry were then copied onto the device.
3. A change file in the device's `custom_units/changes/` pointed Clara's skill rows (`master/skill/action_skill`
   `junior_yearngirl/1` and `/2`, column 7 `program_path`) at the new script and renamed them ("Test: Harpy Slash").
   The server rebuilt its update on start.
4. Undo: delete the change file (Clara's own rows come back on the next rebuild); the unused script file stays in the
   game's storage and does nothing.

**Results:**
- The unit page showed the new name, and **in battle the whirlwind slash appeared 500 below her** and her attack-up
  icon showed: battles run the script the skill row names (column 7), and a script written by `writeAmf3` (no
  shared references, anonymous objects, so not byte-identical to the game's own packing) is accepted.
- **Positive Y offset = down the screen** (direction `AB`).
- The effect showed in **blue** (Clara is Water): the element copy of the effect is picked by the unit's element.
- Subjects, from the client (`ActionEvaluationResolver`): **`-17` = the unit using the skill**, **`-18` = its ball**,
  `-33` = the party, `-1` / `-2` = the battlefield's centre / top-left.
- The 120 offset was too small to tell apart from her own skill by eye (the area is 200 across and follows the ball);
  500 was unmistakable.
- **Not explained:** the unit page's skill **Preview** still showed her own skill, with both rows changed. The
  preview's recording (`character_*_skill_preview.battle`) is only 180 bytes of input and names no script, so the
  preview gets the skill some other way; not looked into further.

## Counts

1063 skill scripts were read (7 more couldn't be read). Of the 983 that belong to playable units:

| Skill uses | Skills | Borrowable without new art |
|---|---|---|
| no effect at all (buffs, heals, gauge...) | 73 | yes |
| only shared effects | 136 | yes (recoloured by element) |
| at least one unit-only effect | 774 | no: shows the other unit's art |

## The 35 shared effects (used by unit skills)

All under `battle/effect/skill_general/`. "Units" counts the units whose skill or Skill+ shows it.

| Effect | What it is | Colour | Units |
|---|---|---|---|
| `decoration/heavy_charge` | big charge-up glow on the unit (before a strong hit) | element | 16 |
| `decoration/charge` | charge-up glow on the unit | element | 13 |
| `decoration/dummy_ball` | decoy (copy) ball | element | 12 |
| `decoration/rush_aura` | aura around the unit while it dashes | element | 12 |
| `decoration/long_range_aura` | trail / aura on a flying shot or a dash | element | 10 |
| `area/air_blast` | blast wave; also used for full-screen attacks | element | 9 |
| `area/whirlwind_slash` | spinning slash around the unit (Clara's) | element | 9 |
| `decoration/strengthen` | power-up aura on the unit | element | 8 |
| `area/spread` | explosion / burst where the attack lands | element | 5 |
| `area/bit_circle` | things circling the unit (spinning scythe, lightning coat) | element | 4 |
| `area/claw_horizontal` | horizontal claw swipe | element | 4 |
| `area/cutting_front` | slash in front | element | 4 |
| `decoration/all_miasma` | miasma over the whole field | element | 4 |
| `long_range_general/ball` | a shot: bullet or cannonball flying out | element | 4 |
| `area/cutting_left` | slash to the left | element | 3 |
| `area/cutting_right` | slash to the right | element | 3 |
| `area/spin_sword_smash` | spinning sword smash | element | 3 |
| `long_range_general/circle` | round shot | element | 3 |
| `area/blow_attack_front` | punch / blow in front | element | 2 |
| `area/claw_vertical` | vertical claw swipe | element | 2 |
| `area/miasma` | dark cocoon / shadow-magic area | element | 2 |
| `long_range_general/acute` | pointed shot (arrow-like) | element | 2 |
| `long_range_general/magic` | needle / magic shot | element | 2 |
| `long_range_unique/bullet/bullet` | bullet (fixed colour) | fixed | 2 |
| `area/laser` | beam | element | 1 |
| `area/line_cross` | cross-shaped attack | element | 1 |
| `area/screw_long` | long spear thrust | element | 1 |
| `area/screw_short` | short spear thrust | element | 1 |
| `area/whirlwind_slash_front` | spinning slash in front | element | 1 |
| `decoration/entire_attack` | explosion over the whole field | element | 1 |
| `decoration/generic_fire` | fire | element | 1 |
| `decoration/slash_front` | slash in front (decoration) | element | 1 |
| `long_range_unique/arrow/arrow` | arrow (fixed colour) | fixed | 1 |
| `long_range_unique/cakram/cakram` | chakram (fixed colour) | fixed | 1 |
| `long_range_unique/knife/knife` | knife (fixed colour) | fixed | 1 |

## Effects outside unit skills

The 35 above are the shared effects **unit skills** use. The game has more:

- **The client itself** shows 4 more from `skill_general/multiball/` (the multiball helper appearing, getting ready
  and leaving, and a general multiball effect). No skill script names them.
- **Enemies** have their own sets. All 4,268 enemy action scripts named in the enemy tables (`general_boss`,
  `general_zako`, `general_funnel`, `standard_boss`... and their `_state` / `_variable` tables) were read too.
  Enemies never use the units' `skill_general` effects; they use:
  - `battle/effect/enemy_general/`: **32 shared enemy effects**, all drawn in element colour (table below);
  - `battle/effect/enemy_unique/`: **89 effects** made for one boss or a few (fixed colours, e.g. a laser
    warning line, the Wind Sphere's attacks, big coloured screen-wide blasts).
- Regular enemies' plain shots don't use these at all: the enemy harpy's scripts show no effect.

Whether a **unit** skill can show an enemy effect isn't known: no CN unit does, and these effects are made to fly
at the party. Untested.

| Enemy effect (`enemy_general/`) | What it is | Enemies | Scripts |
|---|---|---|---|
| `enemy_shot_burst_heavy_cannon` | burst of heavy shells | 43 | 247 |
| `enemy_shot_explosion_large` | large explosion | 42 | 895 |
| `enemy_shot_cannon` | cannon shot | 38 | 579 |
| `enemy_shot_laser_s` | thin laser | 37 | 532 |
| `enemy_shot_explosion_medium` | medium explosion | 33 | 344 |
| `enemy_shot_laser_m` | medium laser | 31 | 178 |
| `enemy_shot_laser_l` | wide laser | 29 | 74 |
| `enemy_shot_burst_middle_cannon` | burst of medium shells | 28 | 143 |
| `enemy_shot_big` | big shot | 25 | 185 |
| `enemy_shot_middle_cannon` | medium cannon shot | 21 | 76 |
| `enemy_shot_laser_ll` | very wide laser | 21 | 32 |
| `enemy_shot_burst_cannon` | burst of shells | 20 | 123 |
| `enemy_shot_circle` | round shot | 19 | 65 |
| `enemy_shot_fine` | small shots | 17 | 91 |
| `enemy_shot_craw_large` | large claw | 14 | 178 |
| `enemy_shot_heavy_cannon` | heavy cannon shot | 13 | 79 |
| `enemy_shot_laser_lll` | screen-wide laser | 13 | 14 |
| `enemy_shot_slip_damage` | damage-over-time hit | 13 | 102 |
| `enemy_shot_retension_cannon` | lingering cannon shot | 12 | 100 |
| `enemy_shot_overall_attack` | whole-field attack | 12 | 18 |
| `enemy_shot_craw_small` | small claw | 11 | 60 |
| `enemy_shot_pierce_cannon` | piercing cannon shot | 11 | 211 |
| `enemy_shot_wiry` | wire / thread | 10 | 40 |
| `enemy_shot_pierce_middle_cannon` | piercing medium shot | 9 | 82 |
| `enemy_shot_pierce_fine` | small piercing shots | 9 | 169 |
| `enemy_shot_slash_large` | large slash | 9 | 279 |
| `enemy_shot_retension_fine` | lingering small shots | 8 | 87 |
| `enemy_shot_explosion_small` | small explosion | 7 | 24 |
| `enemy_shot_slash_middle` | medium slash | 3 | 24 |
| `enemy_shot_slash_wave` | slash wave | 3 | 6 |
| `enemy_shot_all_miasma` | miasma over the field | 1 | 3 |
| `enemy_shot_target` | target marker | 1 | 1 |

## Skills with only shared effects (66 units)

Each unit's base skill (`_1`); its Skill+ (`_2`) uses the same effects in almost every case. Sorted by element, then rarity.

| Unit | ★ | Element | Skill | Effects | What it does |
|---|---|---|---|---|---|
| Arly — Turncoat Fiend (361003) | 3 | Dark | Soul Ripper | `decoration/strengthen`, `area/claw_horizontal` | Flourishes claws, inflicting dark damage on foes she bumps into for a period of time / Every time damage is inflicted, restores HP |
| Cody — Bunny Boy Brawler (361027) | 3 | Dark | Flash Dash | `decoration/heavy_charge`, `decoration/rush_aura`, `area/cutting_front` | Rushes forward with a sharp kick, inflicting Dark damage on hit foes / Increases attack |
| Falsche — Custodian of the Dead (361001) | 3 | Dark | Soul Reaper | `area/bit_circle` | Swings her dark scythe, inflicting dark damage on nearby foes for a period of time |
| Jalil — Silent Drifter (361002) | 3 | Dark | Qamar Sayf | `long_range_unique/cakram/cakram`, `decoration/long_range_aura` | Throws his chakram in every direction, inflicting Dark damage and reduced Dark resistance on hit foes |
| Lucille — Aspiring Sleuth (361033) | 3 | Dark | Tools of the Trade | `decoration/heavy_charge`, `long_range_general/circle` | Fires his slingshot at the nearest foe, inflicting Dark damage on hit foes + Removes 1 buff |
| Nochel — Monster Magnet (361008) | 3 | Dark | Stay Away! | `area/whirlwind_slash` | Waves his sword around as if to keep monsters at bay, inflicting dark damage on nearby foes (Damage increases with number of buffs on Nochel) / Grants Pierce... |
| Rebecca — Magical Daydreamer (361007) | 3 | Dark | Shadow Veil | `area/miasma` | Casts a shadow over her surroundings, inflicting reduced Dark resistance and Mire on hit foes / Increases the Skill Gauge of all units in your party (excludi... |
| Shion — Fervid Informant (361004) | 3 | Dark | Blackmail Blade | `decoration/long_range_aura`, `long_range_unique/knife/knife` | Flings daggers in front and behind, inflicting Dark damage, reduced Dark resistance, and Mire on hit foes for a period of time |
| Tarha — Odd Mummy Boy (361021) | 3 | Dark | Popping Bandages | `decoration/generic_fire` | Shoots out the bandages on his body at the nearest foe, inflicting Dark damage on hit foes (Damage increases with Coffin revive count of all units in your pa... |
| Red Blobble — Blob of Fire (512002) | 1 | Fire | Blobble Bash | `decoration/rush_aura`, `area/air_blast` | Travels up for a period of time, inflicting fire damage on foes within radius of its path |
| Shroombo — Springy Spore Sprite (512001) | 1 | Fire | Fungal Fury | `area/claw_horizontal`, `area/claw_vertical` | Rushes the closest target while flailing its arms, inflicting fire damage on foes in that direction |
| Golem — Desert Sentry (412004) | 2 | Fire | Shock Surge | `decoration/heavy_charge`, `decoration/rush_aura`, `area/spread` | Rushes forward, inflicting Fire damage on foes within radius of its path / Grants Pierce to all units and multiballs in your party |
| Cran — Devout Winged Warrior (311011) | 3 | Fire | Voice of Glory | `decoration/charge`, `long_range_general/acute` | Shoots fire arrows at the closest target, inflicting Fire damage on hit foes / Grants Levitate to all units and multiballs in your party |
| Elise — Desert Gunslinger (311003) | 3 | Fire | Bullet Parade | `long_range_unique/bullet/bullet`, `decoration/long_range_aura` | Rains 8 rounds of bullets on the closest target, inflicting Fire damage and reduced Fire resistance on hit foes |
| Enni — Fire Shaman (311009) | 3 | Fire | Munde Flamma | `decoration/all_miasma` | Covers the field in a miasma, inflicting reduced attack and reduced Fire resistance on hit foes + Removes 1 buff |
| Haaj — Monster Hunter (311004) | 3 | Fire | Electric Spear | `area/screw_short` | Fires his shock harpoon, inflicting fire damage on foes in front (Inflicts more damage on Beasts, Flora, and Dragons) |
| Jake — Living Rulebook (311010) | 3 | Fire | Performance Review | `decoration/charge`, `decoration/rush_aura` | Rushes the closest target, swinging his blade and inflicting fire damage on foes he bumps into (Inflicts more damage on foes with reduced elemental resistance) |
| Klaus — Refined Assassin (311025) | 3 | Fire | White Sting | `decoration/strengthen`, `area/cutting_front` | Brandishes his katars, inflicting Fire damage on hit foes for a period of time / Increases attack |
| Lilial — Avant-garde Alchemist (311001) | 3 | Fire | Experimental Alchemy | `decoration/entire_attack` | Generates a huge explosion, inflicting Fire damage on all foes on the field (Ignore soft spots) + Remove 1 buff |
| Sven — Just Like Whitetail! (311013) | 3 | Fire | Brave Slash | `area/cutting_left`, `area/cutting_right`, `area/air_blast`, `area/cutting_front` | Shows off his hard-practiced sword skills, charging forward and dealing Fire damage to all enemies hit |
| Trine — Crimson Curse (311006) | 3 | Fire | Crimson Drive | `area/spin_sword_smash`, `decoration/charge` | Swings her flaming blade at the closest target, inflicting Fire damage on nearby foes / Increases Power Flip damage for your party |
| Axem — Extremeboard Influencer (351027) | 3 | Light | Burst Flash | `decoration/rush_aura`, `decoration/long_range_aura`, `area/air_blast` | Shreds towards the nearest foe, crashing into them and inflicting Light damage / Grants Levitate to all units and multiballs in your party |
| Cecilia — Knight in Shining Armor (351003) | 3 | Light | Aegis Protection | `decoration/heavy_charge` | Receives the blessing of the light, increasing the Dark resistance of all units and multiballs in your party / Gains Invincibility |
| Corinna — Mischievous Acolyte (351015) | 3 | Light | Candy Bonanza | `decoration/all_miasma` | Passes out Halloween goodies, restoring the HP of all units and multiballs in your party, and units in other players' parties (Effect boosted for Light eleme... |
| Katyusha — Rookie Recruit (351021) | 3 | Light | Hail-Fire | `long_range_unique/bullet/bullet`, `decoration/long_range_aura` | Unleashes a hail of machine gun fire, dealing Light damage to foes in front / Increases Power Flip damage of all units and multiballs in your party when the ... |
| Kharo — Daughter of the Wild (351008) | 3 | Light | Marrow Splitter | `decoration/heavy_charge`, `decoration/rush_aura`, `area/claw_horizontal` | Slashes with fierce claws, inflicting Light damage on foes in front / Increases Fever Gauge |
| Luluca — Junior Journalist (351007) | 3 | Light | Cutting Edge Scoop | `decoration/strengthen` | Brandishes her knife, inflicting Light damage and reduced Light resistance on all foes she bumps into for a period of time (Damage increases with number of b... |
| Marguerite — Gorgeous Hawkeye (351002) | 3 | Light | Rose Rouge | `decoration/charge`, `long_range_general/acute` | Fires straight ahead, inflicting light damage on hit foes / Increases Fever Gauge |
| Miles — Staged Knight (351006) | 3 | Light | Aegis Charge | `decoration/rush_aura` | Charges the closest target, inflicting Light damage on foes he bumps into + Increases the Dark resistance of all units and multiballs in your party, and unit... |
| Mora — Modest Moth Maiden (351009) | 3 | Light | Silky Prison | `long_range_general/circle`, `area/miasma` | Fires a cocoon out in front, inflicting Light damage on all foes hit / Gains an increase in Dark damage resistance |
| Raul — Island Barkeep (351005) | 3 | Light | Carol of the Sanctum | `decoration/heavy_charge`, `area/line_cross` | Invokes divine protection, inflicting Light damage on foes in front, behind, and to the left and right (Inflicts more damage on Undead foes) + Removes 1 buff |
| Rue Ruto — I Dream of a Harem (351033) | 3 | Light | Beehive Shot | `decoration/heavy_charge`, `long_range_general/circle` | Shoots his pellet gun at the closest target, dealing Light damage to hit foes |
| Yellow Blobble — Blob of Thunder (532001) | 1 | Thunder | Blobble Bash | `decoration/rush_aura`, `area/air_blast` | Travels right for a period of time, inflicting thunder damage on foes within radius of its path |
| Zapquill — The Electrifying Porcupine (532004) | 1 | Thunder | Zap Needle | `decoration/heavy_charge`, `long_range_general/magic`, `decoration/long_range_aura` | Fires quills in every direction, inflicting Thunder damage on hit foes (Inflicts more damage on Paralyzed and/or Stunned foes) + Occasionally inflicts Paralyze |
| Albert — Lupine Gentleman (331005) | 3 | Thunder | Timber Rush | `decoration/strengthen`, `area/claw_vertical` | Unleashes his inner wolf, increasing attack for self / Inflicts damage on foes he bumps into for a period of time (Inflicts more damage on Paralyzed and/or S... |
| Bonnie — The Electrifying Bee (331002) | 3 | Thunder | Honeybee Needle | `decoration/heavy_charge`, `long_range_general/magic`, `decoration/long_range_aura` | Sends 5 bees swarming in every direction, inflicting Thunder damage, reduced Thunder resistance, Poison, and Paralyze on hit foes |
| Claw — Extroverted Bookworm (331004) | 3 | Thunder | Lightning Leap | `decoration/rush_aura`, `area/air_blast` | Dashes towards the closest target, inflicting thunder damage on foes he bumps into / Increases Fever Gauge |
| Kazuchi — Stormcloud Zapper (331006) | 3 | Thunder | Lit Mosh Pit | `area/bit_circle` | Surrounds self in lightning, inflicting thunder damage on nearby foes for a period of time / Increases Fever Gauge |
| Mew — Mew Year, Mew Me! (333001) | 3 | Thunder | Wild Spin | `area/whirlwind_slash` | Flies at the closest target in a flurry of slashes, inflicting Thunder damage on nearby foes. |
| Phi Nonoa — Skipping in the Rain (331020) | 3 | Thunder | Harmonia Pop | `area/bit_circle` | Encloses self in a ring of lightning for a period of time, inflicting Thunder damage on hit foes / Increases Power Flip damage for all units and multiballs i... |
| Taiga — Thunder Fist (331003) | 3 | Thunder | Raging Soul Strike | `decoration/heavy_charge`, `area/blow_attack_front`, `area/spread` | Deals an electrifying blow, inflicting thunder damage on foes in front |
| Tatiana — Tiddly Explorer (331007) | 3 | Thunder | Flapper Edge | `decoration/strengthen` | Brandishes knives, inflicting Thunder damage and Paralyze to all foes she bumps into for a period of time |
| Vargen — Lone Bastion (331013) | 3 | Thunder | Impact Bolt | `area/blow_attack_front` | Unleashes a powerful attack in front, inflicting Thunder damage on hit foes / Restores HP for self (Effect boosted for Thunder element) / Increases Power Fli... |
| Yuna — Dualblade Dreamer (331001) | 3 | Thunder | Dualblade Rumble | `area/whirlwind_slash` | Cuts a path to the closest target, inflicting thunder damage on nearby foes (Damage increases with number of buffs on Yuna) |
| Blue Blobble — Blob of Water (522001) | 1 | Water | Blobble Bash | `decoration/rush_aura`, `area/air_blast` | Travels down for a period of time, inflicting water damage on foes within radius of its path |
| Clara — New Purpose (321011) | 3 | Water | Beastly Bash | `area/whirlwind_slash` | When at 60% HP or more: Swings her axe, inflicting Water damage on hit foes / Increases attack for self / Increases Power Flip damage of all units and multib... |
| Keylos — Palpebran Ranger (321001) | 3 | Water | Rotten Arrows | `decoration/charge`, `long_range_unique/arrow/arrow`, `decoration/long_range_aura` | Shoots arrows forward for a period of time, inflicting Water damage and Poison on hit foes (Inflicts more damage on Poisoned foes)  |
| Klaus — Dire Assassin (321005) | 3 | Water | Shadowsting | `decoration/strengthen`, `area/claw_horizontal` | Brandishes claws and katars, inflicting water damage on all foes he bumps into for a period of time (Inflicts more damage on Mired foes) |
| Lassie — Sterling Sailor (321008) | 3 | Water | Crush of Justice | `decoration/heavy_charge`, `long_range_general/ball`, `area/spread` | Fires a cannonball before her, inflicting Water damage and Mire on hit foes (Damage increases with number of buffs on Lassie) |
| Ritta — Patrolling Prankster (321013) | 3 | Water | Ritta's Bomb Extravaganza | `area/spread` | Tosses out dynamite in front, inflicting Water damage on hit foes / When party leader is Water, increases Power Flip damage of all units and multiballs in yo... |
| Samantha — Stylish Shaman (321012) | 3 | Water | Glacial Water | `area/bit_circle` | Borrows the power of her ancestors to surround herself in water droplets, dealing Water damage to nearby enemies and lowering Water elemental resistance |
| Trista — Cobalt Blade (321002) | 3 | Water | Blue Razor | `area/spin_sword_smash`, `area/whirlwind_slash` | Makes rapid strokes, inflicting water damage on nearby foes for a short period of time (Damage increases with number of buffs on Trista) |
| Sotieth — Ancient Weapon of Dawn (700007) | 4 | Water | Mut Nu | `long_range_general/ball` | ruin_lady_no_piercing |
| Haridal — (None) (700006) | 5 | Water | Zahab Fajr | `long_range_general/ball` | desert_commander_no_piercing |
| Green Blobble — Blob of Wind (542001) | 1 | Wind | Blobble Bash | `decoration/rush_aura`, `area/air_blast` | Travels left for a period of time, inflicting wind damage on foes within radius of its path |
| C. F. Kiseki — Erratic Endorsement (443001) | 2 | Wind | G HEAD LASER | `area/laser` | What the? I CAN SHOOT LASERS IN THIS WORLD?! Inflicts wind damage on foes behind |
| Kamaitachi — Scythetail (442006) | 2 | Wind | Cyclone Slash | `decoration/charge`, `area/whirlwind_slash` | Sends out small whirlwinds, inflicting wind damage on hit foes |
| Conner — Skilled Spearman (341008) | 3 | Wind | Falcon Rush | `decoration/charge`, `area/screw_long` | Charges forward with his spear, inflicting Wind damage on foes in that direction / Grants Pierce to all units and multiballs in your party |
| Evan — Kaleidoscope Trawler (341001) | 3 | Wind | Aeralizer | `decoration/heavy_charge`, `area/whirlwind_slash_front`, `decoration/slash_front` | Swings sword, sending shock waves running in front, inflicting wind damage on hit foes (Damage increases with higher combos) |
| Folus — Devilish Clown (341006) | 3 | Wind | Mission Fantasia | `decoration/charge`, `long_range_general/ball`, `area/air_blast` | Flings magic bombs at the nearest targets, inflicting Wind damage and reduced attack on hit foes |
| Hartlief — Herbal Pharmacist (341007) | 3 | Wind | Glutaraldehyde | `decoration/all_miasma` | Scatters poison spores, inflicting Poison and reduced Wind resistance on all foes on the field |
| Jester — Deathtrap Buckaroo (341009) | 3 | Wind | Falling Lasso | `area/whirlwind_slash` | Deftly twirls his lasso, inflicting Wind damage, Paralyze, and reduced Wind resistance on nearby foes + Removes 1 buff for every hit landed |
| Kate — Stella's Bodyguard (341010) | 3 | Wind | Slash Barrage | `area/cutting_left`, `area/cutting_right`, `area/cutting_front` | Wields her dagger to unleash a barrage of slashes, dealing wind damage to nearby enemies. |
| Mew — Pawed Pugilist (341005) | 3 | Wind | Catscratch | `area/whirlwind_slash` | Strikes at the closest target with a flurry of claw strikes, inflicting wind damage on nearby foes |
| Millet — Novice Adventurer (341017) | 3 | Wind | Support Sweep | `area/cutting_left`, `area/cutting_right` | Swings her sword in front, inflicting Wind damage on hit foes / Increases attack for all units and multiballs in your party |
| Naska — Soul Gambler (341004) | 3 | Wind | Snake Destruction | `area/whirlwind_slash`, `area/spin_sword_smash` | Cracks whip, inflicting Wind damage on nearby foes / Has a chance of increasing the attack and all elemental resistance of all units and multiballs in your p... |

## Skills with no effect at all (36 units)

Buffs, heals, gauge and the like: nothing is drawn but the game's generic markers, so they fit any unit.

| Unit | ★ | Element | Skill | Effects | What it does |
|---|---|---|---|---|---|
| Adil — Remnant Warrior (361005) | 3 | Dark | Sand Falchion | none | Vows only to fight for peace, increasing attack / Grants Pierce to all units and multiballs in your party |
| Dorothea — Snarky Maid (361006) | 3 | Dark | Medicine Maker | none | Uses medicine from her bunny bag, taking HP from all units and multiballs in your party (excluding Dorothea) and granting them Recover and increased Light re... |
| Meryll — Fan Fantasies (361009) | 3 | Dark | Final Mantasy | none | Uses the power of wishful thinking, increasing the attack of all units and multiballs in your party + increasing the damage of direct hits / Then, if a male ... |
| Meryll — Holiday Headcanon (361015) | 3 | Dark | Holiday Fanzine | none | Uses the power of fiction to increase attack and Power Flip damage of all units and multiballs in your party / Gains Multihit if there is a male unit or mult... |
| Fire Imp — Sprite of Flames (512004) | 1 | Fire | Healing Flames | none | Receives the blessing of the Fire Spirit, restoring the HP of all units and multiballs in your party, and units in other players' parties (Effect boosted for... |
| Gilasrad — Deathrush Berserker (311008) | 3 | Fire | Exterminate | none | Summons strength, increasing attack for self /Increases Power Flip damage for your party |
| Harlisha — Gentle Healer (311012) | 3 | Fire | Agni Saptadhatu | none | Utilizes traditional healing techniques, restoring the HP of all units and multiballs in your party, and units in other players' parties (Effect boosted for ... |
| Jin — Lawless Charity (311005) | 3 | Fire | Ocean's Grace | none | Invokes the bounty of the sea, restoring the HP of all units and multiballs in your party, and units in other players' parties (Effect boosted for Fire eleme... |
| Lilian — Jovial Tailor (311019) | 3 | Fire | Happy Sewing | none | Whips up a quick outfit that increases the attack of all units and multiballs in your party / Increases the Skill Gauge and Wind resistance of all Fire units... |
| Marnie — Little Witch (311002) | 3 | Fire | Magical Storm | none | Summons stationary orbs from a magic vortex |
| Kikuno — Wandering Courtesan (111006) | 5 | Fire | Wrath of Hakunroh | none | Summons a red (Attacks twice + Pierce) and blue (Levitate + Recover) oni |
| Shakari — (None) (999999) | 5 | Fire | flame_witch | none | flame_witch |
| Aureo — Penguin Porter (351004) | 3 | Light | Baloosh Barrage | none | Summons sprites that transform into mini-Balooshes |
| Corinna — Kind Cleric (351001) | 3 | Light | Cure and Heal | none | Offers a prayer, granting Recover to all units and multiballs in your party + Removes 2 debuffs |
| Illumine — Phantastic Illusionist (251008) | 4 | Light | Rainbow Show | none | Calls upon rainbow orbs which inflict Light resistance down when they hit foes / Increases Fever Gauge when hitting foes / Restores HP to party unit with low... |
| Nephtim — Weapon of the Ancients (151001) | 5 | Light | Atum Ka | none | Summons a meteor shower, inflicting light damage on hit and nearby foes / Increases Fever Gauge |
| Colt — Child of Has-Beens (331010) | 3 | Thunder | Thunderclap | none | Conjures stationary lightning orbs |
| Fiora — Divinator Divine (331012) | 3 | Thunder | Visions of Victory | none | Reads victory in the stars, restoring the HP of all units and multiballs in your party, and units in other players' parties (Effect boosted for Thunder eleme... |
| Flana — Floaty Gal (331014) | 3 | Thunder | Relic Floater | none | Uses an unknown power, granting Levitate to all units and multiballs in your party / Removes 1 debuff from all units and multiballs in your party |
| Sha Suzu — Firearm Fanatic (331011) | 3 | Thunder | Calibration | none | Conducts a weapon tune-up, increasing the Skill Gauge and skill damage of the party leader |
| Assist — (None) (700004) | 4 | Thunder | For my people! | none | horn_leader_assist |
| Aureo — Merry Mailman (231007) | 4 | Thunder | Present Panic | none | Pulls sparkling presents out of his sack of joy, which inflict thunder damage on all foes they bump into / Increases Fever Gauge |
| Challua — Sacred Tree Sprite (323001) | 3 | Water | Estrella Gracia | none | Spreads holiday cheer, increasing attack for all units and multiballs in your party / Increases Fever Gauge  |
| Elza — Devil in a White Dress (321004) | 3 | Water | Lunatic Injection | none | Administers a mysterious injection, restoring the HP of all units and multiballs in your party, and units in other players' parties (Effect boosted for Water... |
| Faf — Silly Little Dragon (321009) | 3 | Water | Dragon's Scale | none | Lets loose an adorable roar, increasing the attack and Fire resistance of all units and multiballs in your party, and units in other players' parties |
| Kaiyu — Lethean Ex-monk (321007) | 3 | Water | Enlightenment | none | Increases the attack of all units and multiballs in your party + Grants Recover + Inflicts reduced resistance to all elements + Restores their HP (Effect boo... |
| Rico — Dapper Spring Supervisor (321010) | 3 | Water | Holy Fountain | none | Taps into the Spring's magic, restoring the HP of all units and multiballs in your party, and units in other players' parties (Effect boosted for Warriors) +... |
| Shirano — Princess' Governess (321006) | 3 | Water | Spring Shower | none | Performs a traditional yokai arte, granting Invincibility to all units and multiballs in your party, and units in other players' parties |
| Walter — Armored Teddy Bear (321003) | 3 | Water | Great Wall | none | Reduces Fire damage for all units and multiballs in your party / Reduces Fire damage taken for self |
| Liesel — Angel of the Kaleidoscope (221002) | 4 | Water | Aqua Vitae | none | Summons holy water, restoring the HP of all units and multiballs in your party, and units in other players' parties (Effect boosted for Water element) + Incr... |
| Assist — (None) (700008) | 5 | Water | Keep your resolve close at heart. | none | justice_lady_assist |
| Owlbert — Sylvan Intellectual (442004) | 2 | Wind | Owl Blast | none | Grants Levitate to all units and multiballs in your party / Increases the attack and skill damage of all units and multiballs in your party, and units in oth... |
| Challua — Daughter of the Woods (341002) | 3 | Wind | Sol Gracia | none | Invokes the bounty of the sun, granting Recover to all units and multiballs in your party / Removes 1 debuff from all units and multiballs in your party, and... |
| Nellie — Theoretical Prodigy (341011) | 3 | Wind | Mana Evolution | none | Analyzes magic theory, increasing Wind leader attack and skill damage / Increases debuff resistance of all units and multiballs in your party |
| Regitare — The Kindly Skeleton (341003) | 3 | Wind | Aqua Chalice | none | Imbues his friends with the powers of the undead, reducing the Coffin count of all units in your party and units in other players' parties / Increases attack... |
| Kugui — (None) (700000) | 4 | Wind | -- | none | -- |

## How this list was made

A scan of `master/skill/action_skill` (column 7 = the script) and each script's `ShowEffect` commands (and the same for
the enemy action scripts the enemy tables name); the names and
descriptions are the English (translated) tables. The scan script isn't in the repo; it is a few lines over
`scripts/cn_read.cjs` and `scripts/amf3.cjs` (open each CN archive once: `readCn` reopens one per file, which is slow
for a thousand files).
