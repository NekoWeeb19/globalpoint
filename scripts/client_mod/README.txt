Game app patches
================

These scripts patch the World Flipper game apps themselves (Adobe AIR: the game's code is
assets/worldflipper_android_release.swf inside the APK). The patches work on the SWF's bytecode
directly (abc.cjs), so no decompile and recompile of the whole game is needed. Classes are found by
their member names, since the class names are obfuscated.

- The CN app (official CN 1.8.1, com.leiting.wf) is the one GlobalPoint ships: build 23 was the first
  public build, build 25 the current one. Its patches are below.
- The global app (0.0.81) has one older patch (the battle log), at the end. It's legacy.

How the whole CN app was connected and globalized, from nothing: docs/CN_CLIENT_SETUP.md.


Tools
-----

- Node.js 20+ and Python 3 (run the .py files with python -I)
- Java 17+ (Eclipse Adoptium works) for FFDec and the .java helpers
- FFDec (JPEXS Free Flash Decompiler, tested 26.3.0): its ffdec-cli.jar compiles the as3/ code that
  some patches add
- Android build-tools (zipalign, apksigner)
- adb, to install and test


The CN patch chain
------------------

Each step's output SWF is the next one's input. Build 25 is every step below, in this order:

  #  Script                          What it changes
  1  patch_cn_client.cjs             server address -> 127.0.0.1:8000/cn, skips the Leiting login SDK,
                                     and the version check goes to the server too
  2  patch_cn_text.cjs               English for the text built into the code
                                     (assets/translations/cn_app.json)
  3  patch_cn_font.cjs               global's Latin letters (Poppins) in CN's font, so English fits its
                                     boxes; needs global's SWF as well
  4  patch_cn_campaign_cache.cjs     Events screen: campaigns scanned once per second per kind instead
                                     of once per banner (as3/starpoint/CampaignCache.as)
  5  patch_cn_ability_text.cjs       Units screen: stops building ability text only a debug
                                     inspector reads (the screen froze ~1.5 s, now ~0.55 s)
  6  patch_cn_coop_speed.cjs         co-op and raid battles allow AUTO x1 -> x2 -> x3 (was x1 only)
  7  patch_cn_coop_lite.cjs          co-op always hides partners' skill effects; solo always shows all
  8  patch_cn_strip_pages.cjs        early banners' short summon-art strips centered like pictures
                                     (as3/starpoint/StripPages.template.as + strip_pages.json)
  9  patch_cn_storage_dropoff.cjs    game files from the OBB or a drop-off folder instead of a download
                                     (as3/starpoint/StorageDropoff.as)
 10  patch_cn_server_file.cjs        server.txt: play against a PC's server over Wi-Fi
                                     (as3/starpoint/ServerAddress.as)

Then the APK:
 11  manifest_storage.py             adds the storage permissions the drop-off needs
 12  repack_apk.py                   puts the SWF and manifest into the APK, drops the old signature
 13  zipalign + apksigner            align and sign

Usage of each (all from the repository root):

  node scripts/client_mod/patch_cn_client.cjs           <in.swf> <out.swf> 127.0.0.1:8000/cn
  node scripts/client_mod/patch_cn_text.cjs             <in.swf> <out.swf> [translations.json]
  node scripts/client_mod/patch_cn_font.cjs             <cn.swf> <global.swf> <out.swf>
  node scripts/client_mod/patch_cn_campaign_cache.cjs   <in.swf> <out.swf> <work dir> <ffdec-cli.jar>
  node scripts/client_mod/patch_cn_ability_text.cjs     <in.swf> <out.swf>
  node scripts/client_mod/patch_cn_coop_speed.cjs       <in.swf> <out.swf>
  node scripts/client_mod/patch_cn_coop_lite.cjs        <in.swf> <out.swf>
  node scripts/client_mod/patch_cn_strip_pages.cjs      <in.swf> <out.swf> <work dir> <ffdec-cli.jar>
  node scripts/client_mod/patch_cn_storage_dropoff.cjs  <in.swf> <out.swf> <work dir> <ffdec-cli.jar>
  node scripts/client_mod/patch_cn_server_file.cjs      <in.swf> <out.swf> <work dir> <ffdec-cli.jar>

  python -I scripts/client_mod/manifest_storage.py <base.apk> <work dir>/AndroidManifest.xml
  python -I scripts/client_mod/repack_apk.py <base.apk> unsigned.apk assets/worldflipper_android_release.swf=<final.swf> AndroidManifest.xml=<work dir>/AndroidManifest.xml
  zipalign -p -f 4 unsigned.apk aligned.apk
  java -jar apksigner.jar sign --ks <your.keystore> --ks-key-alias <alias> --out wfcn-globalized.apk aligned.apk

repack_apk.py takes any number of <path in APK>=<file> pairs: the English app bundle
(assets/bundle.zip and assets/bundle.zip.sha1, see docs/CN_CLIENT_SETUP.md step 6) goes in the same
way. Keep SWFs uncompressed (the scripts write them that way).

Keep your signing key. Android installs a new build over the old one only if it's signed with the
same key; a different key means uninstalling, which deletes the game's downloaded files.

After installing a new build over an older one, clear the game's cache once (Android Settings >
Apps > World Flipper > Storage > Clear cache; not Clear data). AIR keeps compiled code there and an
update doesn't replace it, so without this the old build's code keeps running. With root:
  adb shell "su -c 'rm -rf /data/data/com.leiting.wf/cache/app'"


Notes on the patches
--------------------

Co-op speed (6). The game runs the COM partners' battles on the same device and steps the battle
once per drawn frame (the TIME shown is real time). On a slow device the frame rate drops, so x3
gains less real speed than the number says. Co-op lite (7) helps: on an emulator, x2 co-op went
from ~19 to ~25 fps.

Strip pages (8). strip_pages.json comes from scripts/gen_cn_strip_pages.cjs; regenerate it if banner
art changes. The halftone band along those strips' top edge is removed in the game files instead
(scripts/gen_cn_strip_band.cjs with ClearRect.java), not in the app.

Storage drop-off (9). At the first loading step, before any downloaded file is read, the game looks
in three places for game files:
  /sdcard/StarPoint/game/               need "All files access" plus the storage permissions
  /sdcard/starpoint_game/               (Android 13+: "Music and audio" and "Photos and videos";
                                        6-10: Storage). StarPoint/game is the route the README gives
                                        players; starpoint_game (build 24+) is the same thing as a
                                        single top-level folder, easier to make in a file manager.
  /sdcard/Android/obb/com.leiting.wf/   needs no permission, but works only on some devices:
                                        whether the game can read a file there depends on the phone
                                        and the app that put it there. Once, on a Samsung Android
                                        16 tablet, My Files' move left the folder and file owned by
                                        My Files (dir 2771, file 770), and the game couldn't list or
                                        read them even with every permission on. It has worked on
                                        other occasions, and adb pushes work on the Android 9
                                        emulator.
- An OBB at the top of any of them (any *.obb made by scripts/build_cn_obb.cjs) is unpacked from
  its end backwards, and the file is cut shorter as it goes, so the phone needs little free space
  beyond the OBB itself. An interrupted unpack carries on at the next start. The emptied OBB is
  deleted at the end.
- A split OBB (build 25+; build_cn_obb.cjs --parts N): main.1008001.com.leiting.wf.part1of3.obb ...
  part3of3.obb, all in the same folder. The game reads the parts as one file, cuts the last part
  still there shorter as it goes and deletes each part once it's empty. Before the first unpack every
  part must be there and whole; if one is missing or short, the screen says which ("Game files part
  2 of 3 is missing: <name>") and stays there, nothing unpacked. Once an unpack has begun, a marker
  file in the game's storage (starpoint-obb-unpacking-<part 1's name>.txt) lets a resume carry on
  with the parts that are left, after checking that what was past their end is already unpacked.
- Loose files there (the companion's "Full game files" copy) are moved into the game's storage.
- The version record (info.json) is written last, and only if every file made it, so a half-done
  copy is never taken as finished. If storage fills up, the screen says how much is left and stays
  there; free space and reopen to carry on.
- No folder, no files or no permission: nothing happens and the normal download runs.
- The game never asks for storage permission itself. On Android 11+:
    adb shell appops set com.leiting.wf MANAGE_EXTERNAL_STORAGE allow
  or Settings > Apps > World Flipper > All files access, plus the storage permissions under
  Permissions. The companion app has a button for All files access.
- The game never creates any of these folders itself, so the player makes the one they use.
  Uninstalling the game deletes Android/obb/com.leiting.wf/, along with any OBB still in it.
- Build 24 = build 23 + /sdcard/starpoint_game/. Tested 2026-11-03 on the LDPlayer emulator
  (Android 9): installed over build 23 (cache cleared), a loose file and a small OBB in
  /sdcard/starpoint_game/ were both taken at the next start (the OBB unpacked and deleted, the
  emptied folders removed), and the game went on to the title screen.
- Build 25 = build 24 + split OBBs. Tested 2026-11-03 on the LDPlayer emulator (Android 9) with
  small test OBBs in 3 parts (build_cn_obb.cjs --test): parts 1 and 3 only -> "Game files part 2 of 3
  is missing: main.1008001.com.leiting.wf.part2of3.obb" and nothing unpacked; part 2 added, the game
  force-stopped right after part 3 was used up (part 2 cut from 41.95 MB to 32.51 MB) -> reopened, it
  carried on, deleted every part and reached the title screen; a fresh 3-part set next to a one-file
  OBB -> both unpacked and deleted. The test files (download/production/upload/zz/starpoint-obb-test-*,
  ~150 MB) stay in that emulator's game storage; the game never reads them.
  Live test the same day, the full set: the game's data cleared on that emulator, the three 3.57 GB
  parts of the 1.4.800 OBB (10.72 GB, 138354 files) copied into /sdcard/starpoint_game/ (195 s over
  adb), the game opened: part 3, then 2, then 1 shrank and were deleted, all unpacked in ~2 min, title
  ResVer 1.4.800, then sign-in and the home screen.
The OBB format is described at the top of scripts/build_cn_obb.cjs, and the storage layout and the
info.json record in STORAGE_LAYOUT.txt.

manifest_storage.py edits the binary manifest: it adds MANAGE_EXTERNAL_STORAGE (the APK targets
Android 11, API 30), READ/WRITE_EXTERNAL_STORAGE if missing, and requestLegacyExternalStorage=true
(Android 10).

Server address file (10). server.txt sits at the top of /sdcard/Android/obb/com.leiting.wf/ (no
permission needed), or else /sdcard/StarPoint/ (needs All files access). Whether the game can read a
server.txt in Android/obb depends on the device and file app, as for the OBB above.
- Its first line that isn't empty or a # comment is host:port, e.g. 192.168.1.20:8000. A BOM,
  spaces, CRLF, "http://" in front, a trailing "/" or "/cn" are all fine; no port means 8000. It's
  read once per start.
- It sets the API host and the version check. Game file downloads follow by themselves (the server
  builds those addresses from the one the game used), and co-op's battle address comes from the
  server (COOP_HOST).
- The title screen shows "Server: <host:port>". A file that's there but can't be read shows
  "server.txt not understood", and the built-in 127.0.0.1:8000 is used. No file: nothing shown.
- The drop-off leaves server.txt alone.

16 KB memory pages (some Android 15+/16 phones; check with adb shell getconf PAGE_SIZE). Three of the
game's own native libraries (libexecgame.so, libfakedyn.so and Leiting's protection loader
libexec(main).so) are built for 4 KB pages. On a 16 KB phone they run in Android's compatibility
mode or may fail to load. Realigning can't fix it, since the code itself is built for 4 KB. Not yet
tried on a 16 KB device.


Other tools here
----------------

  abc.cjs                read, patch and write the SWF's bytecode (round-trips the game byte for byte)
  stub_class.cjs         an empty class for FFDec's -importScript to compile real code into
  patch_swf.cjs          the global app's patch (below)
  cn_swf_strings.cjs     lists the Chinese text in the CN app's code, for patch_cn_text.cjs:
                         node scripts/client_mod/cn_swf_strings.cjs <in.swf> <out.json>
  RenderLabels.java      draws English text labels as PNGs, for text drawn into images
  ClearRect.java         makes one rectangle of a sprite sheet transparent (gen_cn_strip_band.cjs)
  capture_cn_storage.py  copies a finished download off a rooted device in the drop-off layout:
                         python -I scripts/client_mod/capture_cn_storage.py <out dir> --adb <adb> --serial <device>
  patch_cn_perf.cjs      TEST BUILDS ONLY. Times chosen game functions and sends
                         GET /cn/perf?d=name:calls:total:self,... to the server (logs/cn_requests.log).
                         Edit its TARGETS, or pass a JSON file of [class or "re:<regex>", methods]
                         pairs as a 5th argument. Each hooked call costs a few microseconds, so start
                         with broad hooks to find the slow area, then confirm with a handful.


The global app (legacy)
-----------------------

patch_swf.cjs patches the global 0.0.81 SWF:
- adds a battle log (as3/starpoint/BattleLog.as): buffs added and removed, instant abilities firing,
  dash gauge use and refill. It's sent to https://na.wdfp.kakaogames.com/starpoint/battle_log, which
  mitmproxy forwards to the server (src/routes/battleLog.ts), and written to logs/battle.log.
- turns off the root check and gxshield's "Detected cheating" force-quit.

  node scripts/client_mod/patch_swf.cjs <original.swf> patched.swf <work dir> <ffdec-cli.jar>
  python -I scripts/client_mod/repack_apk.py <global 0.0.81.apk> unsigned.apk assets/worldflipper_android_release.swf=patched.swf
  then zipalign + apksigner as above.
