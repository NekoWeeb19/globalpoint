# StarPoint Companion

An Android app that runs the GlobalPoint server on the phone itself, on `127.0.0.1:8000`, so the
patched CN game plays with no PC: no root, no adb, no Shizuku. It's the server half of setups B and
C in the main [README](../README.md).

**Players:** the setup steps are in the main README
([setup B](../README.md#b-on-a-phone-copying-from-your-pc-over-wi-fi) and
[setup C](../README.md#c-on-a-phone-with-the-obb-file)). This page explains how the app works and
how to build it.

- [Using the app](#using-the-app)
- [How it works](#how-it-works)
- [What the phone server needs](#what-the-phone-server-needs)
- [The PC side: `/companion` routes](#the-pc-side-companion-routes)
- [Building](#building)
- [Android versions](#android-versions)
- [Known gaps](#known-gaps)

## Using the app

**Main screen**
- Server status, **Start** / **Stop**, and **Start the server when this app opens** (on by default).
  The status says "running" only when the app's own server process exists and port 8000 answers. If
  something else answers on 8000 (a PC through `adb reverse`, say), the screen says so.
- **Let the server run in the background:** asks Android to exempt the app from battery
  optimisation, so the phone doesn't stop the server. Shown until it's granted.
- **Dashboard** opens the server's dashboard inside the app (Back returns to the app). **Open in
  browser** opens it in the phone's browser instead.
- **Export save** / **Import save** (see [Saves](#saves)).
- A notification shows while the server runs; its **Stop** button ends it.
- The app and its dashboard follow the phone's light/dark setting.

**Game data screen.** The server needs some data the APK doesn't carry (see
[What the phone server needs](#what-the-phone-server-needs)). There are three ways to get it:
- **Download from PC:** enter the address of a GlobalPoint server on the same Wi-Fi (e.g.
  `192.168.1.20:8000`) and tick what to bring:
  - **My save** (account, units, progress)
  - **Game updates** (~2 GB; only if the game still has to download them)
  - **Event schedule editing** (~140 MB; lets the dashboard move events)
  - **Dashboard pictures** (~80 MB)
  - **Comics** (~1.4 GB)
  - **Full game files** (~10 GB), for a phone whose game has never downloaded its files. See below.

  Files already on the phone are skipped, so pressing it again resumes an interrupted copy.
- **Import pack...** takes a pack made on a PC (see [Packs](#packs)). It opens the system file
  picker, so it needs no storage permission.
- **Choose zip...** takes a zip with `.database/` and `.cdn/` folders (and optionally `.env`), as
  made by `companion/tools/make-data-zip.cjs`.

**Full game files.** A fresh game asks its server for the full ~10 GB download, and the companion
doesn't keep those files. **Full game files** copies them from the PC into the game's drop-off
folder, `StarPoint/game` in the phone's storage (138,000 files). The game (build 23 or newer) moves
them into its own storage at its next start, with an on-screen counter, and then needs no download.
- The copy needs **All files access** for the companion (Android 11+; storage permission on Android
  6-10). The app sends you to the settings page and carries on by itself when you come back.
- The game also needs **All files access** and its storage permissions to read the folder (on
  Android 13+ they're listed as **Music and audio** and **Photos and videos**), but never asks for
  them. The button **Allow World Flipper "All files access"** opens its settings page.
- The phone needs ~10 GB free for the copy, and about the same again while the game moves the files
  in (from shared storage to the game's private storage is a copy on most phones).
- Keep the Game data screen open during the copy: it keeps the screen and Wi-Fi awake. Leaving it
  may let Android pause the copy; pressing Download again resumes.

The OBB route (setup C) gives the game its files without this copy.

### Packs

For a phone with no PC on the same Wi-Fi. Made on a PC with `scripts/build_pack.cjs`, copied to the
phone (e.g. into Downloads), and loaded with **Import pack...**. The app recognises the pack by its
first entry, checks free space, unpacks it with progress (skipping files already there with the
same size, so it resumes), and then offers to delete the pack.

- **Data pack** (~2.25 GB; the README's downloads have one, `starpoint-data.zip`), made with
  `node scripts/build_pack.cjs data <out.zip> [--from <server folder>] [--slim <slim CN folder>]`:
  everything **Download from PC** brings except the save and the full
  game files. That's the CN version files, the slim CN tables, the English tables, the patch zips,
  the generated schedule files, dashboard pictures, and the schedule and news files.
  - The server stops while it's imported. A data pack never touches the save or account files.
  - It replaces whole folders, so earlier schedule edits on the phone are removed: the phone starts
    in the pack's state. Build it from a clean setup, not a server with its own schedule edits.
  - If the game's files are older than the pack (an older OBB, say), the game downloads the
    difference from the phone once.
- **Comics pack** (~1.4 GB), `node scripts/build_pack.cjs comics <out.zip>`: the server's comics
  folder. The server keeps running while it's imported.

### Saves

The save is the companion's data folder `files/data/.database` (`wdfp_data.db` plus the JSON state
files), not the game app.
- **Export save** writes `.database` as one zip wherever you pick (Downloads, a cloud drive...).
  While the server runs, the database comes from a consistent snapshot (`VACUUM INTO`). While it's
  stopped, the files are copied as they are. A failed export deletes its half-written file.
- **Import save** asks first, stops the server, replaces `.database` from such a zip (keeping the
  old one as `files/data/.database.old`), and starts the server again.
- **adb, no root:** the release APK is built debuggable on purpose, so this works (stop the server
  first):
  ```bash
  adb exec-out run-as org.globalpoint.companion tar -cf - files/data/.database > companion-save.tar
  ```
- The dashboard's **Players** page can download a player's save as the game sees it (JSON). That's
  handy for looking at it, but it isn't a database backup.

## How it works

**Node on Android.** The app embeds [nodejs-mobile](https://github.com/digidem/nodejs-mobile)
24.20.0 (the digidem fork; the original stopped at Node 18). The **full** flavor is needed, since
the lite one drops `node:sqlite`.
- A ~70-line JNI bridge (`app/src/main/jni/bridge.cpp`) calls `node::Start()` and sends
  stdout/stderr to logcat (tag `node`).
- Node can start only once per process, so the server runs in its own process (`:node`). Stop ends
  that process, and the next Start gets a fresh one.
- `server/companion-main.js` is the entry point: it logs to `data/server.log`, sets up `TMPDIR` and
  links, loads `files/data/.env` with `process.loadEnvFile` (`--env-file` is PC only), fills in the
  phone defaults, and starts the compiled server.
- One APK per ABI (arm64-v8a, x86_64), ~85 MB each (`libnode.so` alone is ~65 MB). The server
  process uses ~250 MB of RAM and starts in about a second.

**SQLite.** The PC uses better-sqlite3, a native module that isn't built for Android. On the phone
the server uses Node's built-in `node:sqlite` through an adapter, `src/data/sqlite.ts`, chosen
automatically when better-sqlite3 doesn't load (`SQLITE_DRIVER=node` forces it on a PC, for
testing). The rest of `src/` keeps better-sqlite3's types and calls. The adapter covers what the
server uses (`pragma`, `exec`, `prepare().run/get/all/iterate`, `transaction()` including nested
ones as savepoints) and copies better-sqlite3's behaviour where `node:sqlite` differs:
- an array argument is a list of values, and `undefined` binds as NULL
- unused keys in a named-value object are ignored
- integers beyond 2^53 come back as rounded numbers instead of throwing
- rows are plain objects, blobs are `Buffer`, and statements are cached per SQL text

**No second Node process.** On Android `process.execPath` is `/system/bin/app_process64`, so
`execFile(process.execPath, ...)` fails. The server's background jobs (the CN schedule rebuild after
a dashboard edit, and the missions, passes and shops it regenerates) run as worker threads through
`scripts/run_script.cjs` instead. The global-app mod build is skipped when `<CDN_DIR>/en/entities`
is missing, as on the phone. A schedule rebuild takes several minutes on a phone; the game's
requests keep being answered meanwhile.

**Writable folders.** The server folder (`files/server`, unpacked from the APK whenever its
`server.version` hash changes) is only read. Everything the server writes goes to `files/data`:
`.database`, game updates and schedule files under `CDN_DIR`, and the regenerated CN tables in
`CN_GENERATED_DIR`. One link, `data/web` → `server/web`, lets the server find the placeholder it shows for comics that
weren't downloaded.

**Keep-alive.**
- A foreground service of type `specialUse` (required from Android 14), `START_STICKY`.
- If Node stops with an error, the service restarts it, up to 3 times in 2 minutes. Then it stays
  stopped and the log says so.
- The battery-optimisation exemption button (see [Using the app](#using-the-app)).

**Phone defaults.** Set in `companion-main.js`; a `files/data/.env` (same names as the PC's `.env`)
overrides them:

| Setting | Phone default |
|---|---|
| `LISTEN_HOST`, `LISTEN_PORT` | `127.0.0.1`, `8000` |
| `COOP_HOST`, `COOP_PORT` | `127.0.0.1`, `18888` |
| `CDN_DIR`, `CN_CDN_DIR`, `CN_TRANSLATED_DIR` | `data/.cdn`, `data/.cdn/cn`, `data/.cdn/cn_text` |
| `CN_GENERATED_DIR` | `data/.generated` |
| `SERVER_START_DATE` | `2019-12-01T05:00:00Z` |
| `STARPOINT_COMPANION` | `1` (hides the dashboard's PC-only "Play on a phone over Wi-Fi" box) |

The rest match the PC's `.env.example`. Daily paid beads, the never-ending mails and the drop amount
are set on the dashboard, as on a PC.

### Code layout

```
companion/
  app/src/main/jni/          bridge.cpp, Android.mk, Application.mk (libnode.so + libc++_shared)
  app/src/main/java/org/globalpoint/companion/
    MainActivity      status, Start/Stop, Dashboard, Game data, Export/Import save, battery, auto-start, log
    DataActivity      Game data screen: download from PC, import pack, import zip
    DashboardActivity the dashboard in a WebView (file uploads, downloads saved where the player picks)
    ServerService     foreground service in process ":node"; notification Stop action; restart after a crash
    ServerFiles       files/server (code, unpacked when server.version changes) and files/data (kept)
    DataTransfer, SaveBackup, ServerProbe, NodeBridge, Ui
  server/companion-main.js   Node entry point (see above)
  tools/stage-server.cjs     builds companion/build/server-stage (out, assets, web, scripts, prod node_modules)
  tools/make-data-zip.cjs    a data zip for "Choose zip..." from a running server
  tools/make-icons.cjs       the app icons
```

## What the phone server needs

| Needed for | Files | Size |
|---|---|---|
| Playing | server code + `assets/` | in the APK |
| Playing | `.database/` (save, schedules, news) | ~5 MB |
| Version check | `.cdn/cn/path`, `.cdn/cn_patches/patches.json` | 220 KB |
| Version info | `.cdn/cn/entities/*android_medium.csv` (only summed for `total_size`) | 17 MB |
| Comics (optional) | `.cdn/comics/` | 1.4 GB |
| Dashboard pictures (optional) | `.cdn/dashboard_images/` | 81 MB |
| A game that's behind (optional) | `.cdn/cn_patches/<version>/...` patch zips | ~2 GB |
| Dashboard schedule edits (optional) | the slim CN folder (`tables/`, `names.txt`, from `scripts/gen_cn_slim.cjs`) as `.cdn/cn/`, the English tables as `.cdn/cn_text/` | ~140 MB |
| A game with no files yet (optional; the server doesn't keep them) | `/sdcard/StarPoint/game/` (`info.json` + `download/production/...`) | ~10 GB |

## The PC side: `/companion` routes

**Download from PC** talks to these routes on the PC's server (`src/routes/companion.ts`). They
only read.
- `GET /companion/manifest?save=&patches=&images=&comics=&schedule=&game=` lists the files, each
  with the path it gets in the phone's data folder.
  - `save=1` adds a fresh `VACUUM INTO` snapshot of the save and its state files, and the PC's
    `CN_ACCOUNT_ID`, so the phone's `.env` matches.
  - `schedule=1` adds the slim CN folder (`CN_CDN_DIR` if it's already slim, else `CN_SLIM_DIR`,
    else `<CDN_DIR>/cn_slim`; the server builds it at start if it's missing) and the English
    tables from `CN_TRANSLATED_DIR`.
  - `game=1` adds the game's full file set under `game/` (the phone puts it in
    `/sdcard/StarPoint/game/`): CN's base zips (no iOS), CN's updates in order, then the patch zips
    in order, the newest copy of each file winning. Each file is streamed straight out of its zip,
    so the PC keeps no unpacked copy. `game/info.json` is generated, and the phone writes it last,
    so a half-filled folder is never taken as finished.
- `GET /companion/file?path=` serves only paths a manifest can list (anything else is a 404). The
  list is cached for a minute.

The phone downloads with several connections at once, retries a failed file up to 3 times, and
keeps a record of what it copied, so a later copy skips those files.

## Building

**Needs:**
- JDK 17 or newer
- Android SDK platform 36 and build-tools 36.1.0
- NDK 27.3.13750724 (r27d)
- the nodejs-mobile Android zip (`nodejs-mobile-android-24.20.0-0.zip` from the digidem fork's
  releases), unpacked

**ndk-build refuses paths with spaces**, and Gradle resolves junctions and symlinks, so the SDK and
nodejs-mobile must really live at a path without spaces.

Create `companion/local.properties` (not in git), with your own paths:
```
sdk.dir=C\:/android-sdk
nodejs.mobile.dir=C\:/tools/nodejs-mobile-24.20.0
release.signing=C\:/keys/keystore.properties
```

Then, from the repository root, compile the server, stage it into the app, and build:

```bash
npx tsc -p .
```

```bash
node companion/tools/stage-server.cjs
```

```bash
cd companion && ./gradlew assembleRelease
```

Re-run `stage-server.cjs` after any server change, or the APK keeps the old server code.

The output is `companion/app/build/outputs/apk/release/app-arm64-v8a-release.apk` (phones) and
`app-x86_64-release.apk` (PC emulators). `assembleDebug` gives the same, debug-signed.
- The release build is R8-shrunk and **debuggable** on purpose (see [Saves](#saves)).
- It's signed when `release.signing` points at a `keystore.properties` file (`storeFile`,
  `storePassword`, `keyAlias`, `keyPassword`); otherwise it's unsigned.
- Gradle warns that platform-tools is missing; that's harmless.

**Keep your signing key.** Android installs an update only if it's signed with the same key as the
installed app. Changing keys (or switching between debug and release builds) needs an uninstall,
which deletes the companion's data, so export the save first.

## Android versions

The app targets SDK 34, min SDK 24 (Android 7). It's tested on an Android 9 emulator (LDPlayer) and
on real Android 16 devices (a Samsung phone and a tablet: the server ran for over 3 hours without
stopping, and the full ~10 GB copy finished). Android 12 testing is under way.

| Android | What changes | What the app does |
|---|---|---|
| 11+ | Shared storage needs "All files access" (`MANAGE_EXTERNAL_STORAGE`) | Download opens the app's All files access page and carries on when you come back with it allowed. The game gets its own page from **Allow World Flipper "All files access"** (`<queries>` makes the game visible to the app). |
| 12+ | A foreground service can't be started from the background | The server starts only from the app's screen (Start, or auto-start when the app opens). A restart after a crash works when the battery exemption is granted; without it, the refused start is logged ("open the companion and press Start") instead of crashing. |
| 13+ | Notifications need `POST_NOTIFICATIONS` | Asked once on the main screen. If denied, the server still runs, without the notification and its Stop button. |
| 14+ | Foreground services need a type | `specialUse`, with `FOREGROUND_SERVICE_SPECIAL_USE`. |
| 15+ | Time limits for `dataSync`/`mediaProcessing` services | Not used: `specialUse` has no time limit. |
| 16 | 16 KB memory pages on some phones | All three of the app's native libraries are 16 KB aligned. Three of the **game's** own protection libraries are 4 KB aligned, so the game itself may not start on a 16 KB-page phone (check with `adb shell getconf PAGE_SIZE`). |

## Known gaps

- **Not yet confirmed on a real phone:** the server staying up with the screen off for a long time,
  OEM task killers (Android 12-15), the notification prompt, and phones with 16 KB pages.
- **Downloads restart a failed file from zero.** Finished files are skipped, but a large comic or
  patch zip that fails halfway starts over.
- **Version info reads a 17 MB file** (`android_medium.csv`) only to sum a size; a stored number
  would do.
