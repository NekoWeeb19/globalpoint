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

Server address file (2026-11-02): p16 (drop-off, now skipping server.txt) -> patch_cn_server_file.cjs
-> p17-local-server.swf -> wfcn-globalized-23.apk (= build 22 + server.txt). Plays against a PC's
StarPoint over plain Wi-Fi, no adb.
  File: server.txt, top level of /sdcard/Android/obb/com.leiting.wf/ (read with no permission; Samsung
    My Files can write there on Android 12/16) or else /sdcard/StarPoint/ (needs All files access).
    The first line that isn't empty or a # comment: host:port, e.g. 192.168.1.20:8000. A BOM, spaces,
    CRLF, "http://" in front, a trailing "/" or "/cn" are fine; no port = 8000. Read once per start.
  Valid: the API host (DevConfig_gf_android "127.0.0.1:8000/cn") and the version check
    (GbitsVersionLogic "http://127.0.0.1:8000/cn/shijtswy/version/") use it; CDN and patch downloads
    follow by themselves (the server builds those addresses from the address the game used); co-op's
    battle address comes from the server's replies (COOP_HOST), nothing on the client pins it. The
    other 127.0.0.1/localhost strings in the SWF are unused dev settings (dummy socket, gamepad URL).
    The title screen shows "Server: <host:port>" above the version text; a file that is there but not
    understood shows "server.txt not understood" and the baked 127.0.0.1:8000 is used. Missing: as
    build 22, nothing shown. The OBB/loose-file drop-off leaves server.txt alone.
  Updating the APK: AIR keeps compiled code in /data/data/com.leiting.wf/cache/app and an update does
    not clear it, so after installing 23 over an older build clear the app's cache (Settings > Apps >
    World Flipper > Storage > Clear cache; adb: pm trim-caches 999G, or su rm -rf .../cache/app).
    Otherwise the old build's code runs (seen on the emulator: build 21's drop-off moved server.txt).
  Tested 2026-11-02 on LDPlayer emulator-5556 (Android 9): (1) no file: no title line, logs in to
    127.0.0.1:8000 as before; (2) server.txt (BOM, CRLF, comment, http://.../) -> title "Server:
    192.168.12.109:8010", signup/login/missions/login bonus on a separate test server on the PC's LAN
    address (no adb reverse), the tutorial quest played; that server's get_path answer lists patch
    URLs on 192.168.12.109:8010 and they download; (3) a junk file -> title "server.txt not understood", logs in to 127.0.0.1:8000 as before.
  Build:
    node <repo>/scripts/client_mod/patch_cn_storage_dropoff.cjs p14-local-strip.swf work-srv/p16b.swf work-srv ../../tools/ffdec/ffdec-cli.jar
    node <repo>/scripts/client_mod/patch_cn_server_file.cjs work-srv/p16b.swf p17-local-server.swf work-srv ../../tools/ffdec/ffdec-cli.jar
    then manifest_storage.py, repack_apk.py, zipalign + apksigner as for build 22 -> wfcn-globalized-23.apk

OBB drop-off (2026-11-02): p14-local-strip.swf -> patch_cn_storage_dropoff.cjs -> p16-local-obb.swf ->
wfcn-globalized-22.apk (= build 21 + OBB). The whole game-files set as ONE file, for players who copy
it over USB instead of ~138k loose files.
  The file: scripts/build_cn_obb.cjs writes main.<versionCode>.com.leiting.wf.obb (versionCode 1008001)
    straight from a StarPoint server's files, no device or root needed:
      node scripts/build_cn_obb.cjs "D:/WF client/obb" --server F:/starpoint-main
    = the CN base zips (no iOS) oldest first, then the StarPoint patches in patches.json order, newest
    copy wins, plus info.json (version = newest patch, baseUrl http://127.0.0.1:8000/cn/cdn/, fulfill).
    1.4.203: 138092 files (+ info.json), 10.29 GB file (9.54 GB of game files), built in ~2 min on D:.
    File list and sizes checked equal to a device that downloaded everything.
  Format: a plain zip, files STORED (they are already compressed), zip64 (offsets past 4 GB, >65535
    entries); any zip tool can list or unpack it. Its FIRST entry starpoint-obb-index.txt lists every
    entry ("STARPOINT-OBB 1 <n>", then "<header offset> <data offset> <size> <path>", 12-digit fixed
    width), so the game reads everything from the start of the file and never needs the central
    directory at the end. Why: AS3 FileStream reads at any Number position, but a 17 MB central
    directory at the end would be gone once the game starts cutting the file (below).
  Where: /sdcard/Android/obb/com.leiting.wf/ (the game's own OBB folder: readable and writable with NO
    permission on every Android version, including 11+ with targetSdk 30) or /sdcard/StarPoint/game/
    (needs the storage permission, as the loose files do). Any *.obb there; a .obb that is not ours
    is left alone. Loose files there are still taken as before (after the OBB).
  The game (StorageDropoff.as): unpacks from the END of the file backwards and cuts the file shorter
    (FileStream.truncate) after every ~50 ms slice, so the space it frees takes the unpacked files:
    beyond the OBB itself only a little free space is needed (not a second 10 GB). Interrupted: next start reads the index again, everything
    past the file's current end is already unpacked, it carries on. info.json is the 2nd entry, so it
    comes last, and is written only if nothing failed (an older one is dropped, as for loose files);
    then the emptied OBB is deleted. Storage full: the screen says how much is left and how much is
    free, and stays there (going on would start the 10 GB download); free space and reopen to carry on.
    Text: "Unpacking game files: n / total" + "x / y GB. Keep the game open."
  Tested 2026-11-02 on LDPlayer (Android 9, emulator-5556) as a first-timer: game uninstalled, OBB put
    in /sdcard/Android/obb/com.leiting.wf/, build 22 installed with NO storage permission granted,
    opened: "Unpacking game files", the OBB shrank from the end (~140 MB/s), a force-stop halfway
    then reopen carried on with the rest (113691 files / 5.7 GB left), done and the OBB deleted ~2.5
    min after launch; title ResVer 1.4.203; tutorial skip -> nickname -> main menu, no download.
    Streaming onto the device: node scripts/build_cn_obb.cjs - | adb exec-in "cat > <obb>.part" (then
    mv) avoids a 10 GB copy on the PC, but adb exec-in dropped the last ~1 MB once (part of the zip's
    central directory, which the game never reads; the data entries were intact). Compare the size on
    the device with the "file N bytes" line. Emulator note: LDPlayer's disk images (D:\LDPlayer\
    LDPlayer9\vms\leidianN\*.vmdk) grow by what is pushed in and don't shrink, so a 10 GB push needs
    10+ GB free on D: (a push once filled D: and crashed the emulator).
  Android 11+ (targetSdk 30; the emulator is Android 9 and can't show these rules):
    - Reading/writing/deleting: an app reaches its OWN Android/obb/<package> folder by plain file path
      without any permission (scoped storage exempts app-specific folders; since 11 they are bind-
      mounted straight from the lower filesystem, so truncate and delete work like on any folder).
      Unchanged in 12-16 as far as the platform docs go. AIR's File/FileStream use plain paths.
    - The game never creates the folder itself (AIR doesn't call getObbDir), so the player's copy
      creates it. On 11+ a folder made over USB (MTP, runs as MediaProvider) is fixed up to the app's
      ownership by MediaProvider; if the game can't open the OBB anyway, the fallback is
      /sdcard/StarPoint/game/ with All files access.
    - MTP: PCs still see Android/obb on 11-16 (only on-phone file managers lost access to it in 11+;
      some OEM file managers can't open it). Copy main.1008001.com.leiting.wf.obb into
      Android/obb/com.leiting.wf/ (create the folder if missing). A 10 GB file over MTP takes a while;
      Windows may say "the file is too large" only on FAT32 cards, not on internal storage.
    - Uninstalling the game deletes Android/obb/com.leiting.wf/ with it, so copy the OBB after
      installing (or reinstall as an update) if the OBB is still unpacked.
    Only the real phones can confirm: the game sees and opens the OBB with NO permission granted (12
    and 16), the file shrinks while unpacking and is gone at the end, MTP copy into Android/obb on each
    phone's maker's build, the speed on real flash, and the storage-full screen.
  16 KB pages (Android 15+/16 devices that use them; most phones still use 4 KB: adb shell getconf
    PAGE_SIZE): the arm64 libs are stored compressed (extracted at install, so zip alignment does not
    matter). 12 of them, including libCore.so (the AIR runtime), have 64 KB-aligned segments (fine).
    3 have 4 KB segments: libexecgame.so, libfakedyn.so, assets/ijm_lib/arm64-v8a/libexec(main).so
    (Leiting's protection loader). On a 16 KB phone those run in Android's page-size compatibility
    mode (a one-time warning may show), or may fail to load; only a 16 KB device can tell. Not
    fixable by realigning: the segments themselves are built for 4 KB.
  Build:
    node <repo>/scripts/client_mod/patch_cn_storage_dropoff.cjs p14-local-strip.swf p16-local-obb.swf work-obb ../../tools/ffdec/ffdec-cli.jar
    then manifest_storage.py, repack_apk.py, zipalign + apksigner as for storage-3 -> wfcn-globalized-22.apk
