# Playing the CN app on StarPoint ("Globalized CN")

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

Paths used below (change them to yours): CN CDN unpacked at `D:\WF client\.cdn\cn`, a work folder
`F:\WF client` (APK, decompiles, the "globalize" output folders).

Times are rough. Steps 3 to 6 are one-time builds; after that, day-to-day use is step 8.

---

## 1. Unpack the CN CDN (once, ~30 min)

Put the CN CDN so the folder has `archive-*-full`, `archive-*-diff`, `entities`, `path`
(the same layout as global's `.cdn/en`). Set it in `.env`:

```
CN_CDN_DIR="D:/WF client/.cdn/cn"
CN_ACCOUNT_ID="5"          # the StarPoint account the CN app logs in as (your global save)
CN_TRANSLATED_DIR=""       # filled in at step 5
```

CN archive names are `pinball-1.4.X-1.4.Y-...zip`. Always read them in **version-number** order
(`scripts/cn_archives.cjs`); sorting by name puts 1.4.9 after 1.4.53 and gives you old tables.

## 2. Patch and install the CN app (once, ~20 min)

The CN app asks a Leiting server for its API address; the patch points it at StarPoint
(`/cn` on port 8000) and skips the Leiting login SDK.

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
   `adb shell su -c "rm -rf /data/data/com.leiting.wf/cache/app"` (needs root on the emulator).
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
   `node scripts/scan_cn_globalize.cjs <i> 6 "F:/WF client/globalize/scan_<i>.json"` for i = 0..5
2. Pick safe images (same size, really changed, no layout change):
   `node scripts/plan_cn_globalize.cjs "F:/WF client/globalize"` → `images.json`
3. Merge global's English into CN's tables (CN has extra columns; they're matched automatically):
   `node scripts/gen_cn_text.cjs "F:/WF client/globalize" "F:/WF client/globalize/text8"`
4. Build the translation memory (Chinese → global's English):
   `node scripts/gen_cn_glossary.cjs "F:/WF client/globalize/text8"`
5. English UI labels sprite sheet: `node scripts/gen_cn_lang_sheet.cjs <out dir>`

## 5. Translate what global doesn't have (as much as you like)

`assets/translations/cn.json` holds Chinese → English for CN-only text (`{ "strings": { zh: en } }`).
Never use an empty string as a translation (use `" "`). Keep `::placeholders::` identical.

- Apply memory + cn.json to every table (unit tables only get global's own text):
  `node scripts/apply_cn_translations.cjs "F:/WF client/globalize/text8" "F:/WF client/globalize/textN"`
  → writes `todo.json` (what's still Chinese).
- Patterned strings (dates, "× N", coins, ranks, title conditions...):
  `node scripts/compose_cn_translations.cjs <glossary.json> <todo.json>`
- Story episodes: `F:\WF client\globalize\story_tr.cjs show|save <file>` (helper).
- Set `CN_TRANSLATED_DIR` in `.env` to the newest `textN`.
- Boss names must match inside the enemy models too, or co-op/boss battles stop with F0:
  `node scripts/gen_cn_boss_models.cjs "<textN>" "F:/WF client/globalize/models1"`

## 6. Ship it to the app as an update (each time, ~5 min)

StarPoint lists its own update versions after CN's 1.4.54 and serves them at `/cn/patch`. **A
version the app already has is never downloaded again — always use a new number.**

```
node scripts/build_cn_patch.cjs 1.4.55 1.4.54 "F:/WF client/globalize/images.json"
node scripts/build_cn_patch.cjs 1.4.56 1.4.55 "F:/WF client/globalize/textN/files.json"
node scripts/build_cn_patch.cjs 1.4.57 1.4.56 "F:/WF client/globalize/models1/files.json"
```

App-bundle text (labels baked into the APK, needs the APK rebuild in step 2):
`node scripts/gen_cn_bundle.cjs wfcn.apk global.apk <glossary.json> "F:/WF client/globalize/bundle2"`,
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

## 8. Day to day: the dashboard

Schedule events and summons in the dashboard as usual. CN-only ones are listed with "[CN only]".
Each change rebuilds the global event mod **and** a new CN update automatically
(`scripts/gen_cn_event_schedule.cjs`, which also refreshes the CN mission dates). Restart the CN
app to download it. The same save is shared by the global and CN apps.

## Things that are different on the CN app

- Co-op works from the CN app (StarPoint's COM partners); CN rooms use CN's message numbers.
- CN-only units' names stay Chinese (no new unit translations were made).
- Artwork with Chinese text (chapter titles, some badges, the loading notice) is still Chinese;
  1,285 global images have a different size and need their real file names to replace safely.
- Paid bead packs (Bundle Marketplace) are empty on purpose.
