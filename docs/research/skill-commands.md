# Skill script commands (research, 2026-11-16)

> 中文版：[skill-commands.zh-CN.md](skill-commands.zh-CN.md)

> [!IMPORTANT]
> ## 🤖 Written by AI
> Written by **Claude** (Anthropic's AI) in a Claude Code session. The command list and parameter types come from the
> installed CN 1.8.1 client (`pinball.battle.action.dsl.ActionDslCommand`, exported with FFDec); the values from
> every CN skill script (`master/skill/action_skill` column 7). Meanings come from the client's battle code
> (`ActionEvaluator.evalCommand` and the objects it builds); ones marked *(inferred)* are guesses from values and names.

The groundwork for a skill editor (not built). How skills, effects and their placement work, and the in-game tests,
are in [skill-effects.md](skill-effects.md).

## How a script is stored

A skill script is AMF3 data, raw-deflated (`<path>.action.dsl.amf3.deflate`); `scripts/amf3.cjs` reads and writes it
(a script written by `writeAmf3` was accepted in battle). Read as JSON it is `["ActionDsl", 1, ..., ["Block", [commands]]]`,
each command `["Command", ["<Name>", param1, param2, ...]]`. Enums are arrays (`["Circle", [{"min":200,"max":200}]]`,
`["AB"]`), numbers that scale with skill level are `[{min, max}]` lists, and blocks are `["Block", [commands]]`.

**Subjects** are numbered: `-17` the unit using the skill, `-18` its ball, `-33` the party, `-1` / `-2` the battlefield's
centre / top-left (`ActionEvaluationResolver`). Commands that make something (an area, a group, a point) bind it to a
number of the script's choosing inside their block.

## Commands used by CN's skills (51 of the client's 106)

"Skills" = skill-row scripts using it (base skills, Skill+ and other action skills). Values: the most used, ×count.

### ShowEffect

Show an effect. Tested (harpy, Clara). Used by **494** skills; client index 10.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `String` | label (a name the script can hide it by) | 638 distinct: `"攻撃演出"` ×185, `"全体演出"` ×160, `"ヒット演出"` ×144 |
| 2 | `Effect` | effect: ResolveByElement(path) = the copy for the unit's element, SpecifyEffectDirectly(path) = that file | 694 distinct: `SpecifyEffectDirectly("battle/effect/skill_unique/spry_sailor_hw21/spry_sailor_h` ×104, `SpecifyEffectDirectly("battle/effect/skill_unique/wind_oracle_1anv/wind_oracle_1` ×98, `SpecifyEffectDirectly("battle/effect/skill_unique/mermaid_1halfanv/mermaid_1half` ×94 |
| 3 | `int` | attached to: a subject id | 61 distinct: `-18` ×1225, `0` ×489, `1` ×395 |
| 4 | `LayerZDepth` | layer (e.g. ForesideOfCharacter) | 5 distinct: `ForesideOfCharacter` ×3093, `BacksideOfCharacter` ×271, `SuperForesideOfCharacter` ×220 |
| 5 | `EffectLifetime` | lifetime: UntilTargetTerminates, SpecificFrame(n), SpecificFrameSLv, PlayOnlyFirstSequence... | 90 distinct: `PlayOnlyFirstSequence` ×2436, `UntilTargetTerminates` ×507, `SpecifyEffectLifetimeDirectly(60)` ×116 |
| 6 | `CoordSysSource` | direction: AB up the screen, EF moving direction, CD an attack area's rotation, GH(id) toward a subject | 29 distinct: `AB` ×2622, `CD` ×548, `EF` ×216 |
| 7 | `int` | offset X | 21 distinct: `0` ×3550, `100` ×23, `-100` ×23 |
| 8 | `int` | offset Y (positive = down the screen) | 47 distinct: `0` ×3175, `-200` ×66, `-30` ×64 |
| 9 | `Number` | rotation (radians, added) | 34 distinct: `0` ×3474, `3.141592653589793` ×66, `0.7853981633974483` ×10 |
| 10 | `Boolean` | follow position | 2 distinct: `true` ×2188, `false` ×1452 |
| 11 | `Boolean` | follow direction | 2 distinct: `false` ×2535, `true` ×1105 |
| 12 | `Option` | scale: Some(min~max) by skill level, or None | 39 distinct: `None` ×1826, `Some(1)` ×386, `Some(2)` ×249 |

### CreateHitArea

Create attack areas. Tested (harpy: offset Y 250 = below). Used by **401** skills; client index 24.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `String` | label | 4 distinct: `"*"` ×1687, `"チャクラム"` ×3, `"銃弾"` ×2 |
| 2 | `int` | attached to: a subject id (-18 = the unit's ball) | 28 distinct: `-18` ×855, `0` ×270, `1` ×194 |
| 3 | `CoordSysSource` | direction (as ShowEffect) | 33 distinct: `AB` ×1142, `EF` ×236, `CD` ×119 |
| 4 | `int` | offset X | 43 distinct: `0` ×1514, `-60` ×26, `60` ×24 |
| 5 | `int` | offset Y (positive = down) | 53 distinct: `0` ×1174, `-150` ×98, `-200` ×66 |
| 6 | `Number` | rotation (radians) | 35 distinct: `0` ×1530, `0.17453292519943295` ×10, `1.0471975511965976` ×10 |
| 7 | `Boolean` | follow position (inferred: as ShowEffect) | 2 distinct: `true` ×869, `false` ×825 |
| 8 | `Boolean` | follow direction (inferred) | 2 distinct: `false` ×1361, `true` ×333 |
| 9 | `Shape` | shape: Circle(r), Rectangle(w, h), Arc, Donut... | 135 distinct: `Circle(200)` ×186, `Circle(250)` ×123, `Rectangle(1500, 2000)` ×117 |
| 10 | `HAlign` | horizontal alignment | 1 distinct: `Center` ×1694 |
| 11 | `VAlign` | vertical alignment (Center, Bottom, Top) | 3 distinct: `Center` ×1352, `Bottom` ×254, `Top` ×88 |
| 12 | `Formation` | formation: Single, NWay(n, angle), Circle(n, r)... (several areas at once) | 21 distinct: `Single` ×1627, `NWay(9, 0.13962634015954636)` ×8, `NWay(6, 1.0471975511965976)` ×6 |
| 13 | `ActionHitAreaLifetime` | lifetime: SpecifyHitAreaLifetimeDirectly(frames), SpecifyHitAreaLifetimeSLv, RemainingFramesOfCurrentStateGroup | 79 distinct: `SpecifyHitAreaLifetimeDirectly(60)` ×181, `SpecifyHitAreaLifetimeDirectly(30)` ×155, `SpecifyHitAreaLifetimeDirectly(20)` ×154 |
| 14 | `MinHitInterval` | min hit interval: CalculatedUsingMaxNumOfHits(n) or SpecifyMinHitIntervalDirectly(frames) | 38 distinct: `CalculatedUsingMaxNumOfHits(1)` ×1020, `CalculatedUsingMaxNumOfHits(3)` ×101, `CalculatedUsingMaxNumOfHits(10)` ×55 |
| 15 | `Option` | max number of hits (Some(n) / None) | 22 distinct: `None` ×1029, `Some(1)` ×453, `Some(3)` ×32 |
| 16 | `Boolean` | (inferred) flag | 2 distinct: `false` ×1588, `true` ×106 |
| 17 | `Boolean` | cracks weak points | 2 distinct: `true` ×1621, `false` ×73 |
| 18 | `Option` | (inferred) option | 2 distinct: `None` ×1692, `Some(9)` ×2 |
| 19 | `int` | id the new area gets inside the next block | 50 distinct: `0` ×334, `1` ×289, `3` ×140 |
| 20 | `ActionDslExpression` | block run once per area when it appears (effects go here) | 7 distinct: `Block(0)` ×673, `Block(1)` ×520, `Block(2)` ×379 |
| 21 | `int` | id of the area inside the on-hit block | 50 distinct: `1` ×334, `2` ×289, `4` ×140 |
| 22 | `int` | id of the hit target inside the on-hit block | 50 distinct: `2` ×334, `3` ×289, `5` ×140 |
| 23 | `ActionDslExpression` | block run on each hit (CreateNormalAttack, ShakeCamera...) | 11 distinct: `Block(2)` ×814, `Block(1)` ×547, `Block(3)` ×228 |
| 24 | `int` | (inferred) int | 2 distinct: `0` ×1684, `4` ×10 |
| 25 | `int` | (inferred) int | 2 distinct: `0` ×1686, `1` ×8 |
| 26 | `HitAreaGuardMode` | guard mode | 1 distinct: `None` ×1694 |

### CreateCondition

Give a buff or debuff (a condition). Tested (harpy's attack up). Used by **396** skills; client index 21.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` | target: a subject id (-17 = the unit itself) | 29 distinct: `-17` ×277, `0` ×267, `3` ×171 |
| 2 | `Array` | conditions: e.g. [ACAttackPoint(frames, value, count)] = attack up for frames by value (0.4 = +40 %) | 696 distinct: `[ACAttackPoint(900, 0.4~0.5, 1)]` ×36, `[ACAttackPoint(720, 0.3, 1)]` ×35, `[ACAttackPoint(900, 0.85~1, 1)]` ×16 |
| 3 | `Array` | (inferred) strength factor, usually 1 | 6 distinct: `1` ×1422, `0.5` ×13, `[{"alv_min":1,"alv_max":1}]` ×8 |
| 4 | `ConditionHitEffect` | marker shown: GenericConditionHitEffect, None, or a specific effect | 3 distinct: `GenericConditionHitEffect` ×1379, `None` ×71, `SpecifyConditionHitEffectDirectly(SpecifyEffectDirectly("battle/effect/skill_uni` ×2 |
| 5 | `Boolean` | (inferred) flag, usually true | 2 distinct: `true` ×1430, `false` ×22 |
| 6 | `Boolean` | (inferred) flag, usually false | 2 distinct: `false` ×1435, `true` ×17 |
| 7 | `String` | label (to remove it again) | 17 distinct: `""` ×1396, `"スペシャルウィーク最大速度固定"` ×4, `"スペシャルウィーク攻撃力"` ×4 |
| 8 | `HitCountCheckTargetKind` | hit-count check (inferred) | 1 distinct: `null` ×1452 |
| 9 | `Boolean` | (inferred) flag | 1 distinct: `false` ×1452 |
| 10 | `int` | (inferred) group/stack kind: 3 mostly | 3 distinct: `3` ×1228, `1` ×138, `2` ×86 |
| 11 | `Array` | (inferred) array, usually 1 | 1 distinct: `1` ×1452 |
| 12 | `Boolean` | (inferred) flag | 2 distinct: `false` ×1442, `true` ×10 |

### CreateNormalAttack

What a hit does: normal damage (inside an attack area's on-hit block). Used by **390** skills; client index 15.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` | target: subject id (the hit target, e.g. 3) | 52 distinct: `2` ×285, `3` ×253, `5` ×130 |
| 2 | `int` | element: 255 = the unit's own | 5 distinct: `255` ×1527, `3` ×24, `4` ×6 |
| 3 | `Array` | (inferred) array | 5 distinct: `[]` ×1544, `[8197]` ×10, `[8194, 8199]` ×4 |
| 4 | `Array` | (inferred) array | 5 distinct: `[]` ×1528, `[DCParalysis]` ×20, `[DCFrozen]` ×10 |
| 5 | `int` | (inferred) int | 100 distinct: `8` ×141, `10` ×98, `5` ×89 |
| 6 | `Array` | damage multiplier (min~max by skill level) | 525 distinct: `1` ×29, `1.3~1.5` ×26, `2` ×22 |
| 7 | `Array` | (inferred) array, usually 0 | 3 distinct: `0` ×1544, `0.5` ×16, `0.25` ×2 |
| 8 | `Boolean` | (inferred) flag | 2 distinct: `false` ×1506, `true` ×56 |
| 9 | `Boolean` | (inferred) flag | 2 distinct: `false` ×1540, `true` ×22 |
| 10 | `Boolean` | (inferred) flag | 2 distinct: `false` ×1456, `true` ×106 |
| 11 | `Boolean` | (inferred) flag | 1 distinct: `false` ×1562 |
| 12 | `Boolean` | (inferred) flag | 2 distinct: `false` ×1557, `true` ×5 |
| 13 | `Array` | (inferred) array | 103 distinct: `1` ×169, `2` ×111, `0.6666666666666666` ×93 |
| 14 | `Array` | (inferred) array | 76 distinct: `1` ×253, `2` ×136, `3` ×92 |
| 15 | `AttackHitEffect` | hit effect: Fine, Coarse, Slash... | 63 distinct: `Fine` ×694, `None` ×287, `Coarse` ×243 |
| 16 | `Boolean` | (inferred) flag | 1 distinct: `true` ×1562 |

### ShakeCamera

Camera shake. Used by **345** skills; client index 5.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` | size: 1 small, 2 medium, 3 large (CameraShakeSize) | 3 distinct: `1` ×723, `2` ×416, `3` ×162 |

### StopBall

Stop or slow the unit's ball for a while (most skills pause the ball while they play). Used by **336** skills; client index 14.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` | ball: subject id (-18) | 1 distinct: `-18` ×734 |
| 2 | `int` | frames | 53 distinct: `10` ×165, `30` ×90, `60` ×76 |
| 3 | `EndingSpeedKind` | afterwards: Stop, RestoreToSpeedBeforeActionExecution, RestoreToSpeedBeforeCommandExecution | 3 distinct: `Stop` ×371, `RestoreToSpeedBeforeActionExecution` ×301, `RestoreToSpeedBeforeCommandExecution` ×62 |
| 4 | `CoordSysSource` | direction (as ShowEffect) | 7 distinct: `AB` ×402, `EF` ×274, `GH(0)` ×42 |
| 5 | `Number` | angle | 1 distinct: `0` ×734 |

### FindAllSubjects

Pick a group (the party, every enemy...) and run a block with it bound to an id. Used by **288** skills; client index 3.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` | id the group gets in the block | 27 distinct: `0` ×295, `1` ×177, `3` ×128 |
| 2 | `int` | which group (33 = the party, as in Clara's Power Flip buff) | 15 distinct: `33` ×414, `113` ×232, `145` ×170 |
| 3 | `Array` | (inferred) filter | 10 distinct: `[]` ×744, `[2]` ×64, `[4]` ×60 |
| 4 | `Array` | (inferred) filter | 1 distinct: `[]` ×1069 |
| 5 | `Array` | (inferred) filter | 1 distinct: `[]` ×1069 |
| 6 | `Array` | (inferred) filter | 2 distinct: `[]` ×1065, `[12290]` ×4 |
| 7 | `Array` | (inferred) filter | 1 distinct: `[]` ×1069 |
| 8 | `IfTargetNotFound` | if nobody is found: DoNothing... | 2 distinct: `DoNothing` ×1067, `CreateImaginaryTarget(-192)` ×2 |
| 9 | `ActionDslExpression` | the block | 5 distinct: `Block(1)` ×859, `Block(2)` ×166, `Block(3)` ×30 |

### CreateReferencePoint

A point (e.g. at a subject, with an offset) that areas and effects can attach to or aim at. Used by **163** skills; client index 32.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` | at: subject id | 23 distinct: `-18` ×260, `0` ×79, `1` ×33 |
| 2 | `CoordSysSource` | direction | 8 distinct: `AB` ×336, `GH(0)` ×45, `CD` ×26 |
| 3 | `int` | offset X | 7 distinct: `0` ×417, `40` ×8, `5` ×5 |
| 4 | `int` | offset Y | 36 distinct: `0` ×265, `-300` ×20, `-250` ×16 |
| 5 | `Number` | rotation | 3 distinct: `0` ×442, `0.6981317007977318` ×2, `-0.6981317007977318` ×2 |
| 6 | `Boolean` | follow position (inferred) | 2 distinct: `false` ×375, `true` ×71 |
| 7 | `Boolean` | follow direction (inferred) | 2 distinct: `false` ×434, `true` ×12 |
| 8 | `Formation` | formation (inferred) | 1 distinct: `Single` ×446 |
| 9 | `int` | (inferred) int | 45 distinct: `60` ×69, `100` ×47, `150` ×42 |
| 10 | `int` | id the point gets in the block | 34 distinct: `0` ×155, `1` ×102, `2` ×31 |
| 11 | `ActionDslExpression` | the block | 11 distinct: `Block(2)` ×136, `Block(1)` ×132, `Block(3)` ×105 |

### FindNearSubjects

Pick the nearest subjects (e.g. the nearest enemies) and run a block with them. Used by **132** skills; client index 4.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` | from: subject id | 3 distinct: `-18` ×353, `-17` ×10, `4` ×2 |
| 2 | `int` | (inferred) how many | 2 distinct: `1` ×361, `100` ×4 |
| 3 | `int` | (inferred) kind | 4 distinct: `49` ×351, `51` ×10, `50` ×2 |
| 4 | `IfTargetNotFound` | if nobody is found | 7 distinct: `CreateImaginaryTarget(-100000)` ×147, `CreateImaginaryTarget(-1000000)` ×121, `DoNothing` ×58 |
| 5 | `int` | id they get in the block | 29 distinct: `0` ×225, `1` ×34, `4` ×15 |
| 6 | `ActionDslExpression` | the block | 6 distinct: `Block(1)` ×260, `Block(2)` ×59, `Block(3)` ×34 |

### MoveHitArea

Move an attack area (a slash that travels). Used by **90** skills; client index 25.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` | area: subject id | 48 distinct: `0` ×108, `1` ×66, `6` ×31 |
| 2 | `CoordSysSource` | direction | 22 distinct: `CD` ×249, `AB` ×243, `GH(0)` ×7 |
| 3 | `Number` | angle | 6 distinct: `0` ×506, `-1.5707963267948966` ×10, `1.7453292519943295` ×9 |
| 4 | `Number` | speed | 28 distinct: `30` ×149, `40` ×60, `0` ×54 |
| 5 | `TweenSource` | (inferred) option | 7 distinct: `None` ×525, `Some(30, CubicIn)` ×9, `Some(20, CubicOut)` ×3 |

### MoveBall

Move the unit's ball (dashes, charges). Used by **76** skills; client index 13.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` | ball: subject id (-18) | 2 distinct: `-18` ×206, `4` ×2 |
| 2 | `CoordSysSource` | direction (GH(id) = toward a subject) | 10 distinct: `GH(0)` ×83, `AB` ×65, `GH(1)` ×25 |
| 3 | `Number` | angle (radians) | 8 distinct: `0` ×188, `3.141592653589793` ×8, `2.356194490192345` ×2 |
| 4 | `int` | frames | 19 distinct: `2` ×64, `1` ×48, `10` ×24 |
| 5 | `Number` | speed | 25 distinct: `10` ×32, `30` ×28, `15` ×23 |
| 6 | `EndingSpeedKind` | afterwards: KeepGoing, Stop, Restore... | 3 distinct: `KeepGoing` ×162, `Stop` ×43, `RestoreToSpeedBeforeCommandExecution` ×3 |
| 7 | `Boolean` | (inferred) flag | 2 distinct: `true` ×182, `false` ×26 |

### CreateRatioHeal

Heal a share of max HP. Used by **73** skills; client index 20.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` | target: subject id | 18 distinct: `-33` ×90, `1` ×76, `2` ×58 |
| 2 | `int` | (inferred) kind | 1 distinct: `2` ×347 |
| 3 | `Array` | ratio (0.05 = 5 %) | 25 distinct: `0.06` ×77, `0.08~0.1` ×73, `0.04` ×43 |
| 4 | `Array` | (inferred) array | 9 distinct: `[2]` ×72, `[5]` ×70, `[4]` ×50 |
| 5 | `Array` | (inferred) factor | 3 distinct: `0.5` ×317, `0` ×28, `1` ×2 |
| 6 | `HealHitEffect` | marker: GenericHealHitEffect... | 7 distinct: `GenericHealHitEffect` ×300, `None` ×22, `SpecifyHealEffectDirectly(SpecifyEffectDirectly("battle/effect/skill_unique/bish` ×8 |

### DeleteCondition

Remove buffs/debuffs from a subject (inferred from the name). Used by **66** skills; client index 22.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 14 distinct: `0` ×42, `2` ×22, `3` ×20 |
| 2 | `DeletionalConditionKind` |  | 2 distinct: `DCAll(3)` ×96, `DCAll(2)` ×72 |
| 3 | `int` |  | 3 distinct: `1` ×147, `2` ×19, `999` ×2 |
| 4 | `int` |  | 2 distinct: `0` ×166, `2` ×2 |
| 5 | `String` |  | 1 distinct: `""` ×168 |
| 6 | `DeleteConditionSyncMode` |  | 1 distinct: `Default` ×168 |

### HideCharacter

Hide the unit's sprite for a while. Used by **51** skills; client index 39.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` | subject id | 1 distinct: `-17` ×111 |
| 2 | `int` | frames | 39 distinct: `90` ×10, `120` ×9, `65` ×7 |

### ConditionalsChangeSkillFlag

Used by **28** skills; client index 86.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 1 distinct: `1` ×62 |
| 2 | `ActionDslExpression` |  | 4 distinct: `Block(1)` ×44, `Block(2)` ×12, `Block(0)` ×4 |
| 3 | `ActionDslExpression` |  | 4 distinct: `Block(0)` ×34, `Block(1)` ×16, `Block(2)` ×10 |

### AddFeverPoint

Add Fever gauge. Used by **27** skills; client index 8.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `Array` | amount (min~max) | 28 distinct: `25~30` ×5, `65~75` ×4, `50` ×3 |

### HideEffect

Stop an effect early, by its label. Used by **25** skills; client index 11.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `String` | label | 21 distinct: `"突進演出"` ×34, `"突進ドット"` ×10, `"突進"` ×4 |

### CreateSummonsMultiball

Used by **23** skills; client index 36.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 3 distinct: `1` ×36, `2` ×11, `3` ×4 |
| 2 | `int` |  | 49 distinct: `1130011` ×2, `1110021` ×2, `2630031` ×1 |
| 3 | `Array` |  | 7 distinct: `9000` ×18, `1800` ×17, `1500` ×8 |
| 4 | `MultiballReadyEffect` |  | 19 distinct: `E1(SpecifyEffectDirectly("battle/effect/skill_general/multiball/multiball_genera` ×7, `E2(SpecifyEffectDirectly("battle/effect/skill_unique/shadow_redhood/shadow_redho` ×4, `E2(SpecifyEffectDirectly("battle/effect/skill_unique/compliment_oiran/compliment` ×4 |
| 5 | `Effect` |  | 19 distinct: `SpecifyEffectDirectly("battle/effect/skill_general/multiball/multiball_general_e` ×7, `SpecifyEffectDirectly("battle/effect/skill_unique/shadow_redhood/shadow_redhood_` ×4, `SpecifyEffectDirectly("battle/effect/skill_unique/compliment_oiran/compliment_oi` ×4 |
| 6 | `Effect` |  | 20 distinct: `SpecifyEffectDirectly("battle/effect/skill_general/multiball/multiball_general_e` ×7, `SpecifyEffectDirectly("battle/effect/skill_unique/compliment_oiran/compliment_oi` ×4, `SpecifyEffectDirectly("battle/effect/skill_unique/onmyoji_boy_wt21/onmyoji_boy_w` ×4 |
| 7 | `int` |  | 3 distinct: `0` ×47, `5` ×2, `65` ×2 |
| 8 | `Boolean` |  | 2 distinct: `false` ×47, `true` ×4 |
| 9 | `String` |  | 1 distinct: `"*"` ×51 |
| 10 | `int` |  | 5 distinct: `0` ×25, `4` ×12, `3` ×6 |
| 11 | `int` |  | 5 distinct: `1` ×25, `5` ×12, `4` ×6 |
| 12 | `ActionDslExpression` |  | 2 distinct: `null` ×49, `Block(2)` ×2 |
| 13 | `Object` |  | 2 distinct: `null` ×49, `1` ×2 |

### RemoveEvent

Used by **20** skills; client index 1.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `String` |  | 20 distinct: `"突進イベント"` ×30, `"衝突イベント"` ×6, `"衝突しないイベント"` ×4 |

### CreateRatioAttack

Used by **17** skills; client index 16.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 11 distinct: `-17` ×16, `0` ×10, `4` ×4 |
| 2 | `int` |  | 1 distinct: `2` ×41 |
| 3 | `Array` |  | 8 distinct: `0.1` ×17, `0.2` ×7, `0.05` ×5 |

### ConditionalsFeverMode

Used by **14** skills; client index 57.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `ActionDslExpression` |  | 5 distinct: `Block(0)` ×14, `Block(1)` ×6, `Block(2)` ×4 |
| 2 | `ActionDslExpression` |  | 5 distinct: `Block(1)` ×16, `Block(0)` ×4, `Block(4)` ×4 |

### CreateBarrier

A barrier. Used by **12** skills; client index 58.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` | target: subject id | 5 distinct: `0` ×9, `1` ×6, `-17` ×4 |
| 2 | `Array` | strength (min~max) | 13 distinct: `0.03` ×4, `0.045~0.06` ×3, `0.06` ×3 |
| 3 | `BarrierHitEffect` | hit effect | 1 distinct: `GenericBarrierHitEffect` ×23 |

### AddSkillPoint

Add skill gauge. Used by **10** skills; client index 6.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` | target: subject id | 6 distinct: `0` ×6, `1` ×4, `4` ×2 |
| 2 | `Array` | amount (min~max) | 15 distinct: `0.05` ×2, `[{"alv_min":0.15,"alv_max":0.2}]` ×2, `0.5` ×2 |

### ConditionalsMultiballNumber

Used by **10** skills; client index 76.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `Array` |  | 10 distinct: `[1611951, 1611952]` ×2, `[1111711, 1111712]` ×2, `[1611891, 1611892]` ×2 |
| 2 | `Array` |  | 1 distinct: `[]` ×20 |
| 3 | `int` |  | 1 distinct: `1` ×20 |
| 4 | `ActionDslExpression` |  | 5 distinct: `Block(3)` ×8, `Block(1)` ×4, `Block(2)` ×4 |
| 5 | `ActionDslExpression` |  | 5 distinct: `Block(2)` ×8, `Block(0)` ×4, `Block(3)` ×4 |

### ConditionalsHealthPointRatio

Branch on the unit's HP: HP at or above X % runs the first block, else the second (Clara's 60 %). Used by **8** skills; client index 54.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` | X (percent) | 4 distinct: `50` ×10, `45` ×2, `30` ×2 |
| 2 | `ActionDslExpression` | block if at or above | 3 distinct: `Block(1)` ×8, `Block(0)` ×4, `Block(3)` ×4 |
| 3 | `ActionDslExpression` | block if below | 3 distinct: `Block(1)` ×10, `Block(0)` ×4, `Block(2)` ×2 |

### AddCombo

Used by **7** skills; client index 82.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `Array` |  | 10 distinct: `6` ×2, `9~15` ×2, `4` ×2 |

### DecreaseCoffinCount

Used by **6** skills; client index 37.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 5 distinct: `3` ×4, `5` ×2, `4` ×2 |
| 2 | `int` |  | 7 distinct: `8` ×3, `4` ×2, `3` ×2 |
| 3 | `DecreaseCoffinCountHitEffect` |  | 1 distinct: `Generic` ×12 |

### IfThisCharacterIsBoss

Used by **5** skills; client index 61.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 3 distinct: `4` ×4, `2` ×4, `0` ×2 |
| 2 | `ActionDslExpression` |  | 2 distinct: `Block(1)` ×6, `Block(2)` ×4 |
| 3 | `ActionDslExpression` |  | 2 distinct: `Block(1)` ×6, `Block(2)` ×4 |

### ConditionalsRelativePositionVertical

Used by **5** skills; client index 104.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 2 distinct: `1` ×10, `-18` ×4 |
| 2 | `int` |  | 2 distinct: `0` ×12, `1` ×2 |
| 3 | `ActionDslExpression` |  | 2 distinct: `Block(1)` ×12, `Block(6)` ×2 |
| 4 | `ActionDslExpression` |  | 2 distinct: `Block(1)` ×12, `Block(6)` ×2 |

### CreateReferencePointAtSpecifiedPosition

Used by **4** skills; client index 33.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 2 distinct: `-1` ×6, `-18` ×2 |
| 2 | `int` |  | 3 distinct: `-18` ×4, `-1` ×2, `4` ×2 |
| 3 | `int` |  | 4 distinct: `120` ×2, `60` ×2, `230` ×2 |
| 4 | `int` |  | 2 distinct: `0` ×6, `5` ×2 |
| 5 | `ActionDslExpression` |  | 3 distinct: `Block(4)` ×4, `Block(2)` ×2, `Block(1)` ×2 |

### CreateBombMultiball

Used by **4** skills; client index 35.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 5 distinct: `2` ×2, `6` ×2, `3` ×2 |
| 2 | `String` |  | 4 distinct: `"character/illusionist_ball/pixelart/pixelart"` ×2, `"character/docking_beast_xm19_multiball/pixelart/pixelart"` ×2, `"character/bomb/pixelart/pixelart"` ×2 |
| 3 | `MultiballReadyEffect` |  | 4 distinct: `E2(SpecifyEffectDirectly("battle/effect/skill_unique/illusionist/illusionist_rea` ×2, `E1(SpecifyEffectDirectly("battle/effect/skill_unique/docking_beast_xm19/multibal` ×2, `E1(SpecifyEffectDirectly("battle/effect/skill_unique/kunoichi/multiball_kunoichi` ×2 |
| 4 | `Effect` |  | 4 distinct: `SpecifyEffectDirectly("battle/effect/skill_unique/illusionist/illusionist_appear` ×2, `SpecifyEffectDirectly("battle/effect/skill_unique/docking_beast_xm19/multiball_d` ×2, `SpecifyEffectDirectly("battle/effect/skill_unique/kunoichi/multiball_kunoichi_ef` ×2 |
| 5 | `Effect` |  | 3 distinct: `SpecifyEffectDirectly("battle/effect/skill_general/multiball/multiball_general_e` ×4, `SpecifyEffectDirectly("battle/effect/skill_unique/illusionist/illusionist_disapp` ×2, `SpecifyEffectDirectly("battle/effect/skill_unique/docking_beast_xm19/docking_bea` ×2 |
| 6 | `String` |  | 8 distinct: `"battle/action/skill/action/rare4/illusionist_multiball_1"` ×1, `"battle/action/skill/action/rare4/illusionist_multiball_2"` ×1, `"battle/action/skill/action/rare4/docking_beast_xm19_multiball_1"` ×1 |
| 7 | `int` |  | 1 distinct: `0` ×8 |
| 8 | `Boolean` |  | 1 distinct: `false` ×8 |

### StartPiercing

Used by **4** skills; client index 77.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 1 distinct: `-17` ×7 |
| 2 | `int` |  | 2 distinct: `10` ×5, `40` ×2 |

### ConditionalsHealthPointRatioOf

Used by **3** skills; client index 55.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 3 distinct: `-17` ×2, `4` ×2, `2` ×2 |
| 2 | `int` |  | 2 distinct: `50` ×4, `40` ×2 |
| 3 | `ActionDslExpression` |  | 2 distinct: `Block(1)` ×4, `Block(0)` ×2 |
| 4 | `ActionDslExpression` |  | 2 distinct: `Block(0)` ×4, `Block(1)` ×2 |

### TargetMate

Used by **3** skills; client index 87.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 5 distinct: `9` ×2, `10` ×2, `11` ×2 |
| 2 | `Array` |  | 4 distinct: `[]` ×4, `[1]` ×2, `[1, 3, 4, 5, 6, 7]` ×2 |
| 3 | `Array` |  | 1 distinct: `[]` ×10 |
| 4 | `Array` |  | 1 distinct: `[]` ×10 |
| 5 | `Array` |  | 1 distinct: `[]` ×10 |
| 6 | `Array` |  | 3 distinct: `[]` ×6, `[1, 3, 4, 5, 6]` ×2, `[2]` ×2 |

### RemoveMultiball

Used by **2** skills; client index 83.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `Boolean` |  | 1 distinct: `true` ×4 |
| 2 | `Array` |  | 2 distinct: `[1111711, 1111712]` ×2, `[1110811, 1110812]` ×2 |

### BindCoffinRevivalCountVariable

Used by **2** skills; client index 103.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 1 distinct: `113` ×6 |
| 2 | `Array` |  | 2 distinct: `[]` ×4, `[6]` ×2 |
| 3 | `Array` |  | 1 distinct: `[]` ×6 |
| 4 | `Array` |  | 1 distinct: `[]` ×6 |
| 5 | `Array` |  | 1 distinct: `[]` ×6 |
| 6 | `Array` |  | 1 distinct: `[]` ×6 |
| 7 | `int` |  | 3 distinct: `4` ×2, `5` ×2, `7` ×2 |
| 8 | `int` |  | 1 distinct: `1` ×6 |
| 9 | `Number` |  | 2 distinct: `4` ×4, `10` ×2 |

### SuppressBallActivity

Used by **1** skills; client index 94.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 1 distinct: `-18` ×2 |
| 2 | `Array` |  | 2 distinct: `240` ×1, `270~300` ×1 |

### CreateCollider

Used by **1** skills; client index 95.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 1 distinct: `2` ×2 |
| 2 | `String` |  | 1 distinct: `"剛体"` ×2 |
| 3 | `ColliderShape` |  | 1 distinct: `Rectangle(600, 70)` ×2 |
| 4 | `ColliderLifetime` |  | 2 distinct: `SpecificFrameSLv(310)` ×1, `SpecificFrameSLv(340~370)` ×1 |
| 5 | `CoordSysSource` |  | 1 distinct: `AB` ×2 |
| 6 | `int` |  | 1 distinct: `0` ×2 |
| 7 | `int` |  | 1 distinct: `0` ×2 |
| 8 | `Number` |  | 1 distinct: `0` ×2 |
| 9 | `Boolean` |  | 1 distinct: `true` ×2 |
| 10 | `Boolean` |  | 1 distinct: `false` ×2 |

### SuppressSkill

Used by **1** skills; client index 99.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 1 distinct: `-18` ×2 |
| 2 | `Array` |  | 1 distinct: `210` ×2 |

### ConditionalsProbability

Used by **1** skills; client index 105.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `ActionDslExpression` |  | 1 distinct: `Block(2)` ×2 |

### ProbabilityWeight

Used by **1** skills; client index 106.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `Number` |  | 2 distinct: `5` ×2, `95` ×2 |

### ConditionalsConditionAccumulationNumber

Used by **1** skills; client index 72.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `DeletionalConditionKind` |  | 1 distinct: `DCUnique(10)` ×2 |
| 2 | `int` |  | 1 distinct: `1` ×2 |
| 3 | `ActionDslExpression` |  | 1 distinct: `Block(3)` ×2 |
| 4 | `ActionDslExpression` |  | 1 distinct: `Block(2)` ×2 |

### ConsumeUniqueCondition

Used by **1** skills; client index 93.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 1 distinct: `-17` ×2 |
| 2 | `int` |  | 1 distinct: `10` ×2 |
| 3 | `Option` |  | 1 distinct: `Some(1)` ×2 |

### BindConditionAccumulationVariable

Used by **1** skills; client index 101.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 1 distinct: `-17` ×4 |
| 2 | `int` |  | 2 distinct: `1` ×2, `2` ×2 |
| 3 | `DeletionalConditionKind` |  | 1 distinct: `DCUnique(11)` ×4 |
| 4 | `int` |  | 1 distinct: `1` ×4 |
| 5 | `Number` |  | 1 distinct: `10` ×4 |

### IfThisCharacterIsLeader

Used by **1** skills; client index 64.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 1 distinct: `-17` ×2 |
| 2 | `ActionDslExpression` |  | 1 distinct: `Block(1)` ×2 |
| 3 | `ActionDslExpression` |  | 1 distinct: `Block(0)` ×2 |

### BindCoffinRevivalCountVariableOf

Used by **1** skills; client index 102.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 1 distinct: `-17` ×2 |
| 2 | `int` |  | 1 distinct: `4` ×2 |
| 3 | `int` |  | 1 distinct: `1` ×2 |
| 4 | `Number` |  | 1 distinct: `4` ×2 |

### RotateHitArea

Used by **1** skills; client index 26.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 1 distinct: `0` ×2 |
| 2 | `Number` |  | 1 distinct: `0.09599310885968812` ×2 |
| 3 | `TweenSource` |  | 1 distinct: `None` ×2 |

### ConditionalsSkillPoint200Percent

Used by **1** skills; client index 56.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `Boolean` |  | 1 distinct: `true` ×2 |
| 2 | `ActionDslExpression` |  | 1 distinct: `Block(1)` ×2 |
| 3 | `ActionDslExpression` |  | 1 distinct: `Block(0)` ×2 |

### ConditionalsNumCoffins

Used by **1** skills; client index 60.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `ActionDslExpression` |  | 1 distinct: `Block(0)` ×2 |
| 2 | `ActionDslExpression` |  | 1 distinct: `Block(0)` ×2 |
| 3 | `ActionDslExpression` |  | 1 distinct: `Block(1)` ×2 |

### StartModifierField

Used by **1** skills; client index 84.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 1 distinct: `9999999` ×2 |
| 2 | `Array` |  | 1 distinct: `[Attack(12.5)]` ×2 |
| 3 | `ModifierFieldCancelTriggerSourceKind` |  | 1 distinct: `None` ×2 |

### CreateFixedAttack

Used by **1** skills; client index 17.

| # | Type | Meaning | Values seen |
|---|---|---|---|
| 1 | `int` |  | 1 distinct: `2` ×1 |
| 2 | `Array` |  | 1 distinct: `2020` ×1 |
| 3 | `FixedAttackHitEffect` |  | 1 distinct: `Generic` ×1 |

## Commands no CN skill uses (55)

In the client but in no skill script (some are used by enemies or other actions):

`ChangeBgm` (2 params), `ChangeFieldAnimation` (2 params), `ChangeFieldAssets` (16 params), `ConditionalsCoffinCountFilter` (11 params), `ConditionalsCoffinCountSubject` (6 params), `ConditionalsCombo` (3 params), `ConditionalsConditionExist` (4 params), `ConditionalsHitAreaHitCount` (4 params), `ConditionalsMainOrUnison` (2 params), `ConditionalsNumExecutions2` (3 params), `ConditionalsNumExecutions3` (4 params), `ConditionalsNumExecutions4` (5 params), `ConditionalsNumExecutions5` (6 params), `ConditionalsNumExecutionsOddOrEven` (2 params), `ConditionalsUnifyElement` (4 params), `CreateFlood` (1 params), `CreateGravitationalField` (10 params), `CreateNormalHeal` (5 params), `CreateOneWayWallGimmick` (8 params), `CreateOnlyHitAttack` (6 params), `CreatePointsDistanceDetector` (6 params), `CreateShield` (8 params), `CreateShockWaveAttack` (14 params), `CreateTargetAttack` (5 params), `CreateTornado` (8 params), `CreateWallDistanceDetector` (4 params), `CreateWindAttack` (3 params), `EliminateAlterEgo` (1 params), `EliminateFunnel` (1 params), `EraseHitArea` (1 params), `ExtendCondition` (3 params), `FadeOutBgm` (1 params), `FindMultiballSubjects` (6 params), `HideEffectFromOwner` (1 params), `IfThisCharacterIsSpecificBoss` (4 params), `IfThisCharacterIsSpecificFunnel` (4 params), `MultiballNumberVariable` (6 params), `NotifyPowerflipEnd` (1 params), `RecoveryHitCountCheck` (3 params), `RemoveCollider` (1 params), `RemoveColliderFromOwner` (1 params), `RemoveEventFromOwner` (1 params), `RemoveOneWayWallGimmick` (1 params), `Revive` (2 params), `SetHitAreaSomeHitsWithAnyTargetHandler` (3 params), `SetHitAreaSomeHitsWithSpecificTargetHandler` (4 params), `SetHitAreaTerminateHandler` (2 params), `SetPowerFilpSuppress` (1 params), `SpawnAlterEgo` (4 params), `SpawnFunnel` (4 params), `StartBuffField` (3 params), `StopPiercing` (1 params), `SubtractFeverPoint` (1 params), `SubtractSkillPoint` (2 params), `Trace` (1 params)

## Multiball ids (CreateSummonsMultiball, setting 2)

A multiball id is the owning unit's id plus one digit. They're defined in the client's own multiball table
(`pinball.master.generated.MultiballTable`: character, image, element, rarity, kind, action, auto-invocation
condition...), a built-in table the dashboard doesn't read. The ids CN's skills summon (2026-11-17 scan):

| Owner (unit id) | Multiball ids |
|---|---|
| Marina (111002) | 1110021, 1110022 |
| Kikuno (111006) | 1110061 - 1110064 |
| Suizen (111039) | 1110391 - 1110394 |
| Ryunon (111081) | 1110811, 1110812 |
| Dedalia (111135) | 1111351, 1111352 |
| Stinelle (111147) | 1111471, 1111472 |
| Couette (111171) | 1111711, 1111712 |
| Gold Ship (113001) | 1130011 |
| Couette (161039) | 1610391, 1610392 |
| Denah (161051) | 1610511, 1610512 |
| Couette (161087) | 1610871, 1610872 |
| Yukariko Kuguri (161129) | 1611291, 1611292 |
| Nephtim (161177) | 1611771, 1611772 |
| Marden (161189) | 1611891, 1611892 |
| Chatrina (161195) | 1611951, 1611952 |
| Lyla (251006) | 2510061 - 2510063 |
| Arum (261001) | 2610011, 2610012 |
| Ryuichi Kageoka (261065) | 2610651, 2610652 |
| Tae Yamada (263003) | 2630031, 2630032 |
| Marnie (311002) | 3110021 - 3110023 |
| Colt (331010) | 3310101, 3310102 |
| Aureo (351004) | 3510041, 3510042 |

Bomb multiballs (`CreateBombMultiball`) name a sprite instead: `character/bomb` (Hanabi), `character/illusionist_ball`
(Illumine), `character/docking_beast_xm19_multiball` (Aureo 231007), `character/ruin_girl_meteor` (Nephtim 151001),
plus the bomb's own skill script. Tested: a skill summoned another unit's multiball (Clara, emulator, 2026-11-17).
