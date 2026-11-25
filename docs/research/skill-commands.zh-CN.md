# 技能脚本指令（研究，2026-11-16）

> 本页是 [skill-commands.md](skill-commands.md) 的中文版，由 Claude（AI）翻译。两者内容相同；如有出入，以英文版为准。

> [!IMPORTANT]
> ## 🤖 由 AI 撰写
> 由 **Claude**（Anthropic 的 AI）在 Claude Code 会话中撰写。指令列表和参数类型来自已安装的国服 1.8.1 客户端
> （`pinball.battle.action.dsl.ActionDslCommand`，用 FFDec 导出）；值来自国服的每个技能脚本（`master/skill/action_skill`
> 第 7 列）。含义来自客户端的战斗代码（`ActionEvaluator.evalCommand` 及它创建的对象）；标为 *（推测）* 的是根据值和名称
> 做出的推测。

技能编辑器的基础资料（尚未制作）。技能、特效及其位置怎样运作，以及游戏内的
测试，见 [skill-effects.md](skill-effects.md)（英文）。

## 脚本的存储方式

技能脚本是经过 raw deflate 压缩的 AMF3 数据（`<路径>.action.dsl.amf3.deflate`）；`scripts/amf3.cjs` 可以读写它
（用 `writeAmf3` 写出的脚本在战斗中被接受了）。按 JSON 读出来是 `["ActionDsl", 1, ..., ["Block", [指令]]]`，
每条指令是 `["Command", ["<名称>", 参数1, 参数2, ...]]`。枚举是数组（`["Circle", [{"min":200,"max":200}]]`、
`["AB"]`），随技能等级变化的数值是 `[{min, max}]` 列表，块是 `["Block", [指令]]`。

**对象（subject）**用编号表示：`-17` 使用技能的角色，`-18` 它的球，`-33` 队伍，`-1` / `-2` 战场的中心 / 左上角
（`ActionEvaluationResolver`）。创建某种东西（区域、群组、点）的指令，会在它们的块内把它绑定到脚本自选的一个编号上。

## 国服技能使用的指令（客户端 106 条中的 51 条）

“技能”= 使用该指令的技能行脚本（基础技能、技能+ 以及其他 action skill）。值：最常用的几个，×次数。

### ShowEffect

显示一个特效。已测试（harpy、克菈菈）。被 **494** 个技能使用；客户端序号 10。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `String` | 标签（脚本可以用这个名称隐藏它） | 638 种：`"攻撃演出"` ×185, `"全体演出"` ×160, `"ヒット演出"` ×144 |
| 2 | `Effect` | 特效：ResolveByElement(path) = 对应角色属性的那一份，SpecifyEffectDirectly(path) = 就是该文件 | 694 种：`SpecifyEffectDirectly("battle/effect/skill_unique/spry_sailor_hw21/spry_sailor_h` ×104, `SpecifyEffectDirectly("battle/effect/skill_unique/wind_oracle_1anv/wind_oracle_1` ×98, `SpecifyEffectDirectly("battle/effect/skill_unique/mermaid_1halfanv/mermaid_1half` ×94 |
| 3 | `int` | 附着于：一个对象编号 | 61 种：`-18` ×1225, `0` ×489, `1` ×395 |
| 4 | `LayerZDepth` | 图层（例如 ForesideOfCharacter） | 5 种：`ForesideOfCharacter` ×3093, `BacksideOfCharacter` ×271, `SuperForesideOfCharacter` ×220 |
| 5 | `EffectLifetime` | 持续时间：UntilTargetTerminates、SpecificFrame(n)、SpecificFrameSLv、PlayOnlyFirstSequence…… | 90 种：`PlayOnlyFirstSequence` ×2436, `UntilTargetTerminates` ×507, `SpecifyEffectLifetimeDirectly(60)` ×116 |
| 6 | `CoordSysSource` | 方向：AB 屏幕向上，EF 移动方向，CD 攻击判定区域的旋转，GH(id) 朝向某个对象 | 29 种：`AB` ×2622, `CD` ×548, `EF` ×216 |
| 7 | `int` | 偏移 X | 21 种：`0` ×3550, `100` ×23, `-100` ×23 |
| 8 | `int` | 偏移 Y（正数 = 屏幕向下） | 47 种：`0` ×3175, `-200` ×66, `-30` ×64 |
| 9 | `Number` | 旋转（弧度，叠加） | 34 种：`0` ×3474, `3.141592653589793` ×66, `0.7853981633974483` ×10 |
| 10 | `Boolean` | 跟随位置 | 2 种：`true` ×2188, `false` ×1452 |
| 11 | `Boolean` | 跟随方向 | 2 种：`false` ×2535, `true` ×1105 |
| 12 | `Option` | 缩放：Some(min~max) 随技能等级变化，或 None | 39 种：`None` ×1826, `Some(1)` ×386, `Some(2)` ×249 |

### CreateHitArea

创建攻击判定区域。已测试（harpy：偏移 Y 250 = 在下方）。被 **401** 个技能使用；客户端序号 24。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `String` | 标签 | 4 种：`"*"` ×1687, `"チャクラム"` ×3, `"銃弾"` ×2 |
| 2 | `int` | 附着于：一个对象编号（-18 = 角色的球） | 28 种：`-18` ×855, `0` ×270, `1` ×194 |
| 3 | `CoordSysSource` | 方向（同 ShowEffect） | 33 种：`AB` ×1142, `EF` ×236, `CD` ×119 |
| 4 | `int` | 偏移 X | 43 种：`0` ×1514, `-60` ×26, `60` ×24 |
| 5 | `int` | 偏移 Y（正数 = 向下） | 53 种：`0` ×1174, `-150` ×98, `-200` ×66 |
| 6 | `Number` | 旋转（弧度） | 35 种：`0` ×1530, `0.17453292519943295` ×10, `1.0471975511965976` ×10 |
| 7 | `Boolean` | 跟随位置（推测：同 ShowEffect） | 2 种：`true` ×869, `false` ×825 |
| 8 | `Boolean` | 跟随方向（推测） | 2 种：`false` ×1361, `true` ×333 |
| 9 | `Shape` | 形状：Circle(r)、Rectangle(w, h)、Arc、Donut…… | 135 种：`Circle(200)` ×186, `Circle(250)` ×123, `Rectangle(1500, 2000)` ×117 |
| 10 | `HAlign` | 水平对齐 | 1 种：`Center` ×1694 |
| 11 | `VAlign` | 垂直对齐（Center、Bottom、Top） | 3 种：`Center` ×1352, `Bottom` ×254, `Top` ×88 |
| 12 | `Formation` | 阵型：Single、NWay(n, angle)、Circle(n, r)……（一次多个区域） | 21 种：`Single` ×1627, `NWay(9, 0.13962634015954636)` ×8, `NWay(6, 1.0471975511965976)` ×6 |
| 13 | `ActionHitAreaLifetime` | 持续时间：SpecifyHitAreaLifetimeDirectly(帧数)、SpecifyHitAreaLifetimeSLv、RemainingFramesOfCurrentStateGroup | 79 种：`SpecifyHitAreaLifetimeDirectly(60)` ×181, `SpecifyHitAreaLifetimeDirectly(30)` ×155, `SpecifyHitAreaLifetimeDirectly(20)` ×154 |
| 14 | `MinHitInterval` | 最小命中间隔：CalculatedUsingMaxNumOfHits(n) 或 SpecifyMinHitIntervalDirectly(帧数) | 38 种：`CalculatedUsingMaxNumOfHits(1)` ×1020, `CalculatedUsingMaxNumOfHits(3)` ×101, `CalculatedUsingMaxNumOfHits(10)` ×55 |
| 15 | `Option` | 最大命中次数（Some(n) / None） | 22 种：`None` ×1029, `Some(1)` ×453, `Some(3)` ×32 |
| 16 | `Boolean` | （推测）标志 | 2 种：`false` ×1588, `true` ×106 |
| 17 | `Boolean` | 能打破弱点 | 2 种：`true` ×1621, `false` ×73 |
| 18 | `Option` | （推测）选项 | 2 种：`None` ×1692, `Some(9)` ×2 |
| 19 | `int` | 新区域在下一个块中的编号 | 50 种：`0` ×334, `1` ×289, `3` ×140 |
| 20 | `ActionDslExpression` | 每个区域出现时运行一次的块（特效放在这里） | 7 种：`Block(0)` ×673, `Block(1)` ×520, `Block(2)` ×379 |
| 21 | `int` | 区域在命中块中的编号 | 50 种：`1` ×334, `2` ×289, `4` ×140 |
| 22 | `int` | 命中目标在命中块中的编号 | 50 种：`2` ×334, `3` ×289, `5` ×140 |
| 23 | `ActionDslExpression` | 每次命中时运行的块（CreateNormalAttack、ShakeCamera……） | 11 种：`Block(2)` ×814, `Block(1)` ×547, `Block(3)` ×228 |
| 24 | `int` | （推测）整数 | 2 种：`0` ×1684, `4` ×10 |
| 25 | `int` | （推测）整数 | 2 种：`0` ×1686, `1` ×8 |
| 26 | `HitAreaGuardMode` | 防御模式 | 1 种：`None` ×1694 |

### CreateCondition

施加增益或减益（一个状态，condition）。已测试（harpy 的攻击力上升）。被 **396** 个技能使用；客户端序号 21。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` | 目标：一个对象编号（-17 = 角色自身） | 29 种：`-17` ×277, `0` ×267, `3` ×171 |
| 2 | `Array` | 状态：例如 [ACAttackPoint(帧数, 数值, 次数)] = 在该帧数内攻击力上升该数值（0.4 = +40 %） | 696 种：`[ACAttackPoint(900, 0.4~0.5, 1)]` ×36, `[ACAttackPoint(720, 0.3, 1)]` ×35, `[ACAttackPoint(900, 0.85~1, 1)]` ×16 |
| 3 | `Array` | （推测）强度系数，通常为 1 | 6 种：`1` ×1422, `0.5` ×13, `[{"alv_min":1,"alv_max":1}]` ×8 |
| 4 | `ConditionHitEffect` | 显示的标记：GenericConditionHitEffect、None 或指定的特效 | 3 种：`GenericConditionHitEffect` ×1379, `None` ×71, `SpecifyConditionHitEffectDirectly(SpecifyEffectDirectly("battle/effect/skill_uni` ×2 |
| 5 | `Boolean` | （推测）标志，通常为 true | 2 种：`true` ×1430, `false` ×22 |
| 6 | `Boolean` | （推测）标志，通常为 false | 2 种：`false` ×1435, `true` ×17 |
| 7 | `String` | 标签（用于之后移除它） | 17 种：`""` ×1396, `"スペシャルウィーク最大速度固定"` ×4, `"スペシャルウィーク攻撃力"` ×4 |
| 8 | `HitCountCheckTargetKind` | 命中次数检查（推测） | 1 种：`null` ×1452 |
| 9 | `Boolean` | （推测）标志 | 1 种：`false` ×1452 |
| 10 | `int` | （推测）分组/叠加种类：大多为 3 | 3 种：`3` ×1228, `1` ×138, `2` ×86 |
| 11 | `Array` | （推测）数组，通常为 1 | 1 种：`1` ×1452 |
| 12 | `Boolean` | （推测）标志 | 2 种：`false` ×1442, `true` ×10 |

### CreateNormalAttack

命中时的效果：普通伤害（位于攻击判定区域的命中块中）。被 **390** 个技能使用；客户端序号 15。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` | 目标：对象编号（命中目标，例如 3） | 52 种：`2` ×285, `3` ×253, `5` ×130 |
| 2 | `int` | 属性：255 = 角色自己的属性 | 5 种：`255` ×1527, `3` ×24, `4` ×6 |
| 3 | `Array` | （推测）数组 | 5 种：`[]` ×1544, `[8197]` ×10, `[8194, 8199]` ×4 |
| 4 | `Array` | （推测）数组 | 5 种：`[]` ×1528, `[DCParalysis]` ×20, `[DCFrozen]` ×10 |
| 5 | `int` | （推测）整数 | 100 种：`8` ×141, `10` ×98, `5` ×89 |
| 6 | `Array` | 伤害倍率（min~max 随技能等级变化） | 525 种：`1` ×29, `1.3~1.5` ×26, `2` ×22 |
| 7 | `Array` | （推测）数组，通常为 0 | 3 种：`0` ×1544, `0.5` ×16, `0.25` ×2 |
| 8 | `Boolean` | （推测）标志 | 2 种：`false` ×1506, `true` ×56 |
| 9 | `Boolean` | （推测）标志 | 2 种：`false` ×1540, `true` ×22 |
| 10 | `Boolean` | （推测）标志 | 2 种：`false` ×1456, `true` ×106 |
| 11 | `Boolean` | （推测）标志 | 1 种：`false` ×1562 |
| 12 | `Boolean` | （推测）标志 | 2 种：`false` ×1557, `true` ×5 |
| 13 | `Array` | （推测）数组 | 103 种：`1` ×169, `2` ×111, `0.6666666666666666` ×93 |
| 14 | `Array` | （推测）数组 | 76 种：`1` ×253, `2` ×136, `3` ×92 |
| 15 | `AttackHitEffect` | 命中特效：Fine、Coarse、Slash…… | 63 种：`Fine` ×694, `None` ×287, `Coarse` ×243 |
| 16 | `Boolean` | （推测）标志 | 1 种：`true` ×1562 |

### ShakeCamera

镜头震动。被 **345** 个技能使用；客户端序号 5。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` | 幅度：1 小，2 中，3 大（CameraShakeSize） | 3 种：`1` ×723, `2` ×416, `3` ×162 |

### StopBall

让角色的球停住或减速一段时间（大多数技能在播放时会让球暂停）。被 **336** 个技能使用；客户端序号 14。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` | 球：对象编号（-18） | 1 种：`-18` ×734 |
| 2 | `int` | 帧数 | 53 种：`10` ×165, `30` ×90, `60` ×76 |
| 3 | `EndingSpeedKind` | 之后：Stop、RestoreToSpeedBeforeActionExecution、RestoreToSpeedBeforeCommandExecution | 3 种：`Stop` ×371, `RestoreToSpeedBeforeActionExecution` ×301, `RestoreToSpeedBeforeCommandExecution` ×62 |
| 4 | `CoordSysSource` | 方向（同 ShowEffect） | 7 种：`AB` ×402, `EF` ×274, `GH(0)` ×42 |
| 5 | `Number` | 角度 | 1 种：`0` ×734 |

### FindAllSubjects

选出一个群组（队伍、所有敌人……），把它绑定到一个编号后运行一个块。被 **288** 个技能使用；客户端序号 3。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` | 群组在块中的编号 | 27 种：`0` ×295, `1` ×177, `3` ×128 |
| 2 | `int` | 哪个群组（33 = 队伍，如克菈菈强化弹射的增益） | 15 种：`33` ×414, `113` ×232, `145` ×170 |
| 3 | `Array` | （推测）筛选条件 | 10 种：`[]` ×744, `[2]` ×64, `[4]` ×60 |
| 4 | `Array` | （推测）筛选条件 | 1 种：`[]` ×1069 |
| 5 | `Array` | （推测）筛选条件 | 1 种：`[]` ×1069 |
| 6 | `Array` | （推测）筛选条件 | 2 种：`[]` ×1065, `[12290]` ×4 |
| 7 | `Array` | （推测）筛选条件 | 1 种：`[]` ×1069 |
| 8 | `IfTargetNotFound` | 找不到任何对象时：DoNothing…… | 2 种：`DoNothing` ×1067, `CreateImaginaryTarget(-192)` ×2 |
| 9 | `ActionDslExpression` | 块 | 5 种：`Block(1)` ×859, `Block(2)` ×166, `Block(3)` ×30 |

### CreateReferencePoint

一个点（例如在某个对象处，带偏移），区域和特效可以附着在它上面或瞄准它。被 **163** 个技能使用；客户端序号 32。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` | 位置：对象编号 | 23 种：`-18` ×260, `0` ×79, `1` ×33 |
| 2 | `CoordSysSource` | 方向 | 8 种：`AB` ×336, `GH(0)` ×45, `CD` ×26 |
| 3 | `int` | 偏移 X | 7 种：`0` ×417, `40` ×8, `5` ×5 |
| 4 | `int` | 偏移 Y | 36 种：`0` ×265, `-300` ×20, `-250` ×16 |
| 5 | `Number` | 旋转 | 3 种：`0` ×442, `0.6981317007977318` ×2, `-0.6981317007977318` ×2 |
| 6 | `Boolean` | 跟随位置（推测） | 2 种：`false` ×375, `true` ×71 |
| 7 | `Boolean` | 跟随方向（推测） | 2 种：`false` ×434, `true` ×12 |
| 8 | `Formation` | 阵型（推测） | 1 种：`Single` ×446 |
| 9 | `int` | （推测）整数 | 45 种：`60` ×69, `100` ×47, `150` ×42 |
| 10 | `int` | 点在块中的编号 | 34 种：`0` ×155, `1` ×102, `2` ×31 |
| 11 | `ActionDslExpression` | 块 | 11 种：`Block(2)` ×136, `Block(1)` ×132, `Block(3)` ×105 |

### FindNearSubjects

选出最近的对象（例如最近的敌人），并用它们运行一个块。被 **132** 个技能使用；客户端序号 4。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` | 起点：对象编号 | 3 种：`-18` ×353, `-17` ×10, `4` ×2 |
| 2 | `int` | （推测）数量 | 2 种：`1` ×361, `100` ×4 |
| 3 | `int` | （推测）种类 | 4 种：`49` ×351, `51` ×10, `50` ×2 |
| 4 | `IfTargetNotFound` | 找不到任何对象时 | 7 种：`CreateImaginaryTarget(-100000)` ×147, `CreateImaginaryTarget(-1000000)` ×121, `DoNothing` ×58 |
| 5 | `int` | 它们在块中的编号 | 29 种：`0` ×225, `1` ×34, `4` ×15 |
| 6 | `ActionDslExpression` | 块 | 6 种：`Block(1)` ×260, `Block(2)` ×59, `Block(3)` ×34 |

### MoveHitArea

移动攻击判定区域（会飞出去的斩击）。被 **90** 个技能使用；客户端序号 25。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` | 区域：对象编号 | 48 种：`0` ×108, `1` ×66, `6` ×31 |
| 2 | `CoordSysSource` | 方向 | 22 种：`CD` ×249, `AB` ×243, `GH(0)` ×7 |
| 3 | `Number` | 角度 | 6 种：`0` ×506, `-1.5707963267948966` ×10, `1.7453292519943295` ×9 |
| 4 | `Number` | 速度 | 28 种：`30` ×149, `40` ×60, `0` ×54 |
| 5 | `TweenSource` | （推测）选项 | 7 种：`None` ×525, `Some(30, CubicIn)` ×9, `Some(20, CubicOut)` ×3 |

### MoveBall

移动角色的球（冲刺、突进）。被 **76** 个技能使用；客户端序号 13。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` | 球：对象编号（-18） | 2 种：`-18` ×206, `4` ×2 |
| 2 | `CoordSysSource` | 方向（GH(id) = 朝向某个对象） | 10 种：`GH(0)` ×83, `AB` ×65, `GH(1)` ×25 |
| 3 | `Number` | 角度（弧度） | 8 种：`0` ×188, `3.141592653589793` ×8, `2.356194490192345` ×2 |
| 4 | `int` | 帧数 | 19 种：`2` ×64, `1` ×48, `10` ×24 |
| 5 | `Number` | 速度 | 25 种：`10` ×32, `30` ×28, `15` ×23 |
| 6 | `EndingSpeedKind` | 之后：KeepGoing、Stop、Restore…… | 3 种：`KeepGoing` ×162, `Stop` ×43, `RestoreToSpeedBeforeCommandExecution` ×3 |
| 7 | `Boolean` | （推测）标志 | 2 种：`true` ×182, `false` ×26 |

### CreateRatioHeal

按最大 HP 的比例治疗。被 **73** 个技能使用；客户端序号 20。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` | 目标：对象编号 | 18 种：`-33` ×90, `1` ×76, `2` ×58 |
| 2 | `int` | （推测）种类 | 1 种：`2` ×347 |
| 3 | `Array` | 比例（0.05 = 5 %） | 25 种：`0.06` ×77, `0.08~0.1` ×73, `0.04` ×43 |
| 4 | `Array` | （推测）数组 | 9 种：`[2]` ×72, `[5]` ×70, `[4]` ×50 |
| 5 | `Array` | （推测）系数 | 3 种：`0.5` ×317, `0` ×28, `1` ×2 |
| 6 | `HealHitEffect` | 标记：GenericHealHitEffect…… | 7 种：`GenericHealHitEffect` ×300, `None` ×22, `SpecifyHealEffectDirectly(SpecifyEffectDirectly("battle/effect/skill_unique/bish` ×8 |

### DeleteCondition

移除某个对象的增益/减益（根据名称推测）。被 **66** 个技能使用；客户端序号 22。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 14 种：`0` ×42, `2` ×22, `3` ×20 |
| 2 | `DeletionalConditionKind` |  | 2 种：`DCAll(3)` ×96, `DCAll(2)` ×72 |
| 3 | `int` |  | 3 种：`1` ×147, `2` ×19, `999` ×2 |
| 4 | `int` |  | 2 种：`0` ×166, `2` ×2 |
| 5 | `String` |  | 1 种：`""` ×168 |
| 6 | `DeleteConditionSyncMode` |  | 1 种：`Default` ×168 |

### HideCharacter

让角色的精灵图隐藏一段时间。被 **51** 个技能使用；客户端序号 39。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` | 对象编号 | 1 种：`-17` ×111 |
| 2 | `int` | 帧数 | 39 种：`90` ×10, `120` ×9, `65` ×7 |

### ConditionalsChangeSkillFlag

被 **28** 个技能使用；客户端序号 86。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 1 种：`1` ×62 |
| 2 | `ActionDslExpression` |  | 4 种：`Block(1)` ×44, `Block(2)` ×12, `Block(0)` ×4 |
| 3 | `ActionDslExpression` |  | 4 种：`Block(0)` ×34, `Block(1)` ×16, `Block(2)` ×10 |

### AddFeverPoint

增加 FEVER 槽。被 **27** 个技能使用；客户端序号 8。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `Array` | 数量（min~max） | 28 种：`25~30` ×5, `65~75` ×4, `50` ×3 |

### HideEffect

按标签提前结束一个特效。被 **25** 个技能使用；客户端序号 11。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `String` | 标签 | 21 种：`"突進演出"` ×34, `"突進ドット"` ×10, `"突進"` ×4 |

### CreateSummonsMultiball

被 **23** 个技能使用；客户端序号 36。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 3 种：`1` ×36, `2` ×11, `3` ×4 |
| 2 | `int` |  | 49 种：`1130011` ×2, `1110021` ×2, `2630031` ×1 |
| 3 | `Array` |  | 7 种：`9000` ×18, `1800` ×17, `1500` ×8 |
| 4 | `MultiballReadyEffect` |  | 19 种：`E1(SpecifyEffectDirectly("battle/effect/skill_general/multiball/multiball_genera` ×7, `E2(SpecifyEffectDirectly("battle/effect/skill_unique/shadow_redhood/shadow_redho` ×4, `E2(SpecifyEffectDirectly("battle/effect/skill_unique/compliment_oiran/compliment` ×4 |
| 5 | `Effect` |  | 19 种：`SpecifyEffectDirectly("battle/effect/skill_general/multiball/multiball_general_e` ×7, `SpecifyEffectDirectly("battle/effect/skill_unique/shadow_redhood/shadow_redhood_` ×4, `SpecifyEffectDirectly("battle/effect/skill_unique/compliment_oiran/compliment_oi` ×4 |
| 6 | `Effect` |  | 20 种：`SpecifyEffectDirectly("battle/effect/skill_general/multiball/multiball_general_e` ×7, `SpecifyEffectDirectly("battle/effect/skill_unique/compliment_oiran/compliment_oi` ×4, `SpecifyEffectDirectly("battle/effect/skill_unique/onmyoji_boy_wt21/onmyoji_boy_w` ×4 |
| 7 | `int` |  | 3 种：`0` ×47, `5` ×2, `65` ×2 |
| 8 | `Boolean` |  | 2 种：`false` ×47, `true` ×4 |
| 9 | `String` |  | 1 种：`"*"` ×51 |
| 10 | `int` |  | 5 种：`0` ×25, `4` ×12, `3` ×6 |
| 11 | `int` |  | 5 种：`1` ×25, `5` ×12, `4` ×6 |
| 12 | `ActionDslExpression` |  | 2 种：`null` ×49, `Block(2)` ×2 |
| 13 | `Object` |  | 2 种：`null` ×49, `1` ×2 |

### RemoveEvent

被 **20** 个技能使用；客户端序号 1。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `String` |  | 20 种：`"突進イベント"` ×30, `"衝突イベント"` ×6, `"衝突しないイベント"` ×4 |

### CreateRatioAttack

被 **17** 个技能使用；客户端序号 16。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 11 种：`-17` ×16, `0` ×10, `4` ×4 |
| 2 | `int` |  | 1 种：`2` ×41 |
| 3 | `Array` |  | 8 种：`0.1` ×17, `0.2` ×7, `0.05` ×5 |

### ConditionalsFeverMode

被 **14** 个技能使用；客户端序号 57。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `ActionDslExpression` |  | 5 种：`Block(0)` ×14, `Block(1)` ×6, `Block(2)` ×4 |
| 2 | `ActionDslExpression` |  | 5 种：`Block(1)` ×16, `Block(0)` ×4, `Block(4)` ×4 |

### CreateBarrier

护盾（barrier）。被 **12** 个技能使用；客户端序号 58。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` | 目标：对象编号 | 5 种：`0` ×9, `1` ×6, `-17` ×4 |
| 2 | `Array` | 强度（min~max） | 13 种：`0.03` ×4, `0.045~0.06` ×3, `0.06` ×3 |
| 3 | `BarrierHitEffect` | 命中特效 | 1 种：`GenericBarrierHitEffect` ×23 |

### AddSkillPoint

增加技能槽。被 **10** 个技能使用；客户端序号 6。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` | 目标：对象编号 | 6 种：`0` ×6, `1` ×4, `4` ×2 |
| 2 | `Array` | 数量（min~max） | 15 种：`0.05` ×2, `[{"alv_min":0.15,"alv_max":0.2}]` ×2, `0.5` ×2 |

### ConditionalsMultiballNumber

被 **10** 个技能使用；客户端序号 76。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `Array` |  | 10 种：`[1611951, 1611952]` ×2, `[1111711, 1111712]` ×2, `[1611891, 1611892]` ×2 |
| 2 | `Array` |  | 1 种：`[]` ×20 |
| 3 | `int` |  | 1 种：`1` ×20 |
| 4 | `ActionDslExpression` |  | 5 种：`Block(3)` ×8, `Block(1)` ×4, `Block(2)` ×4 |
| 5 | `ActionDslExpression` |  | 5 种：`Block(2)` ×8, `Block(0)` ×4, `Block(3)` ×4 |

### ConditionalsHealthPointRatio

按角色的 HP 分支：HP 在 X % 及以上时运行第一个块，否则运行第二个（克菈菈的 60 %）。被 **8** 个技能使用；客户端序号 54。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` | X（百分比） | 4 种：`50` ×10, `45` ×2, `30` ×2 |
| 2 | `ActionDslExpression` | 达到或高于时运行的块 | 3 种：`Block(1)` ×8, `Block(0)` ×4, `Block(3)` ×4 |
| 3 | `ActionDslExpression` | 低于时运行的块 | 3 种：`Block(1)` ×10, `Block(0)` ×4, `Block(2)` ×2 |

### AddCombo

被 **7** 个技能使用；客户端序号 82。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `Array` |  | 10 种：`6` ×2, `9~15` ×2, `4` ×2 |

### DecreaseCoffinCount

被 **6** 个技能使用；客户端序号 37。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 5 种：`3` ×4, `5` ×2, `4` ×2 |
| 2 | `int` |  | 7 种：`8` ×3, `4` ×2, `3` ×2 |
| 3 | `DecreaseCoffinCountHitEffect` |  | 1 种：`Generic` ×12 |

### IfThisCharacterIsBoss

被 **5** 个技能使用；客户端序号 61。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 3 种：`4` ×4, `2` ×4, `0` ×2 |
| 2 | `ActionDslExpression` |  | 2 种：`Block(1)` ×6, `Block(2)` ×4 |
| 3 | `ActionDslExpression` |  | 2 种：`Block(1)` ×6, `Block(2)` ×4 |

### ConditionalsRelativePositionVertical

被 **5** 个技能使用；客户端序号 104。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 2 种：`1` ×10, `-18` ×4 |
| 2 | `int` |  | 2 种：`0` ×12, `1` ×2 |
| 3 | `ActionDslExpression` |  | 2 种：`Block(1)` ×12, `Block(6)` ×2 |
| 4 | `ActionDslExpression` |  | 2 种：`Block(1)` ×12, `Block(6)` ×2 |

### CreateReferencePointAtSpecifiedPosition

被 **4** 个技能使用；客户端序号 33。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 2 种：`-1` ×6, `-18` ×2 |
| 2 | `int` |  | 3 种：`-18` ×4, `-1` ×2, `4` ×2 |
| 3 | `int` |  | 4 种：`120` ×2, `60` ×2, `230` ×2 |
| 4 | `int` |  | 2 种：`0` ×6, `5` ×2 |
| 5 | `ActionDslExpression` |  | 3 种：`Block(4)` ×4, `Block(2)` ×2, `Block(1)` ×2 |

### CreateBombMultiball

被 **4** 个技能使用；客户端序号 35。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 5 种：`2` ×2, `6` ×2, `3` ×2 |
| 2 | `String` |  | 4 种：`"character/illusionist_ball/pixelart/pixelart"` ×2, `"character/docking_beast_xm19_multiball/pixelart/pixelart"` ×2, `"character/bomb/pixelart/pixelart"` ×2 |
| 3 | `MultiballReadyEffect` |  | 4 种：`E2(SpecifyEffectDirectly("battle/effect/skill_unique/illusionist/illusionist_rea` ×2, `E1(SpecifyEffectDirectly("battle/effect/skill_unique/docking_beast_xm19/multibal` ×2, `E1(SpecifyEffectDirectly("battle/effect/skill_unique/kunoichi/multiball_kunoichi` ×2 |
| 4 | `Effect` |  | 4 种：`SpecifyEffectDirectly("battle/effect/skill_unique/illusionist/illusionist_appear` ×2, `SpecifyEffectDirectly("battle/effect/skill_unique/docking_beast_xm19/multiball_d` ×2, `SpecifyEffectDirectly("battle/effect/skill_unique/kunoichi/multiball_kunoichi_ef` ×2 |
| 5 | `Effect` |  | 3 种：`SpecifyEffectDirectly("battle/effect/skill_general/multiball/multiball_general_e` ×4, `SpecifyEffectDirectly("battle/effect/skill_unique/illusionist/illusionist_disapp` ×2, `SpecifyEffectDirectly("battle/effect/skill_unique/docking_beast_xm19/docking_bea` ×2 |
| 6 | `String` |  | 8 种：`"battle/action/skill/action/rare4/illusionist_multiball_1"` ×1, `"battle/action/skill/action/rare4/illusionist_multiball_2"` ×1, `"battle/action/skill/action/rare4/docking_beast_xm19_multiball_1"` ×1 |
| 7 | `int` |  | 1 种：`0` ×8 |
| 8 | `Boolean` |  | 1 种：`false` ×8 |

### StartPiercing

被 **4** 个技能使用；客户端序号 77。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 1 种：`-17` ×7 |
| 2 | `int` |  | 2 种：`10` ×5, `40` ×2 |

### ConditionalsHealthPointRatioOf

被 **3** 个技能使用；客户端序号 55。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 3 种：`-17` ×2, `4` ×2, `2` ×2 |
| 2 | `int` |  | 2 种：`50` ×4, `40` ×2 |
| 3 | `ActionDslExpression` |  | 2 种：`Block(1)` ×4, `Block(0)` ×2 |
| 4 | `ActionDslExpression` |  | 2 种：`Block(0)` ×4, `Block(1)` ×2 |

### TargetMate

被 **3** 个技能使用；客户端序号 87。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 5 种：`9` ×2, `10` ×2, `11` ×2 |
| 2 | `Array` |  | 4 种：`[]` ×4, `[1]` ×2, `[1, 3, 4, 5, 6, 7]` ×2 |
| 3 | `Array` |  | 1 种：`[]` ×10 |
| 4 | `Array` |  | 1 种：`[]` ×10 |
| 5 | `Array` |  | 1 种：`[]` ×10 |
| 6 | `Array` |  | 3 种：`[]` ×6, `[1, 3, 4, 5, 6]` ×2, `[2]` ×2 |

### RemoveMultiball

被 **2** 个技能使用；客户端序号 83。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `Boolean` |  | 1 种：`true` ×4 |
| 2 | `Array` |  | 2 种：`[1111711, 1111712]` ×2, `[1110811, 1110812]` ×2 |

### BindCoffinRevivalCountVariable

被 **2** 个技能使用；客户端序号 103。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 1 种：`113` ×6 |
| 2 | `Array` |  | 2 种：`[]` ×4, `[6]` ×2 |
| 3 | `Array` |  | 1 种：`[]` ×6 |
| 4 | `Array` |  | 1 种：`[]` ×6 |
| 5 | `Array` |  | 1 种：`[]` ×6 |
| 6 | `Array` |  | 1 种：`[]` ×6 |
| 7 | `int` |  | 3 种：`4` ×2, `5` ×2, `7` ×2 |
| 8 | `int` |  | 1 种：`1` ×6 |
| 9 | `Number` |  | 2 种：`4` ×4, `10` ×2 |

### SuppressBallActivity

被 **1** 个技能使用；客户端序号 94。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 1 种：`-18` ×2 |
| 2 | `Array` |  | 2 种：`240` ×1, `270~300` ×1 |

### CreateCollider

被 **1** 个技能使用；客户端序号 95。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 1 种：`2` ×2 |
| 2 | `String` |  | 1 种：`"剛体"` ×2 |
| 3 | `ColliderShape` |  | 1 种：`Rectangle(600, 70)` ×2 |
| 4 | `ColliderLifetime` |  | 2 种：`SpecificFrameSLv(310)` ×1, `SpecificFrameSLv(340~370)` ×1 |
| 5 | `CoordSysSource` |  | 1 种：`AB` ×2 |
| 6 | `int` |  | 1 种：`0` ×2 |
| 7 | `int` |  | 1 种：`0` ×2 |
| 8 | `Number` |  | 1 种：`0` ×2 |
| 9 | `Boolean` |  | 1 种：`true` ×2 |
| 10 | `Boolean` |  | 1 种：`false` ×2 |

### SuppressSkill

被 **1** 个技能使用；客户端序号 99。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 1 种：`-18` ×2 |
| 2 | `Array` |  | 1 种：`210` ×2 |

### ConditionalsProbability

被 **1** 个技能使用；客户端序号 105。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `ActionDslExpression` |  | 1 种：`Block(2)` ×2 |

### ProbabilityWeight

被 **1** 个技能使用；客户端序号 106。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `Number` |  | 2 种：`5` ×2, `95` ×2 |

### ConditionalsConditionAccumulationNumber

被 **1** 个技能使用；客户端序号 72。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `DeletionalConditionKind` |  | 1 种：`DCUnique(10)` ×2 |
| 2 | `int` |  | 1 种：`1` ×2 |
| 3 | `ActionDslExpression` |  | 1 种：`Block(3)` ×2 |
| 4 | `ActionDslExpression` |  | 1 种：`Block(2)` ×2 |

### ConsumeUniqueCondition

被 **1** 个技能使用；客户端序号 93。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 1 种：`-17` ×2 |
| 2 | `int` |  | 1 种：`10` ×2 |
| 3 | `Option` |  | 1 种：`Some(1)` ×2 |

### BindConditionAccumulationVariable

被 **1** 个技能使用；客户端序号 101。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 1 种：`-17` ×4 |
| 2 | `int` |  | 2 种：`1` ×2, `2` ×2 |
| 3 | `DeletionalConditionKind` |  | 1 种：`DCUnique(11)` ×4 |
| 4 | `int` |  | 1 种：`1` ×4 |
| 5 | `Number` |  | 1 种：`10` ×4 |

### IfThisCharacterIsLeader

被 **1** 个技能使用；客户端序号 64。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 1 种：`-17` ×2 |
| 2 | `ActionDslExpression` |  | 1 种：`Block(1)` ×2 |
| 3 | `ActionDslExpression` |  | 1 种：`Block(0)` ×2 |

### BindCoffinRevivalCountVariableOf

被 **1** 个技能使用；客户端序号 102。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 1 种：`-17` ×2 |
| 2 | `int` |  | 1 种：`4` ×2 |
| 3 | `int` |  | 1 种：`1` ×2 |
| 4 | `Number` |  | 1 种：`4` ×2 |

### RotateHitArea

被 **1** 个技能使用；客户端序号 26。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 1 种：`0` ×2 |
| 2 | `Number` |  | 1 种：`0.09599310885968812` ×2 |
| 3 | `TweenSource` |  | 1 种：`None` ×2 |

### ConditionalsSkillPoint200Percent

被 **1** 个技能使用；客户端序号 56。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `Boolean` |  | 1 种：`true` ×2 |
| 2 | `ActionDslExpression` |  | 1 种：`Block(1)` ×2 |
| 3 | `ActionDslExpression` |  | 1 种：`Block(0)` ×2 |

### ConditionalsNumCoffins

被 **1** 个技能使用；客户端序号 60。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `ActionDslExpression` |  | 1 种：`Block(0)` ×2 |
| 2 | `ActionDslExpression` |  | 1 种：`Block(0)` ×2 |
| 3 | `ActionDslExpression` |  | 1 种：`Block(1)` ×2 |

### StartModifierField

被 **1** 个技能使用；客户端序号 84。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 1 种：`9999999` ×2 |
| 2 | `Array` |  | 1 种：`[Attack(12.5)]` ×2 |
| 3 | `ModifierFieldCancelTriggerSourceKind` |  | 1 种：`None` ×2 |

### CreateFixedAttack

被 **1** 个技能使用；客户端序号 17。

| # | 类型 | 含义 | 出现过的值 |
|---|---|---|---|
| 1 | `int` |  | 1 种：`2` ×1 |
| 2 | `Array` |  | 1 种：`2020` ×1 |
| 3 | `FixedAttackHitEffect` |  | 1 种：`Generic` ×1 |

## 国服技能都没有使用的指令（55 条）

客户端中有，但没有任何技能脚本使用（其中一些被敌人或其他动作使用）：

`ChangeBgm`（2 个参数）、`ChangeFieldAnimation`（2 个参数）、`ChangeFieldAssets`（16 个参数）、`ConditionalsCoffinCountFilter`（11 个参数）、`ConditionalsCoffinCountSubject`（6 个参数）、`ConditionalsCombo`（3 个参数）、`ConditionalsConditionExist`（4 个参数）、`ConditionalsHitAreaHitCount`（4 个参数）、`ConditionalsMainOrUnison`（2 个参数）、`ConditionalsNumExecutions2`（3 个参数）、`ConditionalsNumExecutions3`（4 个参数）、`ConditionalsNumExecutions4`（5 个参数）、`ConditionalsNumExecutions5`（6 个参数）、`ConditionalsNumExecutionsOddOrEven`（2 个参数）、`ConditionalsUnifyElement`（4 个参数）、`CreateFlood`（1 个参数）、`CreateGravitationalField`（10 个参数）、`CreateNormalHeal`（5 个参数）、`CreateOneWayWallGimmick`（8 个参数）、`CreateOnlyHitAttack`（6 个参数）、`CreatePointsDistanceDetector`（6 个参数）、`CreateShield`（8 个参数）、`CreateShockWaveAttack`（14 个参数）、`CreateTargetAttack`（5 个参数）、`CreateTornado`（8 个参数）、`CreateWallDistanceDetector`（4 个参数）、`CreateWindAttack`（3 个参数）、`EliminateAlterEgo`（1 个参数）、`EliminateFunnel`（1 个参数）、`EraseHitArea`（1 个参数）、`ExtendCondition`（3 个参数）、`FadeOutBgm`（1 个参数）、`FindMultiballSubjects`（6 个参数）、`HideEffectFromOwner`（1 个参数）、`IfThisCharacterIsSpecificBoss`（4 个参数）、`IfThisCharacterIsSpecificFunnel`（4 个参数）、`MultiballNumberVariable`（6 个参数）、`NotifyPowerflipEnd`（1 个参数）、`RecoveryHitCountCheck`（3 个参数）、`RemoveCollider`（1 个参数）、`RemoveColliderFromOwner`（1 个参数）、`RemoveEventFromOwner`（1 个参数）、`RemoveOneWayWallGimmick`（1 个参数）、`Revive`（2 个参数）、`SetHitAreaSomeHitsWithAnyTargetHandler`（3 个参数）、`SetHitAreaSomeHitsWithSpecificTargetHandler`（4 个参数）、`SetHitAreaTerminateHandler`（2 个参数）、`SetPowerFilpSuppress`（1 个参数）、`SpawnAlterEgo`（4 个参数）、`SpawnFunnel`（4 个参数）、`StartBuffField`（3 个参数）、`StopPiercing`（1 个参数）、`SubtractFeverPoint`（1 个参数）、`SubtractSkillPoint`（2 个参数）、`Trace`（1 个参数）

## 协力球 ID（CreateSummonsMultiball，第 2 项设置）

协力球 ID 是所属角色的 ID 再加一位数字。它们定义在客户端自己的协力球数据表中
（`pinball.master.generated.MultiballTable`：角色、图片、属性、稀有度、种类、动作、自动发动条件……），这是一个内置在
客户端中的数据表，网页控制台不读取它。国服技能召唤的 ID（2026-11-17 扫描）：

| 所属角色（角色 ID） | 协力球 ID |
|---|---|
| 玛丽娜（Marina，111002） | 1110021, 1110022 |
| 菊野（Kikuno，111006） | 1110061 - 1110064 |
| 水善（Suizen，111039） | 1110391 - 1110394 |
| 琉农（Ryunon，111081） | 1110811, 1110812 |
| 黛妲莉亚（Dedalia，111135） | 1111351, 1111352 |
| 丝缇涅尔（Stinelle，111147） | 1111471, 1111472 |
| 珂艾特（Couette，111171） | 1111711, 1111712 |
| 黄金船（Gold Ship，113001） | 1130011 |
| 珂艾特（Couette，161039） | 1610391, 1610392 |
| 蒂妮（Denah，161051） | 1610511, 1610512 |
| 珂艾特（Couette，161087） | 1610871, 1610872 |
| 操里缘子（Yukariko Kuguri，161129） | 1611291, 1611292 |
| 奈芙提姆（Nephtim，161177） | 1611771, 1611772 |
| 玛登（Marden，161189） | 1611891, 1611892 |
| 查特丽娜（Chatrina，161195） | 1611951, 1611952 |
| 莱亚（Lyla，251006） | 2510061 - 2510063 |
| 阿露姆（Arum，261001） | 2610011, 2610012 |
| 影丘龙一（Ryuichi Kageoka，261065） | 2610651, 2610652 |
| 山田多惠（Tae Yamada，263003） | 2630031, 2630032 |
| 梅米（Marnie，311002） | 3110021 - 3110023 |
| 科特（Colt，331010） | 3310101, 3310102 |
| 欧雷欧（Aureo，351004） | 3510041, 3510042 |

炸弹协力球（`CreateBombMultiball`）指定的则是一个精灵图：`character/bomb`（花火 Hanabi）、`character/illusionist_ball`
（伊路米 Illumine）、`character/docking_beast_xm19_multiball`（欧雷欧 Aureo 231007）、`character/ruin_girl_meteor`
（奈芙提姆 Nephtim 151001），再加上炸弹自己的技能脚本。已测试：一个技能召唤了另一个角色的协力球（克菈菈，模拟器，
2026-11-17）。
