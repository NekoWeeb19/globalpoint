# GlobalPoint details

Reference material moved out of the [README](../README.md): how units follow the server's date, the
harmless errors in the log, how the game was translated, the server's settings, and pointers for
developers.

- [Balance by date](#balance-by-date)
- [Errors and 404s](#errors-and-404s)
- [Translation](#translation)
- [Settings (.env)](#settings-env)
- [Building it yourself](#building-it-yourself-for-developers)

## Balance by date

The server's date decides how units play, the way they did on that date.

- **Mana Board 2** opens on CN's own waves: 50 waves from 2022-05-26 to 2025-06-19, as CN's official
  posts announced them. Before 2022-05-26 only Star Hopper Alk has it; a few units CN never opened don't get it.
  A unit your save already moved to Mana Board 2 keeps it, whatever the date. The waves are in
  `assets/cn_mb2_waves.json`.
- **Awakening and EX Boost** open on CN's own date for each unit. The CN app does this by itself.
- **Balance patches** (on CN's calendar 2022-04-19, 2023-08-01 and 2024-04-15: CN had the first one six weeks
  before global's 2022-05-31, and the later two keep that lead): before each one, the
  units and armaments it changed use their old leader skills and abilities. That covers 142 units
  and 60 armaments: every one the three patches changed, except Adventurous Pup Lou, whose only
  change was his skill. They come from global's patch notes and, for 2024, global's own game files.
  When the date passes, the game's own kit comes back by itself.
- **What can't go back:** a skill's behavior, and numbers the notes don't give. Where a patch changed
  what a skill does, or only said "reduces skill gauge" or "adjusted skill weight", the unit keeps
  today's skill. So the 2023 reworks (Pecorine, Mormia, Arum and the others) have their old
  abilities and leader skills with today's skill; Deep-Sea Princess Amelia also has her old class and
  stats. Mad Scientist Renoir keeps today's ability 1, since the note's old text is cut off.

The units and their dates are in `assets/kit_dates.json`. To change a unit for good, see
[Changing an existing unit](CUSTOM_UNITS.md#changing-an-existing-unit) (the Unit editor, or [by hand](MAKING_UNITS.md#changing-an-existing-unit-by-hand)).

## Errors and 404s

**In normal play on the CN app, there are no known errors.** The 404s that show up in the server's log
are harmless:

| Request | Why |
|---|---|
| `/openapi/service/v3/promotion/checkUrlPromotion`, `agreement/set` | global app only; nothing uses the answer |
| `/cn/perf` | profiling, only in test builds |
| `gxshield/scan` | global's anti-cheat report, only when it flags automation |
| `/favicon.ico` | browsers asking for a dashboard icon |

The last round of fixes covered Star Silver Astral Gems, the EX Boost uncap rule, CN's EXP curve,
co-op "Back to Room" and connections, and the tutorial skip.

**Slow menus are not a bug.** Some menus pause for a moment. That's the base game's own cost, measured
against unmodified StarPoint. Co-op can run below 1x on slow devices, because the battle simulates your
COM partners' battles too.

## Co-op partners

Your two COM partners in co-op are your own saved parties (any party group), never the party you play with:
0. Parties picked on the dashboard (player page, **Co-op partners**) come first, in the picked order. A picked
   party is skipped when it's the one you play with or has no units.
1. Then parties whose name contains **NPC**. When the stage has a recommended element, NPC parties named
   with that element come before the others: name a party, for example, `Thunder NPC` or `[Water NPC]`. The words
   are Fire, Water, Thunder (or Lightning), Wind, Light and Dark, in any letter case, or 火 水 雷 风/風 光 暗. Then
   come NPC parties with no element in the name, then NPC parties of another element. Stages without a
   recommended element (raids, for example) take NPC parties in party order.
2. If there aren't two NPC parties, your strongest other parties fill in (by their units' total EXP).

The pick is made each time you recruit COM partners, so renaming a party or changing the dashboard picks takes
effect in the next room.

## Translation

The CN app's text was translated into English from scratch where global didn't have it, and taken
from global where it did. The rules:

1. **Global's English comes first.** Where global had the same text (unit, item, quest,
   Flipperpedia), its official English is reused word for word, so the game reads like global.
2. **Names follow global, then official sources, then the meaning.** CN often transliterates names
   differently, and literal readings were wrong several times (拉杰尔特 is **Razelt**, not "Lajalt";
   白/黑 are **Nimbus**/**Claw**). Collab units use their franchise's official English names and terms.
3. **Meaning over literal wording.** CN's text is itself a translation from Japanese, so the Japanese
   data and story context were used where the meaning was unclear. Chinese idioms became natural
   English.
4. **Global's style and each character's voice.** Global's UI terms (Portal, Mana Board, Lodestar
   Beads...) and speech quirks (Mew's "meow", Rustamov's "Couldst thou") are kept.
5. **The original's shape.** Line breaks, symbols (♡, ★, ——) and pacing are kept so text fits its
   boxes.

**Text CN kept in Japanese.** Events CN never ran still had JP's text in CN's files. Each game
update gives those cells English: global's where global had the same row
(`assets/cn_jp_text_fixes.json`, from `scripts/gen_cn_jp_text_fixes.cjs`), and our own where global
never had the event (`assets/cn_jp_translations.json`). That's above all the **Black Clover collab**
(The Unyielding Mages, a JP-only event): its four story chapters, chapter titles, items, missions, profile titles
and unit text, with Black Clover's official names and terms (Asta, Yuno, Noelle Silva, the Clover
Kingdom, the Wizard King, Water Creation Magic: Sea Dragon's Cradle) and WF's own (Palpebra, the
guild, distortion, labyrinth).

English art: the title screen, menu labels, BGM thumbnails, the pause menu, world banners (Worlds
1-11 and EX 1-11) and sprite labels. Old summon banners got their full rerun art. Login
announcements, pop-ups and home-screen banners use global's pictures where global had one
(Razelt's Launch Gala sheet and The Haunt's logo among them). Where no English picture exists
anywhere, the picture is hidden rather than left in Chinese or blank.

**Left as it is:**

| What | Why |
|---|---|
| CN-only art: Growth Fund art, CN raid banners, World 12 / EX 12 banners | no English version exists |
| Chapter 90 labyrinth logo | CN's is Chinese, global's is Japanese: no English source (and CN's chapter list doesn't show it) |
| Chinese drawn into images: tutorial demo captions, the health notice | can't be changed through text |
| A few small labels: 队友的治疗 (co-op room toggle), 等级最大! (result screen), 当前进度 (Quests), 点击 (tap icon) | cosmetic; diminishing returns |
| The publisher's agreement screen on first start | the CN publisher's own screen |

## Settings (.env)

`setup.bat` copies `.env.example` to `.env`. Edit `.env` and restart the server.

| Setting | Default | What it does |
|---|---|---|
| `LISTEN_HOST` | `127.0.0.1` | `0.0.0.0` lets other devices on your network in (needed for setup 2, and to copy to a phone) |
| `LISTEN_PORT` | `8000` | the server's port (the game app expects 8000) |
| `SERVER_START_DATE` | `2021-10-26T02:00:00Z` | the game date a new install starts at |
| `SERVER_TIME_TICKS` | `true` | the server clock runs like a real one |
| `LOGIN_BONUS_PAID_BEADS` | `150` | paid beads with each daily login bonus (0 = off); the dashboard's value replaces it once set |
| `RAID_SOLO_CLEARS_PER_KILL` | `1` | clears of a raid's hardest stage per boss kill |
| `COOP_SUMMON_SECONDS` | `5` | seconds before COM partners join after Recruit |
| `BANNER_ROTATION`, `BANNER_ROTATION_HOURS` | `false`, `24` | rotate summon banners automatically (global app, legacy) |
| `DASHBOARD_BANNER_ROTATION` | `false` | show the dashboard's Banner rotation card even while the rotation is off |
| `CN_ACCOUNT_ID` | empty | play every device on one account (empty = one account per device) |
| `CN_CDN_DIR`, `CN_TRANSLATED_DIR` | `.cdn/cn`, `.cdn/cn_text` | the CN game files and their English tables |
| `CN_SLIM_DIR` | `.cdn/cn_slim` | the small CN data set phones copy for schedule edits (the server builds it at start if missing) |
| `CUSTOM_UNITS_DIR` | `assets/custom_units` | the folder of custom unit files and unit change files ([MAKING_UNITS.md](MAKING_UNITS.md)) |

The quest drop amount, summon rates and the never-ending mails are set on the dashboard, not in `.env`.
`.env.example` also lists a few settings that are only for rebuilding the translation and art
patches (see [docs/contributing.md](contributing.md)); playing never needs them.

## Building it yourself (for developers)

For working on GlobalPoint rather than playing it:

- [docs/contributing.md](contributing.md): how the project is laid out and how to run it.
- [docs/routes.md](routes.md): every route the server answers (generated from the server).
- [docs/CN_CLIENT_SETUP.md](CN_CLIENT_SETUP.md): how the CN app was connected and globalized,
  from nothing.
- [docs/UNIT_EDITOR.md](UNIT_EDITOR.md) and [docs/CUSTOM_UNITS.md](CUSTOM_UNITS.md): changing
  units and adding new ones; [docs/research/](research/new-units.md) has the research behind them.
  [docs/KIT_FORMAT.md](KIT_FORMAT.md) describes a kit file, for using one on another CN fork.
- [docs/global/](global/README.md): the original StarPoint pages for the global app (legacy),
  including captured traffic from the official global servers.
- `scripts/package_release.cjs`: copies a working PC server (code, game files and the game APK) into
  one ready-to-run folder, e.g. to move it to another PC. Not for publishing: the game APK isn't
  ours to host.
- `scripts/build_cn_obb.cjs` (optional): builds the OBB for setup 1 from a server's game files.
  See [docs/CN_CLIENT_SETUP.md](CN_CLIENT_SETUP.md#9-optional-an-obb-for-phones).
- `scripts/gen_cn_slim.cjs`: the small CN data set the companion needs for schedule edits, plus the
  art the Unit editor's skill preview draws (unit sprites, skill effects; ~35 MB). The server runs it by
  itself at start when the CN game files are there and the set is missing or has no art yet.
- `scripts/build_kit_*.cjs`, `scripts/kit_dates.cjs`: build and read `assets/kit_dates.json`, the
  old unit kits for [Balance by date](#balance-by-date).
- `scripts/custom_units.cjs`, `assets/custom_units/`: new units for the CN app from data and files only,
  kept through every schedule rebuild. See [MAKING_UNITS.md](MAKING_UNITS.md), and
  [Getting a custom unit onto your device](CUSTOM_UNITS.md#getting-a-custom-unit-onto-your-device-or-emulator)
  for each setup.
- `scripts/client_mod/README.txt`: the game app patches, in order, and how to build the app.
- `companion/README.md`: the StarPoint Companion app (Node.js on Android), and how to build it.
