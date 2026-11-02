StarPoint-patched game client (global 0.0.81 APK, Adobe AIR).

What the patch does (patch_swf.cjs):
  - adds the battle log (as3/starpoint/BattleLog.as): buffs added/removed, instant abilities firing,
    dash gauge use and refill. Sent to https://na.wdfp.kakaogames.com/starpoint/battle_log (mitmproxy
    sends it to StarPoint, src/routes/battleLog.ts), written to logs/battle.log.
  - turns off the root check and gxshield's "Detected cheating" force-quit.

Tools: FFDec 26.3.0 (F:\WF client\tools\ffdec) compiles BattleLog.as; Android build-tools r34
(F:\WF client\tools\build-tools\android-14) align and sign. Java (Eclipse Adoptium 25) and Python.

Build (from F:\WF client\mod):
  node F:/starpoint-main/scripts/client_mod/patch_swf.cjs ../global/worldflipper_android_release.swf patched.swf work ../tools/ffdec/ffdec-cli.jar
  python -I F:/starpoint-main/scripts/client_mod/repack_apk.py C:/Users/Jaheem/Downloads/world-flipper-0-0-81.apk patched.swf unsigned.apk
  ../tools/build-tools/android-14/zipalign.exe -p -f 4 unsigned.apk aligned.apk
  java -jar ../tools/build-tools/android-14/lib/apksigner.jar sign --ks starpoint-release.keystore --ks-key-alias starpoint --ks-pass file:starpoint-release.keystore.pass --out world-flipper-starpoint.apk aligned.apk

KEEP starpoint-release.keystore (+ .pass) in F:\WF client\mod: later builds must be signed with the same
key to install as an update. A different key means uninstalling again (new guest login).

Files:
  abc.cjs         read/patch/write the SWF's bytecode (round-trips the whole client byte for byte)
  stub_class.cjs  makes an empty class for FFDec's -importScript to compile real code into
  patch_swf.cjs   the patches; classes are found by member names (class names are obfuscated)
  repack_apk.py   puts the patched SWF in the APK and drops the old signature

CN client (official CN 1.8.1, F:\WF client\cn), SWF chain, each step's output is the next one's input:
  patch_cn_client.cjs (server address) -> patch_cn_text.cjs -> patch_cn_ability_text.cjs -> patch_cn_font.cjs
  -> patch_cn_campaign_cache.cjs (as3/starpoint/CampaignCache.as: the Events screen scanned every
     stamina/reward campaign row once per event banner; now once per second per kind)
Then repack_apk.py <previous build apk> <out-unsigned.apk> assets/worldflipper_android_release.swf=<swf>,
zipalign, apksigner with starpoint-release.keystore. Keep SWFs uncompressed (writeSwf(..., false)).
Build 13 (2026-11-01): F:\WF client\cn\build\wfcn-globalized-13.apk (127.0.0.1) and -phone-13 (LAN),
from p8-*-font.swf. After installing, clear the code cache:
  adb shell "su -c 'rm -rf /data/data/com.leiting.wf/cache/app'"

patch_cn_perf.cjs (TEST BUILDS ONLY, as3/starpoint/Perf.as): times chosen game functions and sends
GET /cn/perf?d=name:calls:total:self,... to the server (logs/cn_requests.log). Edit TARGETS to aim it.
A JSON file of [class or "re:<regex>", methods] pairs can be passed as a 5th argument instead.
Hooking many small functions inflates them a lot (a hooked call costs a few microseconds): find
the area with broad hooks, then confirm real times with a handful of hooks before patching.

patch_cn_ability_text.cjs (build 18, 2026-11-01): the Units screen froze ~1.5 s working out team stats,
half of it building full ability description text for BattleAbilitySource.abilityDescription, which
only a debug inspector reads. The 6 builds in BattleCharacterLogic.getAvailableAbilities(/WithCond)
and AbilitySummarizer.summaryAbilities now store "". Units freeze ~0.55 s after. Applied on top of
p9-*-cache.swf -> p11-*-text.swf; wfcn-globalized-18.apk / -phone-18.apk.

Build 19 (2026-11-01): p11-*-text.swf -> patch_cn_coop_speed.cjs -> p12-*-coop.swf ->
patch_cn_coop_lite.cjs -> p13-*-coop-lite.swf; wfcn-globalized-19.apk / -phone-19.apk.
patch_cn_coop_speed.cjs: co-op (MultiQuestStartLoadingTask) and raid (RaidBattleStartFlow) battles started
with their allowed auto speed hard-coded to 1; now 3, so AUTO cycles x1 -> x2 -> x3 -> off. Co-op runs the
partners' battles on this device too, and the battle advances one step per drawn frame (the TIME shown is
real time), so on a slow device the frame rate drops and real speed gains less than the number.
patch_cn_coop_lite.cjs: Battle.preparation now sets lightweightModeLevel = co-op ? 2 : 0 after the game's
own line (Lite Mode / "Abbreviate Multiplayer Notifications" options), so co-op always hides the partners'
skill animations, trails and multiballs, and solo always shows every effect. Emulator: x2 co-op ~19 fps
before, ~25 fps after (measured while screen recording).

Build 20 (2026-11-02): p13-*-coop-lite.swf -> patch_cn_strip_pages.cjs -> p14-*-strip.swf;
wfcn-globalized-20.apk / -phone-20.apk. The early banners' summon art is a short strip (~624 px) made for
an older screen layout; the game centers picture pages but puts animation pages at the top, leaving a
gap above the featured units. GachaFeaturePageHolderView.setContent now calls
as3/starpoint/StripPages.template.as (StripPages.place) after adding an animation page, which centers
the strip ones like pictures. strip_pages.json (scripts/gen_cn_strip_pages.cjs) lists them; regenerate
it if banner art changes. The halftone band along those strips' top edge (hidden by the old layout's top
bar) is removed in the game files instead: scripts/gen_cn_strip_band.cjs + ClearRect.java make its dot
tile transparent (CN patch 1.4.202, tagged "stripBand" in patches.json so reruns start from the originals).

Storage drop-off (TEST, 2026-11-02; sharing plan Phase 4): p14-local-strip.swf ->
patch_cn_storage_dropoff.cjs -> p15-local-storage.swf; manifest_storage.py; wfcn-test-storage-3.apk
(-1: first build; -2: overlay text fit; -3: files without info.json were not noticed, fixed).
Lets a phone with no root get the ~10 GB of game files from a folder instead of downloading them.
  patch_cn_storage_dropoff.cjs: AssetExtractor.start (first loading step, before any downloaded file
    is read) now asks as3/starpoint/StorageDropoff.as first. If /sdcard/Android/obb/com.leiting.wf/ or
    /sdcard/StarPoint/game/ holds files, they are moved into Local Store/asset/asset_download/dummy/
    with the same relative paths (rename, or copy + delete across volumes), the emptied drop-off
    folders removed (the two roots stay), then the game's own start runs. info.json (the version
    record) goes last and only if every file moved; an info.json older than the game's own is dropped;
    a moved one clears partial_downloaded*. Work runs in ~50 ms slices with a line on screen
    ("Moving game files: n / total" + "x / y GB. Keep the game open."), shown over the boot logo.
    Fresh install test (data cleared, full 10 GB / 138092-file set in the drop-off, LDPlayer):
    moved in ~2.5 min, then signup -> load -> get_path -> home with no download at all. No folder,
    no files or no permission: nothing happens and the normal download runs. Failures stay in the
    drop-off and are retried next start.
  manifest_storage.py <apk> <out AndroidManifest.xml>: binary manifest edit; adds
    MANAGE_EXTERNAL_STORAGE ("All files access", needed on Android 11+ since the APK targets 30),
    READ/WRITE_EXTERNAL_STORAGE if missing (the official manifest has both, plus a misspelled
    READ_EXTERNAL_STORGE that does nothing), and application requestLegacyExternalStorage=true
    (Android 10). Pass the result to repack_apk.py as AndroidManifest.xml=<file>.
  The player must allow storage once: Android 11+ Settings -> Apps -> World Flipper -> "All files
    access" (or the companion opens ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION); Android 6-10 the
    Storage permission in the app's permissions. The game never asks by itself. Emulator/adb:
    adb shell pm grant com.leiting.wf android.permission.READ_EXTERNAL_STORAGE (and WRITE_...);
    Android 11+: adb shell appops set com.leiting.wf MANAGE_EXTERNAL_STORAGE allow
  capture_cn_storage.py <out dir> --adb <adb.exe> --serial <dev>: copies a finished download off a
    rooted device (su + tar over adb exec-out, `stty raw` because LDPlayer's su turns \n into \r\n)
    in exactly the drop-off layout. Layout and the info.json record: STORAGE_LAYOUT.txt.
  Build (from F:\WF client\cn\build):
    node <repo>/scripts/client_mod/patch_cn_storage_dropoff.cjs p14-local-strip.swf p15-local-storage.swf work-storage ../../tools/ffdec/ffdec-cli.jar
    python -I <repo>/scripts/client_mod/manifest_storage.py wfcn-globalized-20.apk work-storage/AndroidManifest.xml
    python -I <repo>/scripts/client_mod/repack_apk.py wfcn-globalized-20.apk work-storage/unsigned.apk assets/worldflipper_android_release.swf=p15-local-storage.swf AndroidManifest.xml=work-storage/AndroidManifest.xml
    then zipalign + apksigner as above -> wfcn-test-storage-N.apk
