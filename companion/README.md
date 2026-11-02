# StarPoint Companion (prototype)

An Android app that runs the real StarPoint server on the phone, on `127.0.0.1:8000`, so the patched
CN game (the 127.0.0.1 build) plays with no PC: no root, no adb, no Shizuku. This is stage 1 of
Phase 3 of the sharing plan: a feasibility prototype, not a release.

**Result: it works.** On LDPlayer (Android 9, x86_64) the companion started the unchanged server
code from `out/` under embedded Node 24.20 in about 1 second. With the PC's `adb reverse` removed,
the game was force-stopped and cold-started. It reached the title screen (ResVer 1.4.203, no download
offered), signed up (`[cn] signup: device … -> account 5`), loaded the save and reached the home
screen, served only by the phone. The dashboard (`/`), `/api/player/`, `/api/server/events` and
`/public/tailwind.css` all answered from the phone.

## 1. Embedding Node: nodejs-mobile 24.20.0 (digidem fork)

- **Choice:** [digidem/nodejs-mobile](https://github.com/digidem/nodejs-mobile) `v24.20.0-0`
  (2026-09-03), `nodejs-mobile-android-24.20.0-0.zip`, 74 MB. It holds `libnode.so` for arm64-v8a,
  armeabi-v7a and x86_64, plus headers. The original `nodejs-mobile/nodejs-mobile` stopped at Node
  18.20.4. The digidem fork is maintained: Node 24 line since 2026-08, NDK r27d, 16 KB pages, min SDK 24.
- **Version check:** the server needs Node ≥ 20 (`package.json` engines). It uses `--env-file`
  (PC only; on the phone `companion-main.js` calls `process.loadEnvFile`, Node ≥ 21.7) and nothing
  newer. Node 24.20 covers all of it, and its built-in `node:sqlite` solves the SQLite question.
  Use the **full** flavor: the "lite" zip drops sqlite.
- **How it runs:** `libnode.so` is a library, not a program. A ~70-line JNI bridge
  (`app/src/main/jni/bridge.cpp`) calls `node::Start()` and sends stdout/stderr to logcat (tag
  `node`). Node can start only once per process, so the server runs in its own process (`:node`).
  Stop ends that process, and the next Start gets a fresh one (tested).
- **Cost:** the debug APK is ~150 MB. `libnode.so` is ~65 MB per ABI after stripping, and the
  server is 9 MB zipped. A release with ABI splits (or arm64 only) would be ~75 MB. RAM use while
  running was ~250 MB (RSS of `:node`).

## 2. SQLite: Node's built-in `node:sqlite`, through a small adapter

No better-sqlite3 build exists for nodejs-mobile, and building one means cross-compiling a native
addon against `libnode.so`. Instead, `src/data/sqlite.ts` (new, ~90 lines) opens the database with
better-sqlite3 when it loads (the PC, unchanged) and falls back to `node:sqlite` when it doesn't
(the phone). `SQLITE_DRIVER=node` forces the fallback for testing. The rest of `src/` keeps the
better-sqlite3 types and API.

**What changed in `src/`:** only `src/data/index.ts` (2 lines: open through `openDatabase()`) plus
the new `src/data/sqlite.ts`. The files that `import { Database } from "better-sqlite3"` only use
the type, which disappears at compile time.

**API the server uses, all covered:** `pragma()` (2 calls), `exec()`, `prepare().run/get/all/iterate`
(~320 calls), `transaction()` (47 places, nested ones become savepoints), `lastInsertRowid` and
`changes`. The adapter matches these better-sqlite3 behaviours:
- an array argument is a list of values: `.run([...values, id])` in `wdfpData.ts`. node:sqlite read
  it as named values ("Unknown named parameter '0'"). The emulator test caught this at signup.
- `undefined` binds as NULL; node:sqlite throws.
- rows come back as plain objects (node:sqlite rows have no prototype), and blobs as `Buffer`.
- prepared statements are cached per SQL text (better-sqlite3 code prepares in every call).
- Same in both: numbers bind as REAL (affinity stores them as INTEGER), booleans are refused,
  `@name`/`:name` with `{ name }` work.

**Checked:** on the PC, the same database copy served by Node 20 + better-sqlite3 and by Node 26 +
node:sqlite gave identical `/api/player/save?id=5` (243 KB) and `/api/server/events` (383 KB). The
only differences were the ticking clock's timestamps. On the emulator: signup, load and home ran on
node:sqlite. **Not yet exercised:** quests and other writes through node:sqlite (signup and the
startup schedule moves were the writes tested).

**Fallback if node:sqlite is ever a problem:** sql.js / wa-sqlite (WebAssembly) behind the same
adapter. That is slower, and saves need explicit flushing.

## 3. What started on the emulator, and what the game saw

Device: LDPlayer9, Android 9 (SDK 28), x86_64 (the APK carries x86_64 + arm64-v8a). Test data in
`files/data/` (22 MB, pushed with `run-as`): a **copy** of the PC's `.database`, CN `path` (171 KB),
`entities/10939-android_medium.csv` (17 MB), `cn_patches/patches.json` (52 KB), and `.env` with
`CN_ACCOUNT_ID=5`.

```
[companion] unpacked 3500 files in 1045 ms
--- starting (node v24.20.0, 24.20.0-0, x64)
[sqlite] better-sqlite3 not usable (Cannot find module 'better-sqlite3'); using node:sqlite
Event schedule: 7 event(s) moved (7 server records).
Yearly campaigns: 2 login bonus(es), 5 free pull(s), 11 reward and 10 stamina campaign(s) repeat every year.
[coop tcp] co-op battle server listening on 0.0.0.0:18888
StarPoint is listening on http://127.0.0.1:8000
[cn] signup: device 426373012262 -> account 5, viewer 341964148
```

The game, cold-started (force-stop, then launch, then Tap to Start), reached the home screen with
the save. The **Dashboard** button opens the phone's browser at `http://127.0.0.1:8000/`. On LDPlayer,
Chrome first showed its own first-run terms screen. A built-in WebView screen would avoid that
(next steps).

Notes:
- The co-op server binds `0.0.0.0:18888` (hardcoded in `src/coop/tcp.ts`), so it's reachable on the
  phone's Wi-Fi. HTTP uses `LISTEN_HOST=127.0.0.1`. Bind co-op to 127.0.0.1 too for the phone.
- On a later cold start the game showed Leiting's user-agreement / privacy prompt
  (用户协议与隐私政策). It didn't appear on the earlier starts, and I didn't answer it.
- The dashboard's `tailwind.css` is generated (`npm run css`) and git-ignored. The stage script now
  builds it when it's missing.

## 4. Second Node processes, and the in-process fix (not done yet)

**Measured on the emulator** (opt-in probe in `companion-main.js`, `COMPANION_PROBE=1`):

```
[probe] execPath=/system/bin/app_process64 argv0=node
[probe] execFile(process.execPath) failed: Command failed: /system/bin/app_process64 -e ...
[probe] execFile(/system/bin/sh): shell ok
[probe] worker_threads: worker ok DatabaseSync
```

So `process.execPath` is Android's app launcher, not Node, and every `execFile(process.execPath, …)`
**fails**. Other child processes and `worker_threads` work, including `node:sqlite` inside a worker.

Places the running server starts a second Node:

| Where | Starts | When |
|---|---|---|
| `src/nya/eventSchedule.ts:59` `rebuildCnSchedule()` | `scripts/gen_cn_event_schedule.cjs` | after a dashboard event/campaign change (`rebuildMod`), and from `checkCnCopyWindow()` (1 min after start, then every 10 min) when the game year leaves the yearly-copy window. Only if `CN_CDN_DIR` exists. |
| `src/nya/eventSchedule.ts:189` `rebuildMod()` | `scripts/gen_event_schedule_mod.cjs` (global client's mod) | every dashboard schedule save |
| `scripts/gen_cn_event_schedule.cjs:371` | `scripts/gen_cn_missions.cjs` | end of every CN schedule build |
| `scripts/gen_cn_event_schedule.cjs:373` | `scripts/gen_cn_pass_card.cjs` | same |
| `scripts/gen_cn_event_schedule.cjs:375` | `scripts/gen_cn_shops.cjs` | same |

(PC-only build tools also do it: `scripts/client_mod/patch_*.cjs`, `scripts/gen_cn_merge.cjs`. They
call `java`/FFDec, never run on the phone, and need no change.)

**Proposed change: one worker thread per rebuild, with the scripts callable as functions.**

1. Each script keeps working from the command line but exports its work:
   `module.exports = { run }` with `if (require.main === module) run().catch(…)`, and `process.exit(1)`
   replaced by a throw. `run(options)` takes what it now reads from `process.argv`/`process.env`
   (`CN_TRANSLATED_DIR`, `CN_CDN_DIR`, schedule paths). `gen_cn_missions.cjs` (`process.exit(1)` at
   line 132), `gen_cn_pass_card.cjs` and `gen_cn_shops.cjs` (`.catch(… process.exit(1))`) and
   `gen_cn_event_schedule.cjs` (`main().catch(… process.exit(1))`) need this.
2. `gen_cn_event_schedule.cjs` calls the three generators in place:
   `await require("./gen_cn_missions.cjs").run({ translated: TRANSLATED })`, and so on, instead of `execFileSync`.
3. `src/nya/eventSchedule.ts` runs each script in a `new Worker(scriptRunner, { workerData: { script, options } })`.
   `scriptRunner` is a 10-line file that requires the script, awaits `run()`, and posts back
   `{ ok, lastLine }` or `{ ok: false, error }`. The `cnRunning`/`cnAgain` queue and the
   `modStatus` messages stay the same. Console output goes to the same log, since workers share stdout.
   This works on the PC too, so there's one code path, not a phone special case.

Why a worker and not a plain `require()` in the server thread: the CN build reads and writes
hundreds of MB of zips synchronously (`execFileSync`, `fs.*Sync`, `unzipper`) for seconds to
minutes. In the server thread that would freeze the game's requests. Watch-outs: the scripts must
not keep module-level state between runs (a fresh Worker each time guarantees that), and
`gen_cn_event_schedule.cjs` requires `../out/lib/*.js`, which works the same from a worker.

## 5. The slim-data question: what the phone server needs once the game has its files

From reading `src/lib/cnClient.ts`, `src/routes/api/comic.ts` and `src/nya/eventSchedule.ts`, and
confirmed by the emulator run (which used only the 22 MB set above):

| Needed for | Files | Size | Notes |
|---|---|---|---|
| Playing (must) | server code + `assets/` | 9 MB zipped in the APK (36 MB unpacked) | carried in the APK |
| Playing (must) | `.database/` (save, schedules, news) | ~5 MB | player data, kept across app updates |
| Version check (must) | `.cdn/cn/path` | 171 KB | `cnPathList()`: the base version and CN's own updates |
| Version check (must) | `.cdn/cn_patches/patches.json` | 52 KB | the game's target version; the patch **zips** are only needed while the game is behind |
| Version info | `.cdn/cn/entities/*android_medium.csv` | 17 MB | only summed for `total_size` (`cnInstalledBytes()`). Could become one number in a small file |
| Comics screens | `.cdn/comics/` | 1.4 GB | served by the server at play time. Without it, the list shows the placeholder (no crash) |
| Dashboard pictures | `.cdn/dashboard_images/` | 81 MB | event banners in the dashboard only |
| Dashboard schedule edits | CN base archives + translated tables + `cn_read.cjs` | 10 GB + 64 MB | `gen_cn_event_schedule.cjs` measures event windows from the **original** CN archives. Needs the planned "small pre-extracted originals" file before it can run on a phone |

So a phone that already has the game's files needs **~25 MB** to play (or ~8 MB once the csv is a
number), plus comics (1.4 GB, optional) and dashboard images (81 MB, optional). Dashboard schedule
editing is the one feature that doesn't fit yet. It needs both the worker change (section 4) and
the pre-extracted originals. Until then, with no `.cdn/cn/archive-*` on the phone, a schedule save
would fail inside the script.

Path quirk found: `cnPatchDir()` uses the server's code folder (`__dirname/../../.cdn/cn_patches`),
while comics and dashboard images use `process.cwd()/.cdn`. `companion-main.js` runs in the data
folder and links `server/.cdn` → `data/.cdn` and `data/web` → `server/web`. A cleaner fix is
`path.join(process.env.CDN_DIR ?? ".cdn", "cn_patches")` in `cnClient.ts`.

## 6. The app (this folder)

```
companion/
  app/src/main/jni/bridge.cpp, Android.mk, Application.mk   JNI bridge, libnode.so, libc++_shared
  app/src/main/java/org/globalpoint/companion/
    MainActivity.java   Start / Stop / Dashboard buttons, server status (polls 127.0.0.1:8000), log tail
    ServerService.java  foreground service in process ":node"; unpacks, then starts Node
    ServerFiles.java    files/server (code, replaced each install) and files/data (kept)
    NodeBridge.java     native startNode(String...)
  server/companion-main.js   Node entry: log to data/server.log, chdir, phone .env defaults, require out/server.js
  tools/stage-server.cjs     builds companion/build/server-stage (out, assets, web, scripts, prod node_modules)
```

The package is `org.globalpoint.companion`, with min SDK 24 and target SDK 34. Its foreground
service type is `specialUse` (required from Android 14). Settings come from `files/data/.env`
(same names as the PC `.env`), with phone defaults `LISTEN_HOST=127.0.0.1`, `CDN_DIR=data/.cdn`
and `CN_CDN_DIR=data/.cdn/cn`.

### Build

Needs JDK 17+ (built with Temurin 25), Android SDK platform 36 + build-tools 36.1.0, NDK
27.3.13750724 (r27d), and the nodejs-mobile zip unpacked. **ndk-build refuses paths with spaces**,
and AGP resolves junctions, so the SDK must really live at a space-free path.

`companion/local.properties` (not in git):
```
sdk.dir=F\:/wf-android-sdk
nodejs.mobile.dir=F\:/wf-tools/nodejs-mobile-24.20.0
```

```bash
npx tsc -p .
```

```bash
node companion/tools/stage-server.cjs
```

```bash
cd companion && ./gradlew assembleDebug
```

The output is `companion/app/build/outputs/apk/debug/app-debug.apk`. Gradle warns that
platform-tools is missing; that's harmless (only adb lives there).

On this PC: the SDK is at `F:\wf-android-sdk` (with a junction at `F:\WF client\tools\android-sdk`),
Gradle 9.8.2 at `F:\WF client\tools\gradle-9.8.2`, nodejs-mobile at
`F:\WF client\tools\nodejs-mobile-24.20.0`, `F:\wf-tools` is a junction to `F:\WF client\tools`,
`GRADLE_USER_HOME=F:\WF client\tools\gradle-home`, and the downloads are kept in
`F:\WF client\tools\companion-dl`.

## 7. Next steps

1. **Worker-thread rebuilds** (section 4) in `src/nya/eventSchedule.ts` and the four scripts.
2. **First-time data:** a screen to bring in the slim set: import a zip, or download from the PC's
   StarPoint over Wi-Fi (plan route (a)). The phone needs `path`, `patches.json`, the size number
   and, for new players, the patch zips. Optionally import an existing save.
3. **Built-in dashboard** (WebView activity), so no browser first-run screens get in the way.
4. **Release build:** signing key, arm64-only or ABI splits (~75 MB), R8, a proper icon, and a
   version stamp so `server.zip` unpacks only when it changes.
5. **Keep-alive:** ask to ignore battery optimisation, and test that the service survives the game
   in front on real phones (Android 12–15 OEM killers). Not tested here: LDPlayer is Android 9.
6. **Small server tweaks for the phone:** co-op bind address from an env var (`127.0.0.1`), and
   `cnPatchDir()` from `CDN_DIR`. Then drop the links in `companion-main.js`.
7. **Pre-extracted CN originals** for `gen_cn_event_schedule.cjs` (plan Phase 3, "slim server
   data"), so schedule edits run without the 10 GB archives.
8. **Test a full play session on node:sqlite:** quests, gacha, shop, mail. Check that the adapter
   never hits an unhandled better-sqlite3 behaviour.
