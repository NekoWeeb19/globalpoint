# GlobalPoint 细节

> 本页是 [DETAILS.md](DETAILS.md) 的中文版，由 Claude（AI）翻译。两者内容相同；如有出入，以英文版为准。

从 [README](../README.zh-CN.md) 移出来的参考资料：角色怎样跟随服务器日期、日志里无害的错误、游戏是怎样翻译的、服务器的设置，以及给开发者的指引。

- [按日期的平衡](#按日期的平衡)
- [错误和 404](#错误和-404)
- [协力队友](#协力队友)
- [翻译](#翻译)
- [设置（.env）](#设置env)
- [自己构建](#自己构建给开发者)

## 按日期的平衡

服务器的日期决定角色怎么玩：和它们在那个日期时一样。

- **玛纳板 2** 按国服自己的批次开放：从 2022-05-26 到 2025-06-19 共 50 批，与国服官方公告一致。2022-05-26 之前只有阿尔克（Star Hopper）有它；少数国服从未开放的角色没有。
  存档里已经升到玛纳板 2 的角色，不论日期都保留它。批次在 `assets/cn_mb2_waves.json`。
- **觉醒和 EX 突破** 按国服为每个角色开放的日期开放。国服应用会自己处理。
- **平衡调整**（国服日历上的 2022-04-19、2023-08-01 和 2024-04-15：国服的第一次比国际服的 2022-05-31 早六周，之后两次也保持这个领先）：在每次调整之前，
  它改过的角色和装备使用旧的队长特性和能力。这涵盖 142 个角色和 60 件装备：三次调整改过的每一个，除了露（Adventurous Pup），他只改了技能。它们来自国际服的
  更新说明，2024 年的来自国际服自己的游戏文件。日期过了之后，游戏自己的配置会自动回来。
- **无法回到过去的：** 技能的行为，以及说明里没给出的数字。调整改了技能做什么，或只说「降低技能槽」「调整技能权重」的，角色保留现在的技能。所以 2023 年的重做
  （Pecorine、莫弥亚、阿露姆等）有旧的能力和队长特性，但技能是现在的；亚美莉亚（Deep-Sea Princess）还有旧的职业和数值。露娜露（Mad Scientist）保留现在的能力 1，
  因为说明里旧的文本被截断了。

角色和日期在 `assets/kit_dates.json`。要永久修改某个角色，见[修改已有的角色](CUSTOM_UNITS.zh-CN.md#修改已有的角色)（角色编辑器，或[手动](MAKING_UNITS.zh-CN.md#手动修改已有角色)）。

## 错误和 404

**在国服应用的正常游玩中，没有已知的错误。** 服务器日志里出现的 404 是无害的：

| 请求 | 原因 |
|---|---|
| `/openapi/service/v3/promotion/checkUrlPromotion`、`agreement/set` | 只有国际服应用；没有东西用到回应 |
| `/cn/perf` | 性能分析，只在测试版本里 |
| `gxshield/scan` | 国际服的反作弊报告，只在它检测到自动化时 |
| `/favicon.ico` | 浏览器向控制台要图标 |

最近一轮修复涵盖了星银星导石、EX 突破的上限规则、国服的经验曲线、协力的「返回房间」和连接，以及跳过教程。

**菜单慢不是 bug。** 有些菜单会停顿一下。那是原版游戏自己的开销，已与未修改的 StarPoint 对比测量过。协力在慢的设备上可能低于 1 倍速，因为战斗也在模拟 COM 队友的战斗。

## 协力队友

协力中的两个 COM 队友是你自己保存的队伍（任何队伍组），绝不会是你正在用的队伍：
0. 在控制台选的队伍（玩家页面，**协力队友**）最先，按选择的顺序。选的队伍是你正在用的、或没有角色时会被跳过。
1. 然后是名称里含有 **NPC** 的队伍。关卡有推荐属性时，名称带这个属性的 NPC 队伍排在其他之前：例如把队伍命名为 `Thunder NPC` 或 `[Water NPC]`。可用的词是
   Fire、Water、Thunder（或 Lightning）、Wind、Light 和 Dark（不区分大小写），或 火 水 雷 风/風 光 暗。然后是名称里没有属性的 NPC 队伍，然后是其他属性的 NPC 队伍。
   没有推荐属性的关卡（例如战阵）按队伍顺序取 NPC 队伍。
2. 如果 NPC 队伍不到两个，由你其他最强的队伍补上（按队伍角色的总经验）。

每次招募 COM 队友时都会重新选，所以改队伍名或改控制台的选择会在下一个房间生效。

## 翻译

国服应用的文本在国际服没有的地方从头翻译成英文，国际服有的地方直接取用。（游戏也可以用国服自己的中文玩：[CHINESE.md](CHINESE.md)。）规则：

1. **国际服的英文优先。** 国际服有相同文本的地方（角色、道具、关卡、弹射百科），逐字沿用它的官方英文，让游戏读起来像国际服。
2. **名称依次跟随国际服、官方资料，然后是意思。** 国服的音译常常不同，字面读法错过好几次（拉杰尔特是 **Razelt**，不是「Lajalt」；白/黑 是 **Nimbus**/**Claw**）。
   联动角色使用原作官方的英文名称和术语。
3. **意思重于字面。** 国服的文本本身就是从日文翻译的，所以意思不清楚时参考了日文数据和剧情上下文。中文成语改成了自然的英文。
4. **国际服的风格和每个角色的语气。** 保留国际服的界面术语（Portal、Mana Board、Lodestar Beads……）和说话习惯（缪的「meow」、拉夫马诺的「Couldst thou」）。
5. **原文的形式。** 保留换行、符号（♡、★、——）和节奏，让文字放得进文本框。

**国服留着日文的文本。** 国服从未举办的活动，在国服的文件里仍是日服的文本。每次游戏更新都会给这些单元格英文：国际服有同一行的用国际服的
（`assets/cn_jp_text_fixes.json`，来自 `scripts/gen_cn_jp_text_fixes.cjs`），国际服从未有过这个活动的用我们自己的（`assets/cn_jp_translations.json`）。主要是
**黑色五叶草联动**（The Unyielding Mages，日服独有的活动）：它的四章剧情、章节标题、道具、任务、个人称号和角色文本，使用黑色五叶草的官方名称和术语（Asta、Yuno、
Noelle Silva、Clover Kingdom、Wizard King、Water Creation Magic: Sea Dragon's Cradle）以及弹射世界自己的（Palpebra、公会、扭曲、迷宫）。

英文图片：标题画面、菜单标签、BGM 缩略图、暂停菜单、世界横幅（世界 1-11 和 EX 1-11）以及精灵标签。旧的扭蛋横幅换上了完整的复刻图。登录公告、弹窗和主界面横幅在国际服
有对应图片的地方使用国际服的图片（包括拉杰尔特的开服庆典图集和 The Haunt 的标志）。任何地方都没有英文图片的，图片会被隐藏，而不是留着中文或空白。

**保持原样的：**

| 内容 | 原因 |
|---|---|
| 国服独有的图片：成长基金图、国服战阵横幅、世界 12 / EX 12 横幅 | 没有英文版本 |
| 第 90 章迷宫标志 | 国服的是中文，国际服的是日文：没有英文来源（而且国服的章节列表不显示它） |
| 画进图片的中文：教程演示的字幕、健康游戏忠告 | 无法通过文本修改 |
| 几个小标签：队友的治疗（协力房间开关）、等级最大！（结算画面）、当前进度（关卡）、点击（点按图标） | 只影响外观；收益递减 |
| 第一次启动时的发行商协议画面 | 国服发行商自己的画面 |

## 设置（.env）

`setup.bat` 把 `.env.example` 复制为 `.env`。编辑 `.env` 后重启服务器。

| 设置 | 默认值 | 作用 |
|---|---|---|
| `LISTEN_HOST` | `127.0.0.1` | `0.0.0.0` 让网络里的其他设备连进来（方式 2 和复制到手机需要） |
| `LISTEN_PORT` | `8000` | 服务器的端口（游戏应用要求 8000） |
| `SERVER_START_DATE` | `2021-10-26T02:00:00Z` | 新安装开始时的游戏日期 |
| `SERVER_TIME_TICKS` | `true` | 服务器时钟像真实时钟一样走 |
| `LOGIN_BONUS_PAID_BEADS` | `150` | 每日登录奖励附带的付费星导石（0 = 关闭）；在控制台设置过之后以控制台的值为准 |
| `RAID_SOLO_CLEARS_PER_KILL` | `1` | 战阵最难关卡通关几次算击败一次领主 |
| `COOP_SUMMON_SECONDS` | `5` | 按招募后 COM 队友加入前的秒数 |
| `BANNER_ROTATION`、`BANNER_ROTATION_HOURS` | `false`、`24` | 自动轮换扭蛋（国际服应用，旧功能） |
| `DASHBOARD_BANNER_ROTATION` | `false` | 即使轮换关闭也显示控制台的扭蛋轮换卡片 |
| `CN_ACCOUNT_ID` | 空 | 所有设备用同一个账号（空 = 每台设备一个账号） |
| `CN_CDN_DIR`、`CN_TRANSLATED_DIR` | `.cdn/cn`、`.cdn/cn_text` | 国服游戏文件和它们的英文数据表 |
| `CN_SLIM_DIR` | `.cdn/cn_slim` | 手机为编辑日程复制的小型国服数据集（缺少时服务器启动时会生成） |
| `CUSTOM_UNITS_DIR` | `assets/custom_units` | 自制角色文件和角色修改文件的文件夹（[MAKING_UNITS.zh-CN.md](MAKING_UNITS.zh-CN.md)） |

关卡掉落倍率、扭蛋概率、用不完的邮件和游戏语言在控制台设置，不在 `.env` 里。`.env.example` 还列出几项只用于重建翻译和图片补丁的设置
（见 [docs/contributing.md](contributing.md)（英文））；玩游戏从不需要它们。

## 自己构建（给开发者）

用于开发 GlobalPoint 而不是玩它（以下页面除注明外都是英文）：

- [docs/contributing.md](contributing.md)：项目的结构和运行方法。
- [docs/routes.md](routes.md)：服务器响应的每个路由（由服务器生成）。
- [docs/CN_CLIENT_SETUP.md](CN_CLIENT_SETUP.md)：国服应用是怎样从零开始连接并国际化的。
- [docs/UNIT_EDITOR.zh-CN.md](UNIT_EDITOR.zh-CN.md) 和 [docs/CUSTOM_UNITS.zh-CN.md](CUSTOM_UNITS.zh-CN.md)（中文）：修改角色和加入新角色；
  [docs/research/](research/new-units.zh-CN.md) 有背后的研究。[docs/KIT_FORMAT.zh-CN.md](KIT_FORMAT.zh-CN.md)（中文）说明配置文件，供在其他国服分支上使用。
- [docs/global/](global/README.md)：国际服应用的原版 StarPoint 页面（旧版），包括从国际服官方服务器抓取的通信。
- `scripts/package_release.cjs`：把一个可用的电脑服务器（代码、游戏文件和游戏 APK）复制到一个可以直接运行的文件夹，例如搬到另一台电脑。不用于发布：游戏 APK 不是我们可以托管的。
- `scripts/build_cn_obb.cjs`（可选）：从服务器的游戏文件生成方式 1 用的 OBB。见 [docs/CN_CLIENT_SETUP.md](CN_CLIENT_SETUP.md#9-optional-an-obb-for-phones)。
- `scripts/gen_cn_slim.cjs`：StarPoint Companion 编辑日程需要的小型国服数据集，加上角色编辑器技能预览用的图片（角色精灵、技能特效；约 35 MB）。CN 游戏文件在、
  而数据集缺少或还没有图片时，服务器启动时会自动运行它。
- `scripts/build_kit_*.cjs`、`scripts/kit_dates.cjs`：生成和读取 `assets/kit_dates.json`，即[按日期的平衡](#按日期的平衡)用的旧角色配置。
- `scripts/custom_units.cjs`、`assets/custom_units/`：只用数据和文件为国服应用加入的新角色，每次重建日程都会保留。见 [MAKING_UNITS.zh-CN.md](MAKING_UNITS.zh-CN.md)，以及
  各种方式的[把自制角色放到你的设备上](CUSTOM_UNITS.zh-CN.md#把自制角色放到你的设备或模拟器上)。
- `scripts/client_mod/README.txt`：游戏应用的补丁，按顺序，以及怎样构建应用。
- `companion/README.md`：StarPoint Companion 应用（Android 上的 Node.js）以及怎样构建它（使用说明部分有[中文版](../companion/README.zh-CN.md)）。
