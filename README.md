# GlobalPoint

**World Flipper, in English, fully offline.** GlobalPoint runs the Chinese (CN) version of World Flipper
(app 1.8.1) on [StarPoint](https://github.com/duosii/starpoint), a private server, with global's English
text and art put into the game. Everything CN had, including the units, events and summons global never
got, plays on your own PC or phone.

> [!IMPORTANT]
> ## 🤖 This project was vibecoded
> Most of GlobalPoint's code, translations and fixes were written by **Claude** (Anthropic's AI).
> The repository owner tested every change by hand in the game and reviewed the results. Claude also
> checked its own work in the game through direct control of an Android emulator: screenshots,
> logs and play sessions.
> Expect the code to read like it was written quickly by a machine, because it was. Bug reports are
> welcome.

---

## Contents

- [Status](#status)
- [Ways to play](#ways-to-play)
- [Installation](#installation)
  - [A. On a PC (emulator)](#a-on-a-pc-emulator)
  - [B. On a phone, copying from your PC over Wi-Fi](#b-on-a-phone-copying-from-your-pc-over-wi-fi)
  - [C. On a phone, with the OBB file](#c-on-a-phone-with-the-obb-file)
  - [D. On a phone, with the server on your PC](#d-on-a-phone-with-the-server-on-your-pc)
- [The dashboard](#the-dashboard)
- [Balance by date](#balance-by-date)
- [What works](#what-works)
- [Errors and 404s](#errors-and-404s)
- [Translation](#translation)
- [What doesn't work](#what-doesnt-work)
- [FAQ](#faq)
- [Settings (.env)](#settings-env)
- [Building it yourself](#building-it-yourself)
- [Special thanks](#special-thanks)
- [License](#license)

---

## Status

**The CN app is functionally complete.** Almost everything has been confirmed working in the game.
Fringe bugs, text problems and co-op issues have been fixed, and stray untranslated text was swapped
for global's. Comics, the dashboard and the rest work.

If something that hasn't been checked turns out broken, it gets fixed. Hard multi is the one known
exception (see [What doesn't work](#what-doesnt-work)).

The phone setups (B and C below) are new. They pass on an Android 9 emulator and on a real Android
16 phone (Samsung), battles and co-op included. On an Android 16 tablet, the game and the
companion's server ran for over 3 hours straight without the server stopping, and the full ~10 GB
Wi-Fi copy finished. Android 12 testing is under way.

Units also follow **global's balance history**: set the server's date before one of global's balance
patches and those units play with their kit from before it (see [Balance by date](#balance-by-date)).

## Ways to play

| | Where the server runs | Where the game runs | Needs |
|---|---|---|---|
| **A. PC** | your PC | an Android emulator on the same PC (e.g. LDPlayer) | Windows, Node.js 20+, ~16 GB free; the CN game files and `starpoint-data.zip` |
| **B. Phone, Wi-Fi** | on the phone (StarPoint Companion app) | the same phone | a PC running setup A on the same Wi-Fi, once; ~25 GB free on the phone |
| **C. Phone, OBB** | on the phone (StarPoint Companion app) | the same phone | the OBB file (from the Drive, or built on a PC with setup A) and `starpoint-data.zip`; ~15 GB free |
| **D. Phone + PC server** | your PC | a phone | setup A on the PC; the phone on the same Wi-Fi (or a USB cable with USB debugging) |

Setups A and D keep the server on your PC. Use them if you'd rather not keep everything on your
phone or don't want the companion app.

The game app is **build 25** of the patched CN app. By default it talks to `127.0.0.1:8000`: your
PC's server through the emulator in setup A, or the companion app on the phone itself in setups B
and C. A small `server.txt` file on the phone points it at your PC instead (setup D). That takes
the place of original StarPoint's mitmproxy route, which only worked for the global app.

## Installation

Downloads:

| File | What it is | Where | Size |
|---|---|---|---|
| **World Flipper (game) APK** | the patched game app (build 25; installs over builds 23 and 24), for every setup | [Google Drive](https://drive.google.com/drive/folders/1EdY0GajMm-v6c219s02ZnuEz0u_0XdOO) | 139 MB |
| **StarPoint Companion APK** | the server-on-your-phone app (0.6.22), for setups B and C | [Google Drive](https://drive.google.com/drive/folders/1EdY0GajMm-v6c219s02ZnuEz0u_0XdOO) | 76 MB |
| **OBB in 3 parts** (`main.1008001.com.leiting.wf.part1of3.obb`, `part2of3`, `part3of3`) | every game file (game files 1.4.800, up to date), for setup C; download all three | [Google Drive](https://drive.google.com/drive/folders/1EdY0GajMm-v6c219s02ZnuEz0u_0XdOO) | 3.6 GB each |
| **OBB** (`main.1008001.com.leiting.wf.obb`), the alternative | the same as one 10 GB file (game files 1.4.203: older, the game updates after unpacking), for phones and file apps that handle one big file | [Google Drive](https://drive.google.com/drive/folders/1EdY0GajMm-v6c219s02ZnuEz0u_0XdOO) | 10.3 GB |
| **`starpoint-data.zip`** | GlobalPoint's English tables, game updates (art and text patches), schedule files, dashboard pictures and news. Setup A unzips it into the server folder; setup C imports it into the companion | [Google Drive](https://drive.google.com/drive/folders/1EdY0GajMm-v6c219s02ZnuEz0u_0XdOO) | 2.25 GB |
| **Comics zip** (optional) | the in-game comics, used the same way as `starpoint-data.zip` | [Google Drive](https://drive.google.com/drive/folders/1EdY0GajMm-v6c219s02ZnuEz0u_0XdOO) | 1.4 GB |
| **CN game files** (CN CDN 1.4.54) | the official CN game's files, for setup A: six parts `cn-cdn.tar.part.00` to `05`, plus `SHA256SUMS.txt` | [dennis96292/.cdn, release cdn-1.4.54](https://github.com/dennis96292/.cdn/releases/tag/cdn-1.4.54) | ~10.1 GB |
| **GlobalPoint** (this repository) | the server, the dashboard and the scripts | `git clone`, or **Code > Download ZIP** on GitHub | small |

Setup C can also build its own OBB on a PC from setup A's files.

SHA-256 of the OBB parts, to check a download (`certutil -hashfile <file> SHA256` on Windows,
`sha256sum <file>` elsewhere):

```
a57b1629b3564aa600cfaa9b1bbc88794a36eb1214b58f58238986dc0f0aebb7  main.1008001.com.leiting.wf.part1of3.obb
343438b6ee2debb1843609acbf386b2cf977d23a6ea018485e22e6d48a5fc453  main.1008001.com.leiting.wf.part2of3.obb
b3676a2042c945b26b7c0bfa1bd1127cb15e07984d7b2b47971c8b0d4aa9e412  main.1008001.com.leiting.wf.part3of3.obb
```

### A. On a PC (emulator)

1. Install [Node.js](https://nodejs.org) 20 or newer, and an Android emulator (tested: LDPlayer 9).
2. **Get GlobalPoint:** `git clone https://github.com/NekoWeeb19/globalpoint.git`, or download the
   repository's ZIP and unpack it. Put it on a drive with at least 16 GB free. The steps below call
   this folder `<folder>`.
3. **Get the CN game files.** Download the six `cn-cdn.tar.part.*` files and `SHA256SUMS.txt` from
   the [CN CDN 1.4.54 release](https://github.com/dennis96292/.cdn/releases/tag/cdn-1.4.54).
   - **Check them** (optional, recommended): in Command Prompt, run
     `certutil -hashfile cn-cdn.tar.part.00 SHA256` for each part and compare with `SHA256SUMS.txt`.
     With Git Bash, Linux or macOS: `sha256sum -c SHA256SUMS.txt`.
   - **Unpack them into `<folder>\.cdn`** (make the `.cdn` folder first if it isn't there). Windows
     10 and newer have `tar` built in. In Command Prompt (not PowerShell), in the download folder:
     ```bat
     copy /b cn-cdn.tar.part.00 + cn-cdn.tar.part.01 + cn-cdn.tar.part.02 + cn-cdn.tar.part.03 + cn-cdn.tar.part.04 + cn-cdn.tar.part.05 cn-cdn.tar
     ```
     ```bat
     tar -xf cn-cdn.tar -C <folder>\.cdn
     ```
     Joining the parts into one `cn-cdn.tar` needs about 10 GB more space for a while; delete
     `cn-cdn.tar` and the parts afterwards. With Git Bash, Linux or macOS you can skip the join:
     `cat cn-cdn.tar.part.* | tar -x -C <folder>/.cdn`.
   - You get `<folder>\.cdn\cn\...` (the `archive-*` folders and `entities`), which is where the
     server looks by default. No settings to change.
4. **Unzip `starpoint-data.zip` into `<folder>`** itself, so its `.cdn` and `.database` folders land
   on top of the ones already there. Do the same with the comics zip if you want comics.
5. **Put the game APK in `<folder>\apk\`** (make the `apk` folder), or install it on the emulator
   yourself.
6. Run **`setup.bat`**. It installs the server's packages (needs internet once), builds the server,
   makes your `.env` from `.env.example`, and checks the game files and updates; if something is
   missing it stops and says what. If it finds `adb`, it offers to install the APK from the `apk`
   folder on your emulator. Then it starts the server.
7. Open the game.
   - The first screen is the CN publisher's agreement, in Chinese. The **right** button (同意) agrees
     and continues; the left one (拒绝) closes the game.
   - The first start downloads ~12 GB of game files from your own server (about 6 minutes on an
     emulator). That only happens once.

After that, run **`start-cn.bat`** and open the game. Close the server window to stop it.

The short version of these steps is in `HOW-TO-PLAY.txt`. Linux and macOS have `setup.sh` and
`start-cn.sh`, which are untested.

### B. On a phone, copying from your PC over Wi-Fi

You need setup A running on a PC on the same Wi-Fi, and ~25 GB free on the phone.

1. On the PC, set `LISTEN_HOST="0.0.0.0"` in `.env` so the phone can reach the server, and start it.
   If Windows asks about the firewall, allow it on **Private networks**.
2. Find the PC's address: the dashboard's **Play on a phone over Wi-Fi** shows it, or run `ipconfig`
   and use the **IPv4 Address** line (it starts with `192.168.` or `10.`).
3. Install both APKs on the phone: the **game** and **StarPoint Companion**. If Android blocks it,
   tap **Settings** and turn on **Allow from this source**. **Don't open the game yet.**
4. Open **StarPoint Companion**, tap **Game data**, and type your PC's address with the port, e.g.
   `192.168.1.20:8000` (use your own; that one is only an example).
5. Tick **Full game files**, **My save** (to bring your PC account), **Game updates**, **Event
   schedule editing** and **Dashboard pictures**. Comics are optional.
6. Tap **Download from PC**. When asked, turn on **All files access** for the companion and press
   back. The copy starts by itself and takes a while (~12 GB).
7. On the same screen, tap the button that opens **World Flipper's "All files access"** page and turn
   it on. The game never asks for it itself.
8. On the companion's main screen, check that it says **Server: running**, then tap **Let the server
   run in the background**. Allow notifications if asked.
9. Open the game. The first start moves the game files into place (a few minutes), then you're in,
   with no download.

If the phone says **"failed to connect"**, the address is wrong or the PC's firewall is blocking
Node.js (allow it on Private networks in Windows Security > Firewall > Allow an app). A phone that
already has the game (from the OBB) only needs the boxes other than **Full game files**.

From then on your save lives on the phone. Use **Export save** / **Import save** in the companion to
move it.

### C. On a phone, with the OBB file

The OBB is every game file, ~10.3 GB. The [Google Drive folder](https://drive.google.com/drive/folders/1EdY0GajMm-v6c219s02ZnuEz0u_0XdOO) has it in **3 parts**
(~3.6 GB each, easier to download and copy) and as one file. You can also build it on a PC that has
setup A. After that the phone plays on its own.

1. **Get the OBB**: download the three `part1of3` / `part2of3` / `part3of3` files (or the single
   `.obb`), on the phone or on a PC to copy over USB. Or build it on the PC, in `<folder>`:
   ```bash
   node scripts/build_cn_obb.cjs <output folder> --parts 3
   ```
   That needs ~10.3 GB free. Leave out `--parts 3` for one file.
2. Install the **game** APK (build 25; the parts need it) on the phone. **Don't open it yet.**
3. **Make the folder.** At the top of internal storage, create a folder named exactly
   **`starpoint_game`**: `Internal storage/starpoint_game/`. (`Internal storage/StarPoint/game/`
   works the same way, if you already have it.)
4. **Put the OBB in `starpoint_game/`**: all three parts together in that one folder, directly
   (not in a subfolder). Copy them from the PC over USB or, if they're already on the phone,
   **Move** them there with the file app (Move, not Copy: a copy needs twice the space, ~20 GB).
   Don't let anything compress or zip them: the game can't read a zipped OBB.
5. **Let the game read it (required).** Android Settings > Apps > World Flipper:
   - turn on **All files access**;
   - under **Permissions**, allow the storage permissions. On Android 13 and newer they're listed as
     **Music and audio** and **Photos and videos**: allow both. On older Android it's **Storage**.

   The game never asks for these itself, and without them it can't see the OBB.
6. Install **StarPoint Companion** and give it its data: copy **`starpoint-data.zip`** to the phone
   (e.g. into Downloads), then in the companion tap **Game data** > **Import pack...** and pick it.
   Import the comics zip the same way if you want comics. (With setup A running on the same Wi-Fi,
   **Download from PC** without **Full game files** does the same.)
7. Start the companion's server as in step 8 of setup B.
8. Open the game (if it was already open, close it fully first). It shows "Unpacking game files",
   unpacks the OBB by itself and deletes it when done. With the 3 parts it checks first that all
   three are there and complete, then unpacks from the last part back, deleting each part as it
   empties.

The phone only needs a little free space beyond the OBB itself: the game shrinks the OBB as it
unpacks. If it's interrupted, it carries on where it stopped next time.

- **A part missing or cut short:** the game says so, e.g. "Game files part 2 of 3 is missing" or
  "...is incomplete: x of y GB", and unpacks nothing. Copy the missing part next to the others
  (or download it again) and reopen the game.
- **The single-file OBB on the Drive is older** (game files 1.4.203). After it unpacks, the game
  downloads the rest from the companion once (~2 GB, from the phone itself, so it's quick). The 3
  parts and an OBB you build yourself are already up to date.
- **The file names don't matter**, as long as they end in `.obb` and sit directly in the folder.
  One renamed to `.obb.zip` doesn't work.
- **`Android/obb/com.leiting.wf/` also works on some phones,** with no permissions needed (they
  don't apply there either way). What matters is which app wrote the file: some phones' file apps
  (Samsung's My Files, for one) leave it unreadable to the game. `starpoint_game` with the
  permissions above is the reliable route.
- **With a PC and adb**, `Android/obb` always works. If the folder doesn't exist yet:
  ```bash
  adb shell mkdir -p /sdcard/Android/obb/com.leiting.wf
  ```
  ```bash
  adb shell chmod 777 /sdcard/Android/obb/com.leiting.wf
  ```
  ```bash
  adb push main.1008001.com.leiting.wf.obb /sdcard/Android/obb/com.leiting.wf/
  ```
  (For the 3 parts, push each one the same way.)
  adb can't fix a folder a file app already made: rename or delete that folder first.
- **GrapheneOS:** give World Flipper **All files access**, not Storage Scopes. Scopes only shows an
  app the files it made plus ones you pick, and the game also has to shrink and delete the OBB.
- **If the game asks to download ~10 GB**, or the title screen shows **ResVer null**, instead of
  "Unpacking game files", it can't see the OBB. Tap Cancel. If you used `Android/obb`, move the OBB
  to `starpoint_game/`. Check that it's directly in that folder and that World Flipper has **All
  files access** and the storage permissions (step 5). Close the game fully and reopen it. Nothing
  is lost.

### D. On a phone, with the server on your PC

The phone plays against your PC's StarPoint, so your save stays on the PC and the PC must be on
while you play. The game needs its files first: on a fresh install it downloads ~12 GB from your
PC, or use an OBB as in setup C, steps 1-5.

**Over Wi-Fi (game build 23 or newer):**
1. On the PC, set `LISTEN_HOST="0.0.0.0"` in `.env` and start the server. Allow it if Windows asks
   about the firewall.
2. Open the dashboard on the PC (**http://127.0.0.1:8000**). Under **Play on a phone over Wi-Fi**,
   pick the PC's address (the one starting with 192.168 or 10) and tap **Download phone connection
   file**. You get `server.txt`.
3. Put `server.txt` on the phone in `Internal storage/Android/obb/com.leiting.wf/` (make the
   folder if needed). You can send it to yourself, or download the file straight on the phone by
   opening the dashboard there at `http://<PC address>:8000`.

   Whether the game can read a file there depends on the app that wrote it, as with the OBB in
   setup C. If the title screen doesn't show "Server: ...", that's the likely cause: put
   `server.txt` in `Internal storage/StarPoint/` instead and give World Flipper the permissions
   from setup C, step 5, or push it with adb (`adb push server.txt
   /sdcard/Android/obb/com.leiting.wf/`, after the folder steps in setup C). The game doesn't read
   `server.txt` from `starpoint_game`.
4. Install the game and open it. The title screen shows **"Server: 192.168.x.y:8000"**. If it says
   "server.txt not understood", the file's address line is wrong.

`server.txt` is just one line, the PC's address and port, e.g. `192.168.1.20:8000`, so you can
also write it by hand. Lines starting with `#` are ignored. The game reads it each time it starts.
Delete it to go back to the phone's own server (the companion). If your router gives the PC a new
address, download the file again.

**Over USB (any game build):** turn on **USB debugging** in the phone's Developer options, connect
it to the PC, and run `start-cn.bat`. It forwards the phone's `127.0.0.1:8000` to the PC with
`adb reverse`. Android 11+ can do the same without a cable through **Wireless debugging**. The link
drops whenever adb loses the phone; run `start-cn.bat` again to restore it.

## The dashboard

With the server running, open **http://127.0.0.1:8000** in a browser, or tap **Dashboard** in the
companion app. It follows your device's light or dark mode. In the companion, Back closes the
dashboard and returns to the app.

Step-by-step jobs (moving an event, repeating a campaign, giving items, moving a save...) and the
gotchas are in the [dashboard guide](docs/DASHBOARD.md).

- **Dashboard (first tab)**
  - **Server time:** Visit past and future content. New installs start on 2019-12-01, just before
    the CN game's first regular banners and events. Changing it also changes which units have Mana Board 2,
    awakening and EX Boost, and which kit they use (see [Balance by date](#balance-by-date)); the
    game gets a small update the next time it reaches the title screen.
  - **Quest drop amount:** multiplies quest drops (items, materials, mana, EXP) and event drops, from
    1x up to 100x. The default, 1x, is the base game's own amounts.
    Original StarPoint always gave 10x; set 10 to match it, or go higher for less grind.
  - **Play on a phone over Wi-Fi:** downloads the `server.txt` connection file for setup D (shown
    when the server listens on the network).
  - **Daily paid beads and free mails:** the paid beads added to each daily login bonus (150 by
    default, 0 turns it off), and the three never-ending mails (Bread, Mana and EXP x1500) that can
    be claimed again and again. Turn any of them off to remove it.
  - **Summon rates:** the 5★ and 4★ chance per pull for standard, featured and armament portals
    (base game: 7.5% / 25% standard, 5% / 25% the others).
  - **Banner rotation** (off by default).
- **Events, Summons and Campaigns** list everything by start date, with the CN game's own dates.
- **Events:** every event, CN-only ones included. Move any of them to any date. Each change builds a
  small game update that the game downloads the next time it reaches the title screen.
- **Summons:** schedule summon banners, with their banner art.
- **Campaigns:** yearly login bonuses, free pulls and stamina/reward campaigns.
- **News:** posts shown on the game's in-game News board.
- **Players:** accounts, saves (download and upload) and gifts.

## Balance by Date

The server's date decides how units play, the way they did on that date.

- **Mana Board 2** follows JP's six early waves, since CN copied JP's order. Each of the 214 units
  JP listed opens on its JP wave or its CN date, whichever comes first. The first wave is
  2020-09-10, when Ether (the board 2 material from the Challenge Single Battles) can first be
  had, then one wave a month. Other units open on CN's own date. A unit your save already moved to
  Mana Board 2 keeps it, whatever the date. The waves are in `assets/mb2_jp_waves.json`.
- **Awakening and EX Boost** open on CN's own date for each unit. The CN app does this by itself.
- **Global's balance patches** (live 2022-05-31, 2023-09-12 and 2024-05-27): before each one, the
  units and armaments it changed use their old numbers. That covers 98 units and 49 armaments,
  taken from global's patch notes and, for 2024, global's own game files. When the date passes, the
  game's own kit comes back by itself.
- **What can't go back:** a skill's behavior. Where a patch changed what a skill does (not just its
  numbers), the unit keeps today's skill. The 2023-09-12 reworks (Amelia, Pecorine, Mormia and
  others) are mostly left as they are for that reason; Deep-Sea Princess Amelia is the exception,
  with her old abilities, leader skill, class and stats but today's skill.

The units and their dates are in `assets/kit_dates.json`. To change a unit for good, see
[Changing an existing unit](docs/CUSTOM_UNITS.md#changing-an-existing-unit).

## What works

Confirmed in the game on the CN app:

- Story and quests (main, event, character, EX)
- Events and event shops
- Summons: tickets, free pulls, banner art, exchanges
- Missions, including the Content Guide and awakening missions
- The pass, the growth fund and login bonuses
- Purge, raids, carnival, Time Attack, score attack
- Co-op with COM partners: continuous runs, x2/x3 speed
- EX Boost, armaments, mana boards, uncaps
- Comics, by release date
- The dashboard: events, summons, campaigns, news, players, server clock and drop amount
- Balance by date: old kits before global's balance patches, Mana Board 2 / awakening by date
- Treasure Hunt drops, with CN's own events, items and dates
- Special Exchange and Start Dash Exchange: paid-bead selector tickets traded for a unit or an
  armament (a Start Dash purchase also gives the bundle's wildcard 10-pull ticket)
- The English text and art

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

## What doesn't work

- **Playing with other people.** GlobalPoint is offline only. Co-op is with COM partners.
- **Hard multi.** It's built, but it has never been testable.
- **Buying beads with real money** (the in-game top-up shop). There's no store behind it. Paid beads
  come from the daily login bonus instead (set on the dashboard's first tab).
- **The global app** is legacy. It still connects, but it isn't maintained: its Units screen gives
  error C8601 on this server, and a reinstall's tutorial skip gets stuck. Use the CN app.

- **Skills changed by a balance patch** keep today's behavior on older dates (see
  [Balance by date](#balance-by-date)).

**Not yet confirmed on real phones:** setup B on Android 12, the companion staying up in the
background with the screen off, and phones with 16 KB memory pages (three of the game's built-in
protection libraries are built for 4 KB pages). Setup C with `StarPoint/game` works on an Android
16 tablet (Samsung); `starpoint_game` (build 24+) and the 3-part OBB (build 25) work on the
emulator. `Android/obb`
works on some devices; whether the game can read it depends on the app that wrote the file (see
setup C).

## FAQ

- **Is this the official game?**
  No. World Flipper's servers are shut down. This is a private server for playing it offline.
- **Do I need an account or internet?**
  No account. Setup A needs internet once, to download the files and install the server's
  packages. After that everything is offline.
- **Can I keep my old save?**
  StarPoint saves live on the server. On the dashboard's **Players** page you can upload and download
  a save. A phone in setup B can bring your PC save over with **My save**.
- **Where is my save on the phone?**
  Inside the companion app. Use **Export save** to keep a copy (in Downloads or a cloud drive).
- **I changed an event's date. Why don't I see it?**
  Close the game fully and open it again. It downloads a small update at the title screen.
- **I changed something on the dashboard, opened the game right away, and got an error (like
  C8601) or a frozen screen.**
  After you save a change to events, summons or campaigns, or move the server's date, the server
  rebuilds the game's data in the background. That takes a minute or two on a PC, and several minutes
  on a phone. If the game reaches the title screen before the rebuild is done, it gets no update or the
  old one, and its data no longer matches the server's. Nothing is lost: close the game fully, wait
  a few minutes, and open it again. It downloads the new update at the title screen.
- **Drops feel low.**
  The default is the base game's amounts. Raise **Quest drop amount** on the dashboard's first tab.
  Older StarPoint versions always gave 10x.
- **I installed a newer game APK over the old one. Do I need to do anything?**
  Yes: clear the game's cache once, before opening it. Android Settings > Apps > World Flipper >
  Storage > **Clear cache**. The game keeps a compiled copy of its code there, and an update doesn't
  replace it, so without this the old version keeps running. Don't use Clear data, which deletes the
  game files. (A first install doesn't need this.)
- **I set an old date and a unit's abilities changed, or its Mana Board 2 is gone.**
  That's intended: units play as they did on that date. See [Balance by date](#balance-by-date).
  Set the date back to get today's kits.
- **What's an H404 error?**
  The game asked for something the server doesn't have. In normal CN play this shouldn't happen;
  please report it with what you were doing. (Banners that linked to the official news site now
  open a short note instead of an H404.)

## Settings (.env)

`setup.bat` copies `.env.example` to `.env`. Edit `.env` and restart the server.

| Setting | Default | What it does |
|---|---|---|
| `LISTEN_HOST` | `127.0.0.1` | `0.0.0.0` lets other devices on your network in (needed for setup B) |
| `LISTEN_PORT` | `8000` | the server's port (the game app expects 8000) |
| `SERVER_START_DATE` | `2019-12-01T05:00:00Z` | the game date a new install starts at |
| `SERVER_TIME_TICKS` | `true` | the server clock runs like a real one |
| `LOGIN_BONUS_PAID_BEADS` | `150` | paid beads with each daily login bonus (0 = off); the dashboard's value replaces it once set |
| `RAID_SOLO_CLEARS_PER_KILL` | `1` | clears of a raid's hardest stage per boss kill |
| `COOP_SUMMON_SECONDS` | `5` | seconds before COM partners join after Recruit |
| `BANNER_ROTATION`, `BANNER_ROTATION_HOURS` | `false`, `24` | rotate summon banners automatically |
| `CN_ACCOUNT_ID` | empty | play every device on one account (empty = one account per device) |
| `CN_CDN_DIR`, `CN_TRANSLATED_DIR` | `.cdn/cn`, `.cdn/cn_text` | the CN game files and their English tables |
| `CN_SLIM_DIR` | `.cdn/cn_slim` | the small CN data set phones copy for schedule edits (the server builds it at start if missing) |

The quest drop amount and the never-ending mails are set on the dashboard, not in `.env`.
`.env.example` also lists a few settings that are only for rebuilding the translation and art
patches (see [docs/contributing.md](docs/contributing.md)); playing never needs them.

## Building it yourself

For working on GlobalPoint rather than playing it:

- [docs/contributing.md](docs/contributing.md): how the project is laid out and how to run it.
- [docs/routes.md](docs/routes.md): every route the server answers (generated from the server).
- [docs/CN_CLIENT_SETUP.md](docs/CN_CLIENT_SETUP.md): how the CN app was connected and globalized,
  from nothing.
- [docs/global/](docs/global/README.md): the original StarPoint pages for the global app (legacy),
  including captured traffic from the official global servers.
- `scripts/package_release.cjs`: copies a working setup A (code, game files and the game APK) into
  one ready-to-run folder, e.g. to move it to another PC. Not for publishing: the game APK isn't
  ours to host.
- `scripts/build_cn_obb.cjs` (optional): builds the OBB for setup C from a server's game files.
  See [docs/CN_CLIENT_SETUP.md](docs/CN_CLIENT_SETUP.md#9-optional-an-obb-for-phones).
- `scripts/gen_cn_slim.cjs`: the small CN data set the companion needs for schedule edits. The
  server runs it by itself at start when the CN game files are there and the set is missing.
- `scripts/build_kit_*.cjs`, `scripts/kit_dates.cjs`: build and read `assets/kit_dates.json`, the
  old unit kits for [Balance by date](#balance-by-date).
- `scripts/custom_units.cjs`, `assets/custom_units/`: new units for the CN app from data and files only,
  kept through every schedule rebuild. See [docs/CUSTOM_UNITS.md](docs/CUSTOM_UNITS.md), and
  [Getting a custom unit onto your device](docs/CUSTOM_UNITS.md#getting-a-custom-unit-onto-your-device-or-emulator)
  for each setup.
- `scripts/client_mod/README.txt`: the game app patches, in order, and how to build the app.
- `companion/README.md`: the StarPoint Companion app (Node.js on Android), and how to build it.

## Special thanks

- **[StarPoint](https://github.com/duosii/starpoint)** by Duosion: the server this is built on.
  Without it there'd be nothing to globalize.
- [wdfp-extractor](https://github.com/ScripterSugar/wdfp-extractor) for the assets and knowledge behind
  the data converter.
- [wfax](https://github.com/blead/wfax) for making modding possible.
- [nodejs-mobile](https://github.com/digidem/nodejs-mobile) (digidem fork), which runs the server
  inside the companion app.
- The World Flipper community, for names and sources used in the translation.

## License

GlobalPoint (StarPoint Fork) is licensed under [GPL-3.0](LICENSE).
