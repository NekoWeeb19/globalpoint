# Playing in Chinese (简体中文)

GlobalPoint runs CN's World Flipper app (世界弹射物语) with English added on top. The game can also run in
CN's own Simplified Chinese, with everything else GlobalPoint adds kept: event and summon scheduling, summon
rates, the unit and armament editor, fixes, the companion app.

## Turning it on

1. Dashboard, **Game settings**, **Game language**: pick **简体中文**.
2. Wait for the ready light (the game update rebuilds, about half a minute on a PC).
3. Close and reopen the game. It downloads the change (about 24 MB).
4. Optional, for the labels built into the game app: install the **Chinese game app** over the English one
   (same signature, so the game's files and save stay), then clear the game's cache once (Android Settings >
   Apps > 世界弹射物语 > Storage > **Clear cache**, not Clear data).
5. Optional, for the pictures with words on them (home buttons, bottom bar, banners): a PC server with CN's full
   game files does this by itself. On a phone, import the **Chinese art pack** (`starpoint-chinese-art-pack.zip`,
   about 1.5 GB) with the companion's **Game data > Import pack...**, after the data pack, then stop and start the
   server and reopen the game. The game then takes in about 1.6 GB.

Back to English: pick **English** the same way (and reinstall the English game app if you changed it).

## What turns Chinese

| Part | In Chinese | How |
|---|---|---|
| Game text from its tables: menus, units, skills, abilities, stories, shops, missions, events, items | Yes | the game update: CN's own cells put back (scripts/cn_language.cjs) |
| The server's mail: Bread/Mana/EXP x1500, mails with the default title, CN's gift mails | Yes | src/nya/mail.ts, src/nya/mailSchedule.ts, assets/cn_gift_mails.json (titleZh) |
| Automatic news posts (Coming soon / Now on / Ended) | Yes, with CN's event names | src/nya/autoNews.ts, assets/event_names_zh.json |
| Labels built into the app (Lv, stamina, battle and result screens, title screen, download dialogs) | With the Chinese game app | CN's own app bundle, no English text patch |
| GlobalPoint's own game messages (OBB unpacking, server.txt) | With the Chinese game app | scripts/client_mod/as3_zh.json |
| Pictures with words on them (home buttons, bottom bar, banners, labels drawn into sheets) | With CN's full files (PC) or the Chinese art pack (phone) | assets/cn_lang_art.json, see below |
| Text you type on the dashboard (mail titles, news posts) | As typed | |
| Unit editor and armament editor text (names, titles, descriptions, skills), custom units | As typed, in either language; the cells you didn't edit turn Chinese | the builder puts the edits back after the Chinese step |
| Cells CN left in Japanese (the Black Clover collab's story, items, shop names, missions...) | Yes, from the Chinese community's translations | assets/cn_zh_fixes.json, see below |

## How the game update does it

When the setting is Chinese, the CN update builder (scripts/gen_cn_event_schedule.cjs) runs one more step on
every table it ships: a cell that CN's own copy has in Chinese and that GlobalPoint changed goes back to CN's
cell. Dates, rows GlobalPoint added, rates and every other change stay. Rows are matched by their keys.

Switching language (or a game coming from another server) ships every table GlobalPoint's translation touched
(about 1,800, from CN_TRANSLATED_DIR files.json), from its newest English copy in StarPoint's updates. Updates
built in Chinese are listed in `<CDN_DIR>/cn_patches/languages.json`, so a switch back to English never takes
a Chinese copy. The setting is `.database/game_language.json` and is part of the rebuild fingerprint.

## The Chinese community's fixes

Thanks to **晓之车**, who keeps an untranslated CN project and shared their CN tables (2026-11-22). Where CN's own
release left text in Japanese, or worded something they improved, their Chinese is used in Chinese mode
(`assets/cn_zh_fixes.json`, built by `node --env-file=.env scripts/gen_cn_zh_fixes.cjs <their intermediate.zip>`):

- 1,479 cells CN left in Japanese, written in Chinese: the Black Clover collab's story, item names and descriptions,
  boss-coin shop items, skill preview quests, login bonus names, unit text and speech placeholders, missions,
  titles, boss skill names, notifications and dialogs.
- 273 of their rewordings of CN's Chinese: the Lv labels (技能Lv, 觉醒Lv, 强化Lv), voice actors' names in Chinese
  characters (德井青空, 岛崎信长), clearer pack and campaign names, a banner name typo (书本装备特选扭蛋).
- One rule from their edits: 生命值 becomes HP in game text (skills, abilities, UI, titles, missions); unit profile
  text keeps 生命值, as theirs does.

Only edits on the same row as CN's are taken: every cell that isn't text (ids, numbers, paths) must match, dates
aside. Their tables also hold their own rows and rows that moved to other ids (689 edits); those are left out. A
fixed cell changes only while CN's own copy still has the text the fix was made from. Edits made in the Unit editor
still win over these.

## The Chinese game app

Built like the English app (scripts/client_mod/README.txt) but without step 2 (patch_cn_text.cjs) and with CN's
own `bundle.zip`, and `--zh` on patch_cn_storage_dropoff.cjs and patch_cn_server_file.cjs. Steps 1, 4-10 as
usual; the font patch (3) isn't needed. Sign it with the same key as the English app.

## Pictures

GlobalPoint's updates replace 6,318 of CN's pictures and sprite layouts with English ones (global's art in 1.4.56
and 1.4.57, English labels drawn into CN's sheets, and the layouts that had to follow them). The list is
`assets/cn_lang_art.json` (`node --env-file=.env scripts/gen_cn_lang_art.cjs`, on a PC with CN's archives). Left out
are fixes for CN's own broken art, which stay in both languages: the art fixes every update carries
(assets/cn_art_fixes.json), the summon strips without their halftone band, Razelt's Launch Gala animation. A sheet
and its layout always go back together, so CN's own matching pair is used.

On a language switch the builder ships the set as its own update before the tables: CN's originals in Chinese, the
newest English copies back in English. CN's originals come from the PC's CN archives, or on a phone from the Chinese
art pack, which puts them in the slim folder's `tables/` (`node scripts/build_pack.cjs zh-art <out.zip>`; it uses
the skill preview art pack's marker, so any companion can import it). Without them the pictures stay English and
the text still turns Chinese; once the pack is there, the next server start ships them (the rebuild fingerprint
counts it).

Each set (about 1.6 GB) is zipped once into `<CDN_DIR>/cn_patches/lang-art/<language>-<hash>/`, and every later
switch's update entry points at the same archives, so switching back and forth doesn't fill the disk. A new
English art update makes a new English set (the hash is of the contents). Tested on the emulator 2026-11-25 both
ways: the home screen's buttons, bottom bar and banners in Chinese, then English again.
