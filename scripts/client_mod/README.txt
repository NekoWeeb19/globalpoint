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
