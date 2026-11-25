# 制作自制角色

> 本页是 [MAKING_UNITS.md](../MAKING_UNITS.md) 的中文版，由 Claude（AI）翻译。两者内容相同；如有出入，以英文版为准。

本页说明怎样为国服（CN）客户端制作自制角色、怎样手动修改已有角色，以及服务器和构建程序会怎样处理它们。把做好的
角色放进游戏、发给存档以及移除角色，见 [CUSTOM_UNITS.md](CUSTOM_UNITS.md)。能力、数值、文字和技能用网页控制台的
[角色编辑器（Unit editor）](UNIT_EDITOR.md)修改比手动改文件更方便，它也能编辑自制角色。

**现在需要手动做的部分：** 角色*做什么*（能力、队长特性、属性数值、技能槽、名称和文字、类型和职责，以及技能：游戏中
任何指令、任何角色的特效、任何协力球）都可以在网页控制台中编辑。仍需手动制作的是**美术和声音**：像素精灵图（包括
`skill_ready` 姿势）、立绘和图标、技能特写（cut-in，[png2atf 做法](research/new-units.md#制作战斗技能特写-atf)）、
语音，以及任何全新的特效美术（特效格式已有文档 [../research/skill-effects.md](../research/skill-effects.md)（英文），但还没有
制作它的工具）。美术打包用脚本完成（`build_cn_patch.cjs`，见下文）。

自制角色分为以下几部分：

| 部分 | 位置 | 由谁发送 |
|---|---|---|
| **行**（角色在 19 个游戏数据表中的行）和**服务器数据**（角色条目、能力学习（Mana Board）、扭蛋卡池） | 一个 JSON 文件 `assets/custom_units/<id>.json` | 每次国服日程构建（`scripts/gen_cn_event_schedule.cjs`）都会把这些行加进它发送的数据表；服务器在启动时读取该文件 |
| **文件**（美术、语音、动画、复制出的技能脚本） | 一个美术更新 `1.4.9xx` | `scripts/build_cn_patch.cjs`，只需一次 |
| **编辑过的技能脚本**（角色编辑器的技能页） | `<自制角色文件夹>/skills/` | 每次国服日程构建，和行一样 |

因为日程构建会自己加入这些行，所以每次重建（在网页控制台修改日程、调整时钟、按日期切换配置）都会保留该角色。在此
之前，重建发送的是国服自己的数据表，不含该角色的行，含有该角色的存档会出现 C8601。

## 手动修改已有角色

自制角色文件只用于新角色：使用国服角色 ID 或字符串 ID 的文件会被拒绝。[角色编辑器](UNIT_EDITOR.md)可以修改能力、队长
特性、属性数值、技能槽、名称、称号、说明、类型、职责和技能脚本。其他内容请用下面两种方法之一；两者在每次日程重建后
都会保留。

### 其他行：手写修改文件

编辑器保存的是修改文件（change file），你也可以为它不编辑的行自己写一个（例如
[19 个数据表](research/new-units.md#数据表19-个)中的另一个，比如图片的裁剪行）。把它放进
`assets/custom_units/changes/`（文件名任意，以 `.json` 结尾）：

```json
{ "111069": { "name": "Haruhi: my changes", "rows": {
    "upload/5c/6a4f0e2ceb1dbcf60f9b306b0f7bfd0eca55c9#111069/80": { "cols": { "0": 3000 } },
    "master/ability/ability.orderedmap#1110691": "<the whole row>" } } }
```

- 每一行写作 `<数据表>#<行键>`。数据表可以是逻辑名称，也可以是存储路径（`upload/5c/6a4f…`）；嵌套的键用 `/` 连接
  （属性数值是 `<id>/<等级>`）。值是整行，或者是 `{ "cols": { … } }`，表示该行第一个子行中的部分列。
  [各列附录](research/new-units.md#附录19-个数据表的每一列)列出了每个数据表和每一列。
- 重启服务器即可重建；日志会显示 `Unit changes: N of N row(s) in <table>`（找到的比列出的少，说明某个行名不存在）。
  修改应用在游戏自己的行以及[按日期平衡（Balance by date）](DETAILS.md#按日期的平衡)之上；同一行以文件名排序
  靠后的文件为准。
- 手机通过 **Download from PC**（从电脑下载）获取修改文件，不论勾选了什么。复制会让手机上的修改文件与电脑上的一致，
  所以电脑上删除的文件在手机上也会被删除。
- 属性、稀有度和能力学习的消耗也存在服务器自己的数据中（`assets/character.json`、`assets/mana_node.json`）：
  如果在行中修改了它们，这里也要改成一致。

### 角色的图片、语音和动画：美术更新

更新可以用与游戏自带文件相同的名称携带文件；以最新的副本为准（StarPoint 的翻译更新和美术更新就是这样替换国服文件
的）。做一个文件列表，包含该角色已有文件的名称和你的新文件，然后像构建自制角色的美术更新一样构建它：

```json
[{ "path": "production/medium_upload/ab/cdef…", "from": "D:/my art/square_0.png" }]
```
```bash
node scripts/build_cn_patch.cjs 1.4.950 <newest version> my_art.json
```

- `scripts/research/unit_files.cjs <id>` 按逻辑路径列出该角色的文件。存储名称是 `scripts/cdn_hash.cjs` 中的
  `uploadPath(<逻辑路径>, <文件夹>)`，文件夹（`upload`、`medium_upload` 或 `android_upload`）与游戏原文件所在的相同。
  查找文件夹的方法可以参考 `clone_cn_unit.cjs`。
- 保持格式和尺寸不变（见[文件](research/new-units.md#3-文件76-个大多数玩家从不会看到这些文件夹名)）。动画的精灵图
  （sprite sheet）、`.atlas` 和 `.frame` 文件必须彼此对应；形状不同的图片可能还需要修改它的裁剪行（`trimmed_image`、
  `character_image`），方法是上面的修改文件。
- 手机和获取其他游戏更新一样获取它：**Download from PC**，并勾选 **Game updates**（游戏更新）。

## 添加角色（详细步骤）

1. **制作角色**：一个角色文件（格式见[角色文件](#角色文件)）加上它的文件。这一步之后的步骤都不关心它们是怎样做出来的。
   有两种方法：

   **a. 复制一个已有的国服角色**，用复制脚本给它新的 ID 和字符串 ID。在 `scripts/research/clone_cn_unit.cjs` 开头设置
   `SRC`（要复制的角色：任何国服角色都可以，凉宫春日 111069 只是默认值）和 `NEW`：

   ```bash
   node scripts/research/unit_files.cjs <SRC id> > files.txt
   ```
   ```bash
   node scripts/research/clone_cn_unit.cjs out --files files.txt
   ```

   它会写出 `out/custom_unit.json`（角色文件）、`out/art_files.json`（它的文件，不含数据表）以及这些文件。
   （`out/files.json` 是旧的一次性测试更新，里面带着数据表；要长期保留的角色不要发送它。）
   复制出的角色也是制作新角色的好起点：在[角色编辑器](UNIT_EDITOR.md)中修改它的能力、属性数值和名称（编辑器也能编辑
   自制角色），再替换它的文件。

   **b. 手动制作（或用你自己的工具）。** 你需要：
   - **角色文件**，包含它在 19 个数据表中的行。数据表以及每一列（用客户端自己的字段名）见研究文档的
     [清单](research/new-units.md#清单自制角色需要的一切)和[各列附录](research/new-units.md#附录19-个数据表的每一列)。
     每一行都必须使用新的 ID 和字符串 ID。能力学习的节点 ID 要遵守下面的规则，`manaNodes` 和 `mana_node` 行都要遵守；
     `character` 必须与角色行中的稀有度一致。
   - **文件**，放在 `character/<字符串 ID>/...` 下，名称和格式见研究文档
     （[清单第 3 部分](research/new-units.md#3-文件76-个大多数玩家从不会看到这些文件夹名)：固定尺寸的图片，内部写着
     新文件夹名的 AMF3 `.atlas`/`.frame`/`.timeline`，MP3 语音，技能脚本和预览用的 `.battle` 文件）。每个文件都存放在它的
     哈希名称下（`scripts/cdn_hash.cjs` 的 `uploadPath(<逻辑路径>, <文件夹>)`），文件夹是游戏读取它的那个文件夹
     （`upload`、`medium_upload` 或 `android_upload`；文档中写明了是哪个）。
   - 美术更新用的 **`art_files.json`**：`[{ "path": "production/<文件夹>/ab/cdef…", "from": "<本机上的文件>" }, …]`，
     并把同样的路径写进角色文件的 `art.files`。

   游戏能做的事是固定的：能力、队长特性和技能必须由游戏已有的种类和指令组成（新的数值和组合没问题；新的机制不行）。
   出错时会表现得很明显：构建程序和服务器会指出错误的 ID 或节点 ID；缺少文件时会出现素材恢复画面，路径记录在
   `logs/cn_requests.log` 中；行有问题会出现 C8601（见[故障排除](CUSTOM_UNITS.md#故障排除)）。目前测试过的
   角色：凉宫春日的复制品，以及（研究，2026-11-16，不属于 GlobalPoint）**harpy**，归档文件中的一个未实装角色：它是克菈菈
   （Clara）的复制品，文件换成了 harpy 的美术，精灵图由它的敌人图重建，带有自己的技能脚本和用 png2atf 做的技能特写；
   它在战斗中正常运行。它的语音仍然是克菈菈的。
2. **构建它的美术更新**，版本号要远高于日程构建（StarPoint 的美术更新目前是 1.4.500、600、700 和 800；自制角色使用
   1.4.9xx，手机会自己构建日程版本号）：

   ```bash
   node scripts/build_cn_patch.cjs 1.4.900 <last version in .cdn/cn_patches/patches.json> out/art_files.json
   ```

   把这个版本号写进角色文件的 `art.patch`，这样文件缺失时构建程序能指出是哪个更新。
3. **添加角色文件**：把 `out/custom_unit.json` 复制为 `assets/custom_units/<id>.json`。可以选择在 `banners` 中列出
   扭蛋卡池（见下文）。
4. **重建国服日程**（网页控制台：任意一次日程保存；或者 `npx tsc && node scripts/gen_cn_event_schedule.cjs`）。
   角色文件新增或修改后，服务器启动时也会自动重建（它是日程指纹 `scripts/schedule_fingerprint.cjs` 的一部分）。
   日志会显示 `Custom units: 111907 Haruhi (GP Test) (1 of 1, rows in 19 tables)`。
5. **重启服务器**，让它读取该角色（日志：`[custom units] 111907 Haruhi (GP Test)`）。之后网页控制台的 Give（发放）就能
   使用，能力学习的解锁会被接受，列出的卡池也能抽出它。

### 在手机上（companion 伴侣应用）

自制角色从不放进 APK、数据包或 OBB。先在电脑上添加（上面的步骤），然后在手机上使用 **Download from PC**，并勾选
**Game updates**：

- 角色文件总是会一起复制（不论勾选了什么），放进 `files/data/.cdn/custom_units/`，即手机服务器的 `CUSTOM_UNITS_DIR`。
  这个文件夹在伴侣应用更新和导入存档后都会保留。
- **Game updates** 会带来该角色的美术更新（一个普通的游戏更新）。
- 服务器再次启动时会发现新角色，并用它们重建自己的日程；游戏在下次启动时下载该更新。
- **移除角色**：在电脑上删除它的文件，然后再复制一次：电脑上已没有的角色文件，手机也会删除。（注意下文关于含有该角色
  的存档的警告。）

如果角色文件比美术先到（没有勾选 Game updates），手机的构建会先不加入该角色，等更新列表中出现更新的游戏更新后再自动
重建。

## 角色文件

```jsonc
{
  "id": "111907",                 // 6 位数字，不能是国服 ID；如果要放进卡池，第一位 = 6 − 稀有度（1 = 5★）
  "dev": "gp_test_haruhi",        // 字符串 ID：它所有文件所在的文件夹，国服不使用
  "name": "Haruhi (GP Test)",     // 只用于日志（游戏中的名称在 character_text 行中）
  "character": { "name": "", "rarity": 5, "element": 0, "skill_count": 6, "cn": true },  // = assets/character.json 的条目
  "manaNodes": { "1": { "223814201": { "items": {…}, "manaCost": 0, … } }, "2": {…} },  // = mana_node_cn.json 的能力学习盘
  "banners": ["1613"],            // 可选：卡池中会加入该角色的扭蛋
  "art": { "patch": "1.4.900", "files": ["production/medium_upload/ab/cd…", …] },
  "rows": {
    "upload/2d/5cb9b28d18f984a51b345a4d7aab03d77bddfc": { "111907": "gp_test_haruhi,…" },
    "upload/5c/6a4f0e2ceb1dbcf60f9b306b0f7bfd0eca55c9": { "111907": { "1": "…", "10": "…", "80": "…", "100": "…" } },
    …
  }
}
```

- **数据表**用存储路径（`upload/xx/…`，因为大多数国服数据表没有已知的逻辑名称）或逻辑名称
  （`master/character/character.orderedmap`）表示。行的嵌套方式与数据表相同：字符串是一行，对象是由行组成的映射。
  这些行会加在数据表末尾（游戏按键查找行）；键相同的行会被替换。
- **ID**：游戏从角色行读取稀有度和属性，而不是从 ID 读取（国服自己就有 700000-700019 和 999999）。只有 StarPoint 的
  扭蛋会用第一位数字（★ = 6 − 该数字），所以列在 `banners` 中的角色，ID 必须以对应稀有度的数字开头。第二位数字
  （1 火 … 6 暗）只是惯例。
- **能力学习节点 ID** 必须是 `角色 × 2000 + 盘 × 200 + 序号`（游戏根据节点 ID 找到它的行）。不符合这条规则的文件会被
  拒绝，`manaNodes` 和 `mana_node` 数据表的行都一样。
- **扭蛋卡池**：角色会以该档位的平均权重加入每个列出的卡池中与其稀有度对应的档位，其他角色按比例缩小，使该档位的总和
  不变。卡池的概率画面不会列出它（那是国服的概率数据表）。
- 完整示例（研究用测试角色，未启用）：[../examples/custom_units/111907.json](../examples/custom_units/111907.json)。

## 构建程序的检查

出现以下情况时，日程构建会不加入该角色（并在日志中说明原因）：

- 它的 ID 或字符串 ID 属于国服角色；
- `art.files` 中有文件还不在国服文件或 StarPoint 的更新中（游戏读到它时会停在“数据不足”）。先构建美术更新，再重建；
- 文件本身有问题（JSON 错误、ID 错误、能力学习节点 ID 不符合规则）。

已发送的角色列在 `.database/cn_schedule_built.json`（`customUnits`）中；仍在等待文件的角色在 `customWaitingForFiles`
中，一旦列表中出现更新的游戏更新（例如它的美术更新已构建或已复制进来），服务器会在启动时重建。

需要注意：

- **移除角色**：已有这些行的设备上，数据表会保留它的行，直到之后的更新发送不含它们的数据表。不要移除存档中还持有的
  角色：服务器将不再认识它。
- **在设备上还没有它的行之前，不要 Give 该角色**（美术更新 + 日程重建都已安装）：游戏会出现 C8601，并丢弃该数据表，
  直到下一次更新。
- 翻译更新发送的是不含该角色行的完整数据表，所以翻译更新之后要重建日程（翻译更新的一贯规则）。

## 测试记录（2026-11-03，模拟器，companion 服务器）

研究用测试角色 111907 在已经拥有它的模拟器上改为自制角色文件（存档中为 Lv 100，能力学习 1+2 全部完成）。它的行和
服务器条目已从自带的 `character.json`、`mana_node_cn.json` 和 `gacha.json` 中移除，所以服务器只能从
`assets/custom_units/111907.json` 得知它。
- 服务器记录了 `[custom units] 111907 Haruhi (GP Test)`，并在启动时自动重建了日程（指纹）。
- 手机自己的构建 1.4.955 中 19 个数据表都带有这些行；能力学习 2 的日期被移到 2015 年，因为存档使用了第 2 盘（常规的
  保持开放修正）。
- 游戏接收了 7 MB 的更新。存档加载时没有 C8601。主界面显示了该角色，详情页（Lv 100，上限突破 4）和能力学习 2（已完成）
  也正常。没有崩溃报告。
- 网页控制台 Give（`/api/server/give`）→ 邮件 → 领取：出现了获得角色的画面和它的火属性 EX突破道具。

之后用 companion 0.6.24 测试（同一模拟器，2026-11-03；0.6.24 只是测试版本，其改动随 companion 0.7.0 发布）：
- 先把角色文件移到 `files/data/.cdn/custom_units/`，再覆盖安装 0.6.23：服务器在那里找到了它，并自动重建（1.4.957）。
- 从运行这份代码的电脑服务器 **Download from PC**，什么都不勾选：角色文件、一个修改文件（`changes/`，111907 的 Lv 100
  属性数值）和索引都复制过来了；按 **Start**（启动）后手机重建（1.4.958），游戏中 Lv 100 的 HP/ATK 从 4038/1023 变为
  11799/1239。在电脑上删除修改文件后，下一次复制在手机上也删除了它，重建（1.4.959）发送了游戏自己的行，属性数值回到
  4038/1023。
- 对 111907（所选队伍的队长）使用 **Remove a unit**（移除角色）：第一版清空了队长位置，游戏停在 C2330（“队长不能为
  空”）；已修复（由主角占据该位置），之后存档正常加载，那支队伍的队长变成了阿尔克（Alk）。测试后存档已恢复原样。
- 过程中发现：复制之后，服务器会保持停止状态直到按下 **Start**，尽管复制画面说它会自动启动（不是这次改动造成的）。

未测试：合并后从列出的卡池中抽取、重建后的战斗（行与研究测试相同）、真实手机。

## 代码

- `scripts/custom_units.cjs`：读取并检查角色文件，把行加进数据表，把角色加进扭蛋卡池。
- `scripts/gen_cn_event_schedule.cjs`：发送角色涉及的每个数据表，带上它的行。
- `src/lib/assets.ts`：启动时把角色合并进角色、能力学习和扭蛋数据。
- `scripts/test_custom_units.mjs`（`npm test`）：离线测试。
- `CUSTOM_UNITS_DIR`（相对于仓库文件夹）指向另一个存放角色文件的文件夹，例如用于测试。手机伴侣应用把它设为
  `files/data/.cdn/custom_units`（`companion/server/companion-main.js`）。
- `src/routes/companion.ts` 在每次 Wi-Fi 复制时发送电脑上的角色文件；手机应用（`DataTransfer.java`）总是获取它们，
  并删除电脑上已经没有的文件。
