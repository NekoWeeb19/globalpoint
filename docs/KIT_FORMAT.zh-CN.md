# 配置包（Kit）文件格式

> 本页是 [KIT_FORMAT.md](KIT_FORMAT.md) 的中文版，由 Claude（AI）翻译。两者内容相同；如有出入，以英文版为准。

**配置包（kit）** 是 GlobalPoint 网页控制台的角色编辑器（Unit editor）在下载已编辑的角色或装备（armament）时生成的文件
（见 [UNIT_EDITOR.md](UNIT_EDITOR.md)）。本页说明这个文件本身的格式，让其他国服（CN）《弹射世界》（World Flipper）服务器
或分支（fork）能够读取它，并把同样的修改放进自己的游戏更新里。修改怎样发送给游戏由各分支自己决定；描述修改所需的
一切都在文件里。

配置包是普通的 JSON（UTF-8）。它只包含在编辑器中修改过的部分，以游戏自己的数据表的行来表示，名称也沿用游戏
自己的命名。它不依赖 GlobalPoint 的数据库、更新版本号、哈希文件名或其他任何文件。

## 整个文件

```json
{
 "_format": "globalpoint-unit-kits",
 "_note": "Unit editor kits (GlobalPoint). ...",
 "111051": {
  "name": "Unit editor: Zeta",
  "rows": {
   "master/skill/action_skill.orderedmap#zeta/1": { "cols": { "0": "新技能名", "1": "第一行\n第二行", "7": "battle/action/skill/action/custom/111051_1_10d24bbbf1" } },
   "master/character/character_status.orderedmap#111051/80": "3000,620",
   "master/ability/ability.orderedmap#1110511": "<整行>",
   "master/ability/ability.orderedmap#1110512": "<整行>"
  },
  "scripts": {
   "battle/action/skill/action/custom/111051_1_10d24bbbf1": "<base64>"
  }
 }
}
```

- **`_format`**：`globalpoint-unit-kits`（角色）或 `globalpoint-armament-kits`（装备）。以 `_` 开头的键不是条目，
  忽略即可。
- **其余每个键**都是一个国服角色 ID 或装备 ID（字符串）。键的顺序无关紧要（JSON 会把像数字的键排在前面）。每个条目包含：
  - **`name`**（可选）：给人看的标签，不是游戏数据。
  - **`rows`**：修改过的行（见下文）。
  - **`scripts`**（仅角色，可选）：这些行所指向的、经过编辑的技能脚本（见下文）。

一个文件可以包含多个条目。这个结构与 GlobalPoint 的“修改文件”（change file）格式相同，所以把配置包直接放进
GlobalPoint 的 `custom_units/changes/` 文件夹也能生效。（在 GlobalPoint 网页控制台导入配置包时，会用配置包的内容替换该角色
之前在编辑器中的修改，而不是合并。）

**编码：** 请将文件保存为**不带字节顺序标记（BOM）**的 UTF-8。一些 Windows 编辑器（记事本的“带有 BOM 的 UTF-8”、
PowerShell 5 的 `Out-File`）会加上 BOM，而严格的 JSON 解析器（例如 Node 的 `JSON.parse`）会拒绝这样的文件。
GlobalPoint 的网页控制台导入时可以接受 BOM 和 UTF-16（读取前会去掉），但直接放进 `custom_units/changes/` 的
带 BOM 的配置包会被报告为损坏的文件并被跳过。其他分支的读取程序为保险起见，可以自行去掉文件开头的 BOM。

## 行

`rows` 的每个键都是 `<数据表>#<行键>`：

- **`<数据表>`** 是游戏中数据表的逻辑名称，例如 `master/ability/ability.orderedmap`。一些较早的 GlobalPoint 修改文件
  使用的是存储名称（`upload/5c/6a4f...`、`production/upload/...`）；读取程序可以按照[文件名](#文件名)一节的规则，
  把逻辑名称换算成存储名称。
- **`<行键>`** 是游戏查找这一行时使用的键。行中还有行的数据表（orderedmap 里套 orderedmap）用 `/` 连接各级键：
  `111051/80` 表示行 `111051` 里的行 `80`。

每个值是以下两种之一：

- **字符串：整行**，替换该行的文本。一行是 CSV 文本，可以有多个子行（用 `\n` 分隔）；能力行中每条能力占一个子行。
  配置包省略了存储的行末尾通常带有的换行符；写回时请保留原行自己末尾的换行符。
- **`{ "cols": { "<列号>": 值 } }`：部分列**，只作用于该行的**第一个子行**，列号从 0 开始。其他列和其他子行保持分支
  原有的内容。值为字符串（较早的文件中可能是数字：按其文本处理）。

CSV 规则（游戏自己的）：字段以 `,` 分隔。包含 `,`、`"`、换行或回车的字段要用 `"` 包起来，字段内的 `"` 写成 `""`。
因此，通过 `cols` 设置的带换行的说明文字，写进行里时会成为一个带引号的字段。

该行必须已经存在于分支的数据表中。配置包只修改已有的行，不会新增行。

### 角色编辑器写入的内容

`<id>` 是角色 ID。`<skill>` 是该角色的技能名：即它在 `master/character/character.orderedmap` 中那一行的第 8 列
（例如 `wind_spgirl`）。

| 数据表 | 行键 | 写入方式 | 内容 |
|---|---|---|---|
| `master/ability/ability.orderedmap` | `<id>1` … `<id>6` | 整行 | 能力 1-6，每条能力一个 CSV 子行（最多 8 行）。 |
| `master/ability/leader_ability.orderedmap` | `<id>` | 整行 | 队长特性，每条一个子行（最多 8 行）。 |
| `master/character/character_status.orderedmap` | `<id>/1`、`<id>/10`、`<id>/80`、`<id>/100` | 整行 | 该等级的 `hp,atk`。 |
| `master/skill/action_skill.orderedmap` | `<skill>/1`（技能）、`<skill>/2`（技能+） | `cols` | 0 名称，1 说明（可以有换行），4 技能等级 1 时的技能槽，5 最高技能等级时的技能槽，7 技能脚本路径。 |
| `master/character/character_text.orderedmap` | `<id>` | `cols` | 0 名称，2 说明，3 称号。 |
| `master/character/character.orderedmap` | `<id>` | `cols` | 6 类型，18 队长特性名，26 职责。 |

类型的值：0 剑士（Swordsman），1 格斗（Fighter），2 射击（Deadeye），3 辅助（Support），4 特殊（Special）（名称取自国服
客户端的界面文字 `type_knight` 等）。职责的值是英文单词，国服自己的数据表也是这样存储的：Attacker、Tank、Healer、
Supporter、Jammer、Balance。能力行和队长特性行按编辑器生成的样子原样
复制，使用客户端自己的列布局（数值与数据表的存储方式相同：百分比之类为 × 100,000）；读取程序不需要理解它们也能应用。触发条件
相关的列见 [research/ability-triggers.md](research/ability-triggers.md)（英文），GlobalPoint 的编辑器从
`assets/unit_editor/ability_codes.json` 读取完整布局。队长特性行就是去掉第 1、2 列的能力行布局。

### 装备编辑器写入的内容

`<id>` 是装备 ID。

| 数据表 | 行键 | 写入方式 | 内容 |
|---|---|---|---|
| `master/item/equipment.orderedmap` | `<id>` | `cols` | 1 名称，7 说明。 |
| `master/item/equipment_status.orderedmap` | `<id>/<等级>` | 整行 | 该装备等级的 `hp,atk`（数据表中列出的那些等级）。 |
| `master/ability/ability_soul.orderedmap` | `<id>` | 整行 | 每个效果版本一个子行：槽位（0-9）、习得等级，之后是角色能力布局从第 5 列（种类）开始的部分。 |

## 技能脚本

当技能页（Skill tab）修改了技能的效果时，该技能在 `action_skill` 中那一行的第 7 列会指向一个新脚本：

```
battle/action/skill/action/custom/<角色 ID>_<技能为 1，技能+ 为 2>_<10 位十六进制>
```

脚本文件放在条目的 `scripts` 中，以该路径为键，内容是**游戏存储的文件原样的 base64**：AMF3 格式的技能程序，
经过 raw deflate 压缩（无 zlib 头），与国服自带的 `*.action.dsl.amf3.deflate` 文件格式相同。

使用时，把解码后的字节作为文件 **`<路径>.action.dsl.amf3.deflate`** 放进游戏更新，存放在 `upload` 文件夹下它的
哈希名称处（见下文）。如果第 7 列指向的脚本没有随更新一起发送，游戏会找不到该文件（会打开资源修复界面），所以两者要么都发，
要么都不发。

脚本路径只属于路径中写明的那个角色。GlobalPoint 的导入程序会拒绝路径中写着其他角色的脚本，并检查游戏能否读取该脚本。

## 文件名

游戏把每个文件存放在其逻辑路径的哈希名称下（国际服和国服规则相同）：

```
production/<文件夹>/<前 2 位十六进制>/<其余 38 位十六进制>
哈希 = SHA1(<逻辑路径> + "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy")
```

数据表和技能脚本使用 `upload` 文件夹。例如 `master/ability/ability.orderedmap` 存放在 `production/upload/` 加上这段
文本的哈希处。GlobalPoint 中这条规则的实现是 `scripts/cdn_hash.cjs`。

## 应用配置包

对每个条目中的每一行：

1. 找到数据表（逻辑名称 → 存储文件），解码，并按行键找到该行（`/` 表示进入下一级）。
2. 整行：替换该行的文本，原来末尾有换行符的保留换行符。
   `cols`：把该行拆成 CSV 子行，把第一个子行拆成字段，设置列出的每一列，按上面的 CSV 规则重新拼接，其他子行保持不变。
3. 把数据表写回，加入游戏更新。同时加入这些行所指向的技能脚本（见上文）。

如果多个配置包修改同一行，请按固定顺序应用：整行以及同一列都以后应用的为准。GlobalPoint 按文件名排序应用修改文件。

GlobalPoint 自己的相关代码：`scripts/custom_units.cjs`（`readUnitChanges`）读取文件，`scripts/gen_cn_event_schedule.cjs`
（`replaceRows` 以及“skill scripts”步骤）把数据表和脚本写进更新。数据表的解码与编码在 `scripts/cdn_rows.cjs`。

## 注意事项

- **仅限国服数据。** ID、数据表和列都来自国服最终版客户端（1.8.1）。所有国服分支都使用这个客户端，所以布局一致。
  国际服的数据表不同，配置包不适用于国际服。
- **仅限国服的角色和装备。** GlobalPoint 的导入程序会拒绝国服数据表中不存在的 ID。对 GlobalPoint 自制角色（用数据
  制作的角色）的修改保存在该角色自己的文件中，不会进入配置包。
- **文字就是输入的内容。** 编辑器的输入框预先填入的是 GlobalPoint 的英文数据表内容，所以大多数配置包带的是英文名称和
  说明，但任何文字都可以。显示效果取决于游戏的字体：国服客户端可以显示中文，日文假名应该也可以；其他文字（韩文、
  表情符号）可能无法显示。
- **整行会替换分支自己的行。** 如果分支自己也改过同一条能力行或队长特性行，配置包中的行会把它替换掉。按列的修改
  只影响那些列。
- **只靠游戏更新就够了**（就 GlobalPoint 所知）：配置包修改的内容，GlobalPoint 的服务器都不另存副本（例如装备的
  属性和能力）。如果某个分支的服务器自己另存了某个值的副本（例如用于计算战力的角色属性），可能需要在那里也应用修改。
