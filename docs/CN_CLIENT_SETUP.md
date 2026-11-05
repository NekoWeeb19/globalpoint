# Building the globalized CN app from scratch

> [!NOTE]
> **For developers.** This is how GlobalPoint was made, step by step. To play it, follow the
> [README](../README.md)'s setups, which use the ready-made downloads; none of this is needed.

This is how to go from nothing to the current state: the official Chinese (CN) World Flipper app,
connected to this StarPoint server, playing the global save, with global's English text and art
put into its game files, CN-only content (missions, events, summons, units) playable and schedulable
from the dashboard.

You need:

- the **CN 1.8.1 APK** (`com.leiting.wf`, arm64)
- the **CN CDN**, version 1.4.54 (the CN game-file download, ~11 GB unpacked)
- the **global CDN** (`.cdn/en`, already used by StarPoint), plus StarPoint's translation mod
- an **arm64 Android emulator** (tested: LDPlayer 9, Android 9) or phone, with ADB
- Node 20, Python 3, Java 17+, Android build-tools (zipalign, apksigner), FFDec only for SWF work

Paths used below are examples (change them to yours): the CN CDN unpacked at `C:/wf/cn-cdn`, and a
work folder `C:/wf/work` for the APK, decompiles and the "globalize" output folders.

Times are rough. Steps 3 to 6 are one-time builds; after that, day-to-day use is step 8. Step 9
(an OBB for phones) is optional.

---

## 1. Unpack the CN CDN (once, ~30 min)

Put the CN CDN so the folder has `archive-*-full`, `archive-*-diff`, `entities`, `path`
(the same layout as global's `.cdn/en`). Set it in `.env`:

```
CN_CDN_DIR="C:/wf/cn-cdn"
CN_ACCOUNT_ID=""           # an existing StarPoint account id to play that save (e.g. a global one); empty = a new account per device
CN_TRANSLATED_DIR=""       # filled in at step 5
```

CN archive names are `pinball-1.4.X-1.4.Y-...zip`. Always read them in **version-number** order
(`scripts/cn_archives.cjs`); sorting by name puts 1.4.9 after 1.4.53 and gives you old tables.

## 2. Patch and install the CN app (once, ~20 min)

The CN app asks a Leiting server for its API address; the patch points it at StarPoint
(`/cn` on port 8000) and skips the Leiting login SDK.

The steps below are the first build. The current app (build 25) adds more patches on top: co-op
speed, the OBB and drop-off folder for phones, and the `server.txt` address file.
[`scripts/client_mod/README.txt`](../scripts/client_mod/README.txt) lists build 25's full chain of
patches, in order, with the commands.

1. Take `assets/worldflipper_android_release.swf` out of the APK.
2. Patch it:
   `node scripts/client_mod/patch_cn_client.cjs original.swf patched-local.swf 127.0.0.1:8000/cn`
3. (Optional, recommended) English text built into the app's code:
   `node scripts/client_mod/patch_cn_text.cjs patched-local.swf patched-local-en.swf`
   (translations: `assets/translations/cn_app.json`)
4. (Optional, recommended) English app-bundle text (Lv, Stamina, result screen, battle messages,
   prologue): see step 6, it produces a new `bundle.zip` + `bundle.zip.sha1`.
5. Put the files back, align and sign (keep the keystore: later builds must use the same key to
   install as an update and keep the app's data):
   ```
   python -I scripts/client_mod/repack_apk.py wfcn.apk unsigned.apk assets/worldflipper_android_release.swf=patched-local-en.swf assets/bundle.zip=bundle.zip assets/bundle.zip.sha1=bundle.zip.sha1
   zipalign -p -f 4 unsigned.apk aligned.apk
   java -jar apksigner.jar sign --ks starpoint-release.keystore --ks-key-alias starpoint --ks-pass file:starpoint-release.keystore.pass --out wfcn-globalized.apk aligned.apk
   adb install -r --no-incremental wfcn-globalized.apk
   ```
6. **After installing a new build, delete the app's code cache**, or it keeps running the old code:
   `adb shell su -c "rm -rf /data/data/com.leiting.wf/cache/app"` (needs root), or without root:
   Android Settings > Apps > World Flipper > Storage > **Clear cache** (not Clear data).
7. Let the app reach StarPoint on your PC: `adb reverse tcp:8000 tcp:8000` and
   `adb reverse tcp:18888 tcp:18888` (co-op). These drop whenever ADB reconnects; re-run them
   (or keep a loop running that re-adds them every 30 s). Error F2032 means the link is gone.

## 3. Start StarPoint and log in (~10 min + first download)

`npx tsc && node --env-file=.env out/server.js`

Open the app, accept the terms, tap Start. The app downloads the CN game files from StarPoint
(`/cn/cdn`, about 10 GB on a fresh install), then logs in as `CN_ACCOUNT_ID`'s save. Crashes are
logged in `logs/cn_crash.log`, every CN request in `logs/cn_requests.log`. The app's own error log
(exact failing field) is on the device:
`/data/user/0/com.leiting.wf/com.leiting.wf/Local Store/custom_Release_Android/latest.log`.

Server code involved (already in this repo): `src/lib/cnClient.ts` (CN routes, reply shapes,
id filters, `inCnRequest()`), `src/routes/api/cn.ts`, `src/routes/cnVersion.ts`,
`src/lib/msgpackCompat.ts`, the hooks in `src/server.ts`.

## 4. English images and tables from global (once, ~2-3 h, mostly waiting)

Both CDNs name files the same way, so global's English copies can replace CN's.

1. Find the files that differ (6 workers in parallel, each writes a part):
   `node scripts/scan_cn_globalize.cjs <i> 6 "C:/wf/work/globalize/scan_<i>.json"` for i = 0..5
2. Pick safe images (same size, really changed, no layout change):
   `node scripts/plan_cn_globalize.cjs "C:/wf/work/globalize"` → `images.json`
3. Merge global's English into CN's tables (CN has extra columns; they're matched automatically):
   `node scripts/gen_cn_text.cjs "C:/wf/work/globalize" "C:/wf/work/globalize/text8"`
4. Build the translation memory (Chinese → global's English):
   `node scripts/gen_cn_glossary.cjs "C:/wf/work/globalize/text8"`
5. English UI labels sprite sheet: `node scripts/gen_cn_lang_sheet.cjs <out dir>` (reads the global
   APK from `GLOBAL_APK` in `.env`)

## 5. Translate what global doesn't have (as much as you like)

`assets/translations/cn.json` holds Chinese → English for CN-only text (`{ "strings": { zh: en } }`).
Never use an empty string as a translation (use `" "`). Keep `::placeholders::` identical.

- Apply memory + cn.json to every table (unit tables only get global's own text):
  `node scripts/apply_cn_translations.cjs "C:/wf/work/globalize/text8" "C:/wf/work/globalize/textN"`
  → writes `todo.json` (what's still Chinese).
- Patterned strings (dates, "× N", coins, ranks, title conditions...):
  `node scripts/compose_cn_translations.cjs <glossary.json> <todo.json>`
- Story episodes were translated with a small local helper that isn't in this repo: it showed an
  episode's lines and saved the translated ones into `assets/translations/cn.json`.
- Set `CN_TRANSLATED_DIR` in `.env` to the newest `textN`.
- Boss names must match inside the enemy models too, or co-op/boss battles stop with F0:
  `node scripts/gen_cn_boss_models.cjs "<textN>" "C:/wf/work/globalize/models1"`

## 6. Ship it to the app as an update (each time, ~5 min)

StarPoint lists its own update versions after CN's 1.4.54 and serves them at `/cn/patch`. **A
version the app already has is never downloaded again — always use a new number.**

The numbers below are the first ones used. Today the dashboard's schedule builds also take numbers
from this chain, and every phone running the companion builds its own. So hand-made patches (like
the art patches from `scripts/gen_cn_art_fill.cjs`) now use numbers far above them: 1.4.500 to
1.4.800 so far, and custom units' art updates use 1.4.9xx. Build each one on the newest version in `.cdn/cn_patches/patches.json`,
then save any schedule change on the dashboard so the schedule builds continue above it.

```
node scripts/build_cn_patch.cjs 1.4.55 1.4.54 "C:/wf/work/globalize/images.json"
node scripts/build_cn_patch.cjs 1.4.56 1.4.55 "C:/wf/work/globalize/textN/files.json"
node scripts/build_cn_patch.cjs 1.4.57 1.4.56 "C:/wf/work/globalize/models1/files.json"
```

App-bundle text (labels baked into the APK, needs the APK rebuild in step 2):
`node scripts/gen_cn_bundle.cjs wfcn.apk global.apk <glossary.json> "C:/wf/work/globalize/bundle2"`,
then repack `bundle.zip` with the replaced files and write its SHA-1 into `bundle.zip.sha1`.

## 7. CN-only content on the server (once, ~10 min)

CN has missions, events, quests, rewards, summons and units global doesn't. Each script adds
only what global lacks (global's data is untouched; added entries carry `cn: true`) and checks
its conversion against what both clients share first.

```
node --env-file=.env scripts/gen_cn_missions.cjs           # CN's own mission list (assets/missions_cn.json)
node scripts/gen_cn_ids.cjs                                # CN id lists (filters global-only ids out of CN replies)
node scripts/gen_cn_rewards.cjs                            # clear / score / rare score rewards
node scripts/gen_cn_quests.cjs                             # event quests + CN boss battles
node scripts/gen_cn_advent_rules.cjs                       # boss event rules (Purge-style solo stand-ins)
node scripts/gen_cn_raid.cjs                               # raids 6/7
node scripts/gen_cn_rush.cjs                               # Grand Gauntlet folders
node scripts/gen_cn_merge.cjs scripts/gen_ranking.cjs assets/ranking_event.json     # trials
node scripts/gen_cn_merge.cjs scripts/gen_carnival.cjs assets/carnival_event.json   # carnivals
node scripts/gen_cn_box_gacha.cjs                          # box summons
node scripts/gen_cn_characters.cjs                         # CN-only units (30)
node scripts/gen_cn_gacha.cjs                              # CN-only summon banners (361)
node --env-file=.env scripts/gen_event_catalog.cjs --cn    # CN-only events/banners for the dashboard
npx tsc
```

Restart the server afterwards.

Later features added more generators: the exchanges (`gen_cn_exchanges.cjs`,
`gen_cn_exchange_campaigns.cjs`), campaigns (`gen_cn_campaigns.cjs`), the growth fund, the Content
Guide, awakening and mana nodes, summon tickets, banner art, and more (`scripts/gen_cn_*.cjs`). Each
says what it builds in its first lines. Their output is committed in `assets/`, so a checkout
already has it; rerun one only to change what it makes.

## 8. Day to day: the dashboard

Schedule events and summons in the dashboard as usual. CN-only ones carry a "CN only" badge.
Each change builds a new CN update automatically (`scripts/gen_cn_event_schedule.cjs`, which also
refreshes the CN missions, shops and pass), plus the global app's event mod when the global CDN
(`.cdn/en`) is present. Restart the CN app to download it. Both apps can play the same save when
`CN_ACCOUNT_ID` is set to that account.

## 9. (Optional) An OBB for phones

Only needed to share the game for setup C, where a phone gets every game file as one file instead
of downloading ~12 GB from a server. The game app (build 23 or newer, with
`scripts/client_mod/patch_cn_storage_dropoff.cjs`) unpacks it by itself at its first start.

```
node scripts/build_cn_obb.cjs "C:/wf/obb" --server <StarPoint folder>
```

- It packs CN's base files and every StarPoint update in `.cdn/cn_patches/patches.json`, so build
  it after step 6 and any art patches. `--server` defaults to this checkout.
- The output is `main.1008001.com.leiting.wf.obb` (~10.3 GB; it needs that much free space and
  writes nothing else). `--parts 3` cuts it into three files (`...part1of3.obb` and so on), which
  game build 25 reads from the same folder. `-` instead of a folder streams it to stdout, e.g. straight onto a phone:
  `node scripts/build_cn_obb.cjs - | adb exec-in "cat > /sdcard/StarPoint/game/main.1008001.com.leiting.wf.obb"`
  (make the folder first, and give the game the permissions in README setup C, "By hand" step 4).
- It's a plain zip (files stored, zip64) whose first entry indexes every file. That lets the game
  unpack it from the end and shrink the file as it goes, so the phone needs little space beyond the
  OBB, and an interrupted unpack carries on next time.
- Where the phone takes it (`starpoint_game/` from build 24, `StarPoint/game/`, or
  `Android/obb/com.leiting.wf/` on some phones) and the permissions it needs: [INSTALL.md, setup C](INSTALL.md#c-on-a-phone-with-the-obb-file). The folder layout is in
  `scripts/client_mod/STORAGE_LAYOUT.txt`.

## Things that are different on the CN app

- Co-op works from the CN app (StarPoint's COM partners); CN rooms use CN's message numbers.
- CN-only units, events and stories were translated (see [DETAILS.md, Translation](DETAILS.md#translation)).
- Artwork with Chinese text and no English version (CN-only banners, some badges, the health
  notice, the tutorial demo captions) stays Chinese.
- Real-money bead packs aren't sold: there's no store behind them. Paid beads come with the daily
  login bonus, and the Special Exchange and Start Dash Exchange sell their tickets for paid beads.
