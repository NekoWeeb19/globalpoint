# Contribution guide

How GlobalPoint is put together, for anyone who wants to fix or add something. To play it, see the
main [README](../README.md).

GlobalPoint is [StarPoint](https://github.com/duosii/starpoint) (a private server for the global World
Flipper app) with support for the **CN app** added on top. One server answers both apps and keeps
one save database. The CN app is the main one; the global app is [legacy](global/README.md).

## How the CN app talks to the server

- The patched CN app sends its API calls to `127.0.0.1:8000/cn/...`. Those calls are handled by the
  same routes as the global app's, with CN-specific replies decided in `src/lib/cnClient.ts`
  (`inCnRequest()` tells the code which app is asking).
- Request and response bodies are base64-encoded msgpack, as on global. ref45638's
  [msgpack-converter](https://ref45638.github.io/msgpack-converter/) is handy for reading captures.
- Game files: the app downloads CN's base files from `/cn/cdn` (CN's own version 1.4.54), then
  StarPoint's own updates from `/cn/patch` (English text and art, schedule changes). Each update
  is a new version number; the app never downloads a version it already has. The server numbers
  its schedule builds above the highest version it has seen, so they never repeat one a game may
  have (see [CN_CLIENT_SETUP.md](CN_CLIENT_SETUP.md#6-ship-it-to-the-app-as-an-update-each-time-5-min)).
- A phone can point the app at a PC instead of `127.0.0.1` with a `server.txt` file ([INSTALL.md, setup 2](INSTALL.md#2-phone-with-a-pc-server)).
- Co-op battles use a separate TCP server (`src/coop/tcp.ts`, port 18888) with COM partners.

Every route the server answers is listed in [routes.md](routes.md), generated from the server by
`scripts/gen_routes_doc.cjs`. Rerun it after adding or changing routes.

## Project layout

### `src/`
- `server.ts`: starts the server and registers every route.
- `routes/api/`: the game's API, one file per area (gacha, quests, missions, shops...). `cn.ts`
  holds CN-only endpoints.
- `routes/web/`, `routes/web_api/`: the dashboard's pages and its API (`/api/server/...`).
- `routes/cnVersion.ts`, `infodesk.ts`, `openapi.ts`: version check and the global app's Kakao
  login and platform endpoints.
- `lib/`: game rules used by the routes (quests, drops, gacha, missions, raids, the server clock...).
  `cnClient.ts` is the CN app's side: reply shapes, id filters, game-file versions and the update chain.
- `nya/`: features added on top of upstream StarPoint, usually with their saved state in `.database/`:
  the event and campaign schedules, news, login bonuses, the pass, missions, the drop amount and more.
- `data/`: the SQLite save database (`wdfpData.ts` reads and writes player data). On a phone the
  companion app uses Node's built-in `node:sqlite` through the same calls.
- `coop/`: the co-op battle server.

### `assets/`
The game's data converted to JSON (quests, units, rewards, shops...). Files ending in `_cn` are the
CN app's own versions. `missions_cn.json`, `cn_shops.json` and `pass_card_cn.json` are rebuilt
whenever the event schedule changes. `assets/translations/` holds the Chinese-to-English dictionaries.

### `web/`
The dashboard's pages (`web/pages/`) and its stylesheet. After changing Tailwind classes, rebuild the
stylesheet with `npm run css`.

### `scripts/`
Node scripts that build data, translations, game updates and packages. The ones you'll meet most:
- `gen_cn_event_schedule.cjs`: turns the dashboard's schedule into a game update. The server runs
  it by itself on every schedule change.
- `build_cn_patch.cjs`: packs changed game files into a new update version.
- `package_release.cjs`: copies a working setup into one ready-to-run folder (by default
  `../GlobalPoint-release`, next to the repository). It includes the game APK, so it's for your
  own use, not for publishing. `verify_package.cjs` checks a folder's game files and updates
  (`setup.bat` runs it).
- `build_cn_obb.cjs` (optional): builds the OBB with every game file, for phones and emulators (setup 1).
- `build_pack.cjs`: the data and comics packs for the companion's **Import pack...**.
- `gen_cn_art_fill.cjs`: global's pictures for CN pictures that were missing, as an art patch.
- `build_kit_*.cjs`, `kit_dates.cjs`: the old unit kits for balance by date (`assets/kit_dates.json`).
- `gen_cn_slim.cjs`: the small CN data set the phone needs for schedule changes.
- `custom_units.cjs`: custom CN units (`assets/custom_units/`, [MAKING_UNITS.md](MAKING_UNITS.md)), read by the
  schedule build and the server; `research/clone_cn_unit.cjs` makes one from an existing unit.
- `unit_editor.cjs` and `unit_editor_text.cjs`: the dashboard's Unit editor (reading and checking a unit's
  ability lines, and writing them in the game's own words), with its code tables in `assets/unit_editor/`
  ([UNIT_EDITOR.md](UNIT_EDITOR.md)).
- `cdn_hash.cjs` and `amf3.cjs`: shared helpers (the game's CDN file-name hash; reading and writing
  the game's AMF3 sprite layouts).
- `run_tests.cjs`: runs the tests (`npm test`, below).
- `client_mod/`: patches for the game app itself (see its `README.txt`).
- `converter.py`: upstream's converter from [wdfp-extractor](https://github.com/ScripterSugar/wdfp-extractor)
  output to `assets/`.

### `companion/`
The StarPoint Companion Android app, which runs this same server on a phone. Its
[README](../companion/README.md) explains how it works and how to build it.

## Development Setup

1. Install Node.js 22 (or 20), then `npm ci`. `better-sqlite3` 11.3 has ready-made Windows builds only
   for Node 20 and 22; on 23 and newer `npm ci` compiles it, which needs Visual Studio's C++ build tools
   (Desktop development with C++) and Python.
2. Copy `.env.example` to `.env` (it isn't in git; `setup.bat` makes it too) and point
   `CN_CDN_DIR` / `CN_TRANSLATED_DIR` at your CN game files and English tables. A few more settings
   are only for rebuilding the translation and art patches (`CN_GLOBALIZE_DIR`, `HEADER_FONT`,
   `GLOBAL_APK`, `CN_DECOMPILED_DIR`); `.env.example` says what each is for. The scripts have no
   hard-coded paths, so they read these from `.env`.
3. Build and run: `npx tsc -p .` then `node --env-file=.env out/server.js`.
4. Tests: `npm test` builds the server and runs every offline test (`scripts/test_*.mjs`, through
   `scripts/run_tests.cjs`; pass a name to run only matching ones:
   `node scripts/run_tests.cjs <filter>`). `scripts/test_cn_client.mjs` plays the CN app's start
   against a running server, so it's run by hand: `node scripts/test_cn_client.mjs [base URL]`.
5. Logs: `logs/cn_requests.log` (every CN request), `logs/cn_crash.log`. The game's own error log is
   on the device, in its private storage (`custom_Release_Android/latest.log`).

Test changes in the game itself: GlobalPoint's rule is that a change counts as working once it's
been seen working in the game.

[CN_CLIENT_SETUP.md](CN_CLIENT_SETUP.md) describes how the CN app was connected and globalized from
nothing, step by step.
