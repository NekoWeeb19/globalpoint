# StarPoint Companion

An Android app that runs the real StarPoint server on the phone, on `127.0.0.1:8000`, so the patched
CN game (the 127.0.0.1 build) plays with no PC: no root, no adb, no Shizuku. This is Phase 3 of the
sharing plan. Stage 1 was the feasibility prototype; stage 2 (this version, 0.2) adds the screens a
player needs.

**Status:** tested on LDPlayer (Android 9, x86_64) against the user's game (build 20, all files
installed, version 1.4.203):
- First-time setup: "Download from PC" copied the slim data set and the save (444 files, 97 MB) from a
  PC's StarPoint.
- With the PC's `adb reverse` removed, the game cold-started to the home screen served only by the
  phone.
- A play session on the phone's server: mail claim, a 10-pull (1,500 beads), a Trove purchase and a
  quest (start, finish, new best record, rank points) all saved correctly.
- Exporting the save, importing it back and restarting kept everything.
- The built-in dashboard works, and the signed, shrunk release APK starts.

**After merging `sharing-package`** (worker-thread rebuilds, portable paths, slim CN data), tested on
the second emulator (5556, game build 20) as a new player, with the companion's data from the clean
package server:
- Download from PC brought the slim set, the schedule data (slim CN tables + English tables) and
  dashboard pictures (6,199 files, 179 MB, about a minute), then the game update (80 files, 1.6 GB).
- The game downloaded the update from the companion, made a new account, did the guided first pull
  and reached home.
- **A schedule edit from the companion's dashboard works on the phone:** moving "10 Million Reroll
  Celebration" to start now ran the CN rebuild in a worker thread (no second Node process) from the
  slim tables. It regenerated the server's CN missions, passes and shops and wrote game update
  1.4.210: 48 files, 4.5 MB, the same 48 files a full-archive build gives. It took about 7 minutes on
  the emulator.
- After the main session's update-chain fix (sharing-package 9c16acc), the same 1.4.206 client took
  1.4.209 once. A second phone-side edit ("A Not-So-Silent Night", 37 data rows plus its summon
  banner) built 1.4.211, the game downloaded 1.4.210 + 1.4.211 (9 MB) from the companion, and the
  title shows ResVer 1.4.211 with no download on restart.
- The moved events themselves couldn't be checked in game on this new account: Events is locked at
  rank 2, and the moved summon banner was already open in the Portal before the move.

**0.3, first install over Wi-Fi** (emulator 5556, Android 9): companion and game uninstalled, game
build 21 installed fresh. Game data → Download from PC with Full game files + save asked for storage,
went on by itself once allowed, and copied 138,530 files (10.2 GB game files + the slim set) from a PC
server in 5 minutes (~33 MB/s over the LAN address). After the game's storage permission, the first
start moved all 138,093 files in (~6 minutes), the title showed ResVer 1.4.203, and the game went
through signup, the tutorial skip and nickname to the main menu, all on the phone's server with no
download.

## For players

1. Install the game APK (127.0.0.1 build) and `app-arm64-v8a-release.apk` (PC emulators:
   `app-x86_64-release.apk`) by opening the files ("install unknown apps").
2. Open **StarPoint Companion** → **Game data**, then either:
   - **Download from PC**: start StarPoint on your PC and enter its address as the phone sees it
     (e.g. `192.168.1.20:8000`). Tick "My save" to bring your account. Dashboard pictures (~80 MB),
     comics (~1.4 GB) and game updates (~2 GB, only if the game still has to download them) are optional.
     **Full game files** (~10 GB, 138k files) is for a phone whose game has never downloaded its files
     (see below).
   - **Choose zip...**: a data zip made with `node companion/tools/make-data-zip.cjs` (or shipped in the package).
3. Back on the main screen the server starts by itself ("Start the server when this app opens").
   Press **Let the server run in the background** once, so the phone doesn't stop it.
4. Play. The notification shows the server is running; its **Stop** button (or Stop in the app) ends it.

Buttons: **Dashboard** opens the server's dashboard inside the app; **Open in browser** opens it in
the phone's browser.

### First install: the game's files from the PC

A freshly installed game asks its server for the full ~10 GB download, and the companion doesn't
keep those files. Instead, **Full game files** copies them from the PC's StarPoint over Wi-Fi into
the game's drop-off folder, `StarPoint/game` on the phone's storage. Game build 21 and newer moves
that folder into its own storage at its next start (a few minutes, with an on-screen counter) and then
needs no download.
1. In **Game data**, tick **Full game files** (plus **My save** etc.) and press **Download from PC**.
   The first time, the app sends you to "All files access" (Android 11+) or asks for storage
   (Android 6-10): allow it, come back and press Download again. Keep the screen open; it keeps
   Wi-Fi awake meanwhile. Files already there are skipped, so pressing it again resumes.
2. Install World Flipper (build 21+) if it isn't yet, and press **Allow World Flipper "All files
   access"**: the game reads the drop-off folder but never asks for the permission by itself.
3. Start the server and open the game.

The phone needs ~10 GB free for the copy, and the same again while the game moves the files in
(`/sdcard` to the game's private storage is a copy on most phones).

### Getting your save out (and back in)

The save is the companion's data folder `files/data/.database` (`wdfp_data.db` plus the json state
files), not the game app. There are three ways to get it:
- **Export save** (main screen) writes `.database` as one zip wherever you pick (Downloads, a cloud
  drive...).
  - While the server runs, the database comes from a consistent snapshot the server makes
    (`VACUUM INTO`, via `/companion/manifest?save=1`).
  - While it's stopped, the files (including the `-wal` file) are copied as they are, which is a
    consistent set because nothing is writing.
  - If an export fails, the half-written file is deleted.
- **Import save** asks first, stops the server, replaces `.database` from such a zip (the old one
  is kept as `files/data/.database.old`), and starts the server again.
- **adb, no root:** the release APK is built **debuggable** on purpose, so:
  ```bash
  adb exec-out run-as org.globalpoint.companion tar -cf - files/data/.database > companion-save.tar
  ```
  Stop the server first (Stop button) so the database isn't mid-write.
- **In the dashboard:** Players → a player's save download (`/api/player/save?id=N`) gives that
  player's save as the game sees it (JSON). That's handy for looking at it, but it's not a database
  backup.

## 1. Embedding Node: nodejs-mobile 24.20.0 (digidem fork)

- **Choice:** [digidem/nodejs-mobile](https://github.com/digidem/nodejs-mobile) `v24.20.0-0`
  (2026-09-03), `nodejs-mobile-android-24.20.0-0.zip`, 74 MB. It has `libnode.so` for arm64-v8a,
  armeabi-v7a and x86_64, plus headers. The original `nodejs-mobile/nodejs-mobile` stopped at Node
  18.20.4. The digidem fork is maintained: Node 24 since 2026-08, NDK r27d, 16 KB pages, min SDK 24.
- **Version check:** the server needs Node ≥ 20. `--env-file` is PC only; on the phone
  `companion-main.js` uses `process.loadEnvFile`. Node 24.20 covers everything, and its built-in
  `node:sqlite` answers the SQLite question. Use the **full** flavor (the "lite" one drops sqlite).
- **How it runs:** a ~70-line JNI bridge (`app/src/main/jni/bridge.cpp`) calls `node::Start()` and
  sends stdout/stderr to logcat (tag `node`). Node starts once per process, so the server runs in its
  own process (`:node`): Stop ends that process, and the next Start gets a fresh one.
- **Size and memory:** one APK per ABI, ~76 MB each (`libnode.so` is ~65 MB, the server 9 MB zipped).
  The server process uses ~250 MB of RAM. Node and the server start in about 1 s; the first start
  after an install also unpacks 3,500 server files (~1.5 s).

## 2. SQLite: Node's built-in `node:sqlite`, through a small adapter

`src/data/sqlite.ts` opens the database with better-sqlite3 when it loads (the PC, unchanged) and
with `node:sqlite` when it doesn't (the phone). `SQLITE_DRIVER=node` forces node:sqlite for testing.
The rest of `src/` keeps the better-sqlite3 types and calls. Only `src/data/index.ts` changed (2 lines).

The adapter covers what the server uses (`pragma`, `exec`, `prepare().run/get/all/iterate`, 47
`transaction()` call sites, nested ones as savepoints, `.deferred/.immediate/.exclusive`) and copies
these better-sqlite3 behaviours:
- an array argument is a list of values (`.run([...values, id])`; found at signup in the stage 1 test)
- `undefined` binds as NULL
- keys of a named-value object that the SQL doesn't use are ignored (node:sqlite throws)
- integers beyond 2^53 come back as rounded numbers (node:sqlite throws)
- rows are plain objects, blobs are `Buffer`
- statements are cached per SQL text

A 28-case comparison script (better-sqlite3 on Node 20 vs the adapter on Node 26) now differs only
in two kinds of case:
- input that better-sqlite3 rejects: missing or extra positional values, two statements in one
  `prepare`, `.get()` on an INSERT, a `Date`
- the `changes` count after a SELECT, which the server never reads

On the PC, a full save export and the events list were byte-identical between the two drivers (except
the ticking clock). On the phone, the play session above found no adapter gaps.

## 3. Second Node processes (fixed by the main session; confirmed on the phone)

On the phone `process.execPath` is `/system/bin/app_process64`, so `execFile(process.execPath, …)`
**fails**. Other child processes and `worker_threads` work, including `node:sqlite` inside a worker
(measured with `COMPANION_PROBE=1` in `files/data/.env`). The running server starts a second Node in
these places:

| Where | Starts | When |
|---|---|---|
| `src/nya/eventSchedule.ts` `rebuildCnSchedule()` | `scripts/gen_cn_event_schedule.cjs` | after a dashboard schedule change, and from `checkCnCopyWindow()` when the game year leaves the yearly-copy window (only if `CN_CDN_DIR` exists) |
| `src/nya/eventSchedule.ts` `rebuildMod()` | `scripts/gen_event_schedule_mod.cjs` | every dashboard schedule save |
| `scripts/gen_cn_event_schedule.cjs` | `gen_cn_missions.cjs`, `gen_cn_pass_card.cjs`, `gen_cn_shops.cjs` | end of every CN schedule build |

Since `sharing-package` (828a2ff), `scripts/run_script.cjs` runs these scripts as worker threads,
and on the phone a dashboard schedule edit rebuilds the CN update this way. The global-app mod is
skipped when `<CDN_DIR>/en/entities` is missing, as on the phone.

Since 9c16acc the scripts write where the server reads: `.database` in the working folder, game
updates and schedule files under `CDN_DIR`, and the regenerated CN tables (missions, shops, passes)
in `CN_GENERATED_DIR`. On the phone all three are in the data folder, so the server folder (replaced
on every app update) is only read. The one link left is `data/web` → `server/web`, for the comics
placeholder (`src/routes/api/comic.ts` reads `<working folder>/web`).

## 4. What the phone server needs (the slim set)

| Needed for | Files | Size |
|---|---|---|
| Playing | server code + `assets/` | in the APK |
| Playing | `.database/` (save, schedules, news) | ~5 MB |
| Version check | `.cdn/cn/path`, `.cdn/cn_patches/patches.json` | 220 KB |
| Version info | `.cdn/cn/entities/*android_medium.csv` (only summed for `total_size`) | 17 MB |
| Comics screens (optional) | `.cdn/comics/` | 1.4 GB |
| Dashboard pictures (optional) | `.cdn/dashboard_images/` | 81 MB |
| A game that's behind (optional) | `.cdn/cn_patches/<version>/…` patch zips | 2.1 GB |
| Dashboard schedule edits (optional) | slim CN folder (`tables/`, `names.txt`, from `scripts/gen_cn_slim.cjs`) as `.cdn/cn/`, English tables as `.cdn/cn_text/` | ~140 MB |
| A game with no files yet (optional, not kept by the server) | `/sdcard/StarPoint/game/` (`info.json` + `download/production/...`) | 10.2 GB |

**Phone to PC route:** `src/routes/companion.ts` (registered at `/companion` in `src/server.ts`). It
reads the CN paths through `cnCdnRoot()`/`cnPatchDir()` and edits nothing else.
- `GET /companion/manifest?save=&patches=&images=&comics=` lists the files, each with the path it
  gets in the phone's data folder. With `save=1` it makes a fresh `VACUUM INTO` snapshot of the save
  and adds `CN_ACCOUNT_ID` to the reply, so the phone's `.env` matches.
- `GET /companion/file?path=` serves only paths a manifest can list (anything else: 404). The
  list is cached for a minute, since a download asks for thousands of files.
- `schedule=1` adds the slim CN folder: `CN_CDN_DIR` itself if it's slim, else `CN_SLIM_DIR`, else
  `<CDN_DIR>/cn_slim`. If none exists, the reply carries a note telling the player to run
  `node scripts/gen_cn_slim.cjs .cdn/cn_slim` on the PC. It also adds the English tables from
  `CN_TRANSLATED_DIR`.
- `game=1` adds the game's full set of files under `game/` (the phone maps it to
  `/sdcard/StarPoint/game/`; layout in `scripts/client_mod/STORAGE_LAYOUT.txt` on the storage
  drop-off branch). They are the entries of CN's base zips (no iOS), CN's updates in order, then
  StarPoint's patch zips in order, newest copy winning: 138,092 files at 1.4.203. The index comes
  from the zips' central directories (about 1.5 s) and is kept until the patches change. Each file is
  streamed straight out of its zip (inflated on the fly), so the PC keeps no unpacked copy.
  `game/info.json` is generated (version = the server's newest patch, `cnAssetVersion()`; baseUrl
  `http://127.0.0.1:8000/cn/cdn/`) and the phone writes it last, so a half-filled folder is never
  taken as finished. The phone downloads with 6 connections at once and retries a file up to 3 times.

`companion/tools/make-data-zip.cjs` builds the same set as an import zip from a running server: 17.5 MB
with a save, no comics or pictures.

## 5. The app

```
companion/
  app/src/main/jni/          bridge.cpp, Android.mk, Application.mk (libnode.so + libc++_shared)
  app/src/main/java/org/globalpoint/companion/
    MainActivity      status, Start/Stop, Dashboard, Game data, Export/Import save, battery, auto-start, log
    DataActivity      Game data screen: download from PC / import zip
    DashboardActivity the dashboard in a WebView (file uploads, downloads saved where the player picks)
    ServerService     foreground service in process ":node"; notification Stop action; restart after a crash
    ServerFiles       files/server (code, unpacked when server.version changes) and files/data (kept)
    DataTransfer, SaveBackup, ServerProbe, NodeBridge, Ui
  server/companion-main.js   Node entry: log to data/server.log, TMPDIR, links, phone .env defaults, start out/server.js
  tools/stage-server.cjs     builds companion/build/server-stage (out, assets, web, scripts, prod node_modules)
  tools/make-data-zip.cjs    data zip for "Choose zip..." from a running StarPoint
```

**Keep-alive:**
- foreground service (type `specialUse`, required from Android 14)
- `START_STICKY`, so Android restarts it if it kills the process
- if Node stops with an error, the service restarts it, up to 3 times in 2 minutes (then it stays
  stopped and the log says so)
- battery-optimisation exemption button, shown until granted
- not tested here: OEM task killers on Android 12–15 (LDPlayer is Android 9)

**Server status:** "running" only when the app's own `:node` process exists and port 8000
answers. If something else answers on 8000 (e.g. a PC through `adb reverse`), the screen says so.

**Phone defaults** (override in `files/data/.env`, same names as the PC `.env`):
`LISTEN_HOST=127.0.0.1` (co-op follows it since `sharing-package`), `LISTEN_PORT=8000`,
`COOP_HOST=127.0.0.1`, `CDN_DIR=data/.cdn`, `CN_CDN_DIR=data/.cdn/cn`,
`CN_TRANSLATED_DIR=data/.cdn/cn_text`, `CN_GENERATED_DIR=data/.generated`, `SERVER_START_DATE=2021-07-24T05:00:00Z`, and
`TMPDIR=data/.tmp` (Android has no `/tmp`; the save snapshot needs it).

### Build

Needs JDK 17+ (built with Temurin 25), Android SDK platform 36 + build-tools 36.1.0, NDK
27.3.13750724 (r27d), and the nodejs-mobile zip unpacked. **ndk-build refuses paths with spaces**,
and AGP resolves junctions, so the SDK must really live at a space-free path.

`companion/local.properties` (not in git):
```
sdk.dir=F\:/wf-android-sdk
nodejs.mobile.dir=F\:/wf-tools/nodejs-mobile-24.20.0
release.signing=F\:/WF client/tools/companion-keys/keystore.properties
```

```bash
npx tsc -p .
```

```bash
node companion/tools/stage-server.cjs
```

```bash
cd companion && ./gradlew assembleRelease
```

The output is `companion/app/build/outputs/apk/release/app-arm64-v8a-release.apk` and
`app-x86_64-release.apk`. `assembleDebug` gives the same, debug-signed.
- **Release build:** R8-shrunk, **debuggable** (see "Getting your save out"), versionCode 2.
  It is signed when `release.signing` points at a `keystore.properties`; otherwise it's unsigned.
- **Server files:** `server.zip` carries its SHA-256 (`server.version`), so the app unpacks the
  server only when it changed.
- **Gradle warns** that platform-tools is missing; that's harmless.

**Signing key:** `F:\WF client\tools\companion-keys\` (`release.jks` + `keystore.properties` with
the password). Certificate SHA-256 `F0:50:0C:58:…:9C:FB:00:5A`. **Back it up**: Android installs an
update only if it's signed with the same key. Debug and release builds have different keys, so
switching between them needs an uninstall, which deletes the companion's data (export the save first).

On this PC: SDK `F:\wf-android-sdk` (junction at `F:\WF client\tools\android-sdk`), Gradle cache
`GRADLE_USER_HOME=F:\WF client\tools\gradle-home`, nodejs-mobile in `F:\WF client\tools\`,
`F:\wf-tools` → `F:\WF client\tools`.

### Android versions (the real phones: Android 12 and 16)

Everything above was tested on LDPlayer, Android 9. App targets SDK 34, min SDK 24. What the code
does for newer Android, and what only a real phone can confirm:

| Android | What applies | In the app | Only a real phone can confirm |
|---|---|---|---|
| 11+ | Shared storage needs "All files access" (`MANAGE_EXTERNAL_STORAGE`) | Download opens the app's All files access page, and continues by itself when the player comes back with it allowed (re-checked in `onResume`). The game (target 30, declares the permission) gets its page from **Allow World Flipper "All files access"**; `<queries>` makes the game visible to the app | Both settings pages open; the copy writes `/sdcard/StarPoint/game`; the game's drop-off move works with All files access (the game side was only tested on Android 9) |
| 12+ | A foreground service can't be started from the background | The server is started only from the app's screen (Start, auto-start on open). A restart after a crash is allowed when the app may ignore battery optimizations (**Let the server run in the background**); without it, the refused start is caught and logged ("open the companion and press Start") instead of crashing | Crash restart with and without the battery exemption; OEM task killers |
| 13+ | Notifications need `POST_NOTIFICATIONS` | Asked once on the main screen. If denied, the server still runs; only the notification (and its Stop button) is hidden | The prompt shows; the service keeps running with it denied |
| 14+ | Foreground services need a type | `specialUse` with its subtype property and `FOREGROUND_SERVICE_SPECIAL_USE`; `startForeground(..., FOREGROUND_SERVICE_TYPE_SPECIAL_USE)` | It starts on 14+ and stays up with the game in front for an hour, screen off |
| 15+ | Time limits for `dataSync`/`mediaProcessing` services | Not used (`specialUse` has no time limit) | — |
| 16 | 16 KB memory pages on some phones | nodejs-mobile 24.20.0 is built for 16 KB pages. The app's own `libcompanion-bridge.so` was 4 KB aligned (NDK r27d's default) until 0.3, which sets `APP_SUPPORT_FLEXIBLE_PAGE_SIZES`; all three libraries are now 16 KB aligned (`llvm-readelf -l`, `zipalign -c -P 16`) | The app starts Node on the Android 16 phone. Behaviour changes for apps targeting 35/36 (forced edge-to-edge etc.) don't apply at target 34 |

Also phone-only: Wi-Fi speed for the ~10 GB game copy (6 connections at once; the screen and Wi-Fi
are kept awake while the Game data screen is open, but leaving the screen may let Android pause the
copy; pressing Download again resumes, finished files are skipped), and free space for the copy plus
the game's move.

## 6. Next steps

1. **Seeing a moved event in game:** check on an account past the Events unlock rank (the
   user's main save, or a test save imported with Import save).
2. **Comics placeholder:** if `src/routes/api/comic.ts` read the logo from the server folder, the
   last `web` link could go.
3. **Rebuild time:** a schedule edit takes ~7 minutes on the emulator. The game's requests keep
   being answered (worker thread), but players should be told to wait before reopening the game.
4. **Real-phone test on Android 12+:** keep-alive with the game in front for an hour, screen off,
   OEM killers, the notification permission prompt, and Wi-Fi download speed (the emulator downloads
   went through `adb reverse`, 1.5–3 MB/s).
5. A size number instead of the 17 MB `android_medium.csv` (needs `cnInstalledBytes()` to read it).
6. Resumable downloads for comics and patches (now a failed file restarts from zero; finished files
   are skipped).
7. **Seen during testing, not companion issues:**
   - The game shows a few labels in Chinese: "等级最大!" (level max), "登录奖励" (login bonus) and
     "当前进度" (current progress).
   - Opening mail shows an empty result box.
   - The three built-in "special" mails are never used up by design.
