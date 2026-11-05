# Custom units (CN app)

New units for the CN app, made from game data and files only (no game-code change). This page is for
players: getting a unit someone made into your game, giving it, and removing it. Making one, and the file
format, are in [MAKING_UNITS.md](MAKING_UNITS.md); how they were found to work is in
[research/new-units.md](research/new-units.md).

## Getting a custom unit onto your device (or emulator)

Setups A–D are the ones in the installation guide's [Which setup](INSTALL.md#which-setup).

**What you need:** a unit someone made (see [MAKING_UNITS.md](MAKING_UNITS.md)): a folder with
`custom_unit.json` (the unit file), `art_files.json` and the unit's pictures and voices. Custom units never
come inside the APKs, the data zip or the OBB: you add them yourself, on a PC.

### On a PC (setup A, and setup D)

In setup D the phone plays against your PC's server, so these steps are all it needs too.

1. **Stop the server.**
2. **Build the unit's art update** (once per unit). In the GlobalPoint folder:
   ```bash
   node scripts/build_cn_patch.cjs 1.4.900 <newest version> <unit folder>/art_files.json
   ```
   `<newest version>` is the last `"version"` in `.cdn/cn_patches/patches.json`. Pick a number for the new
   update well above it and above the game's own version (the **ResVer** on the title screen), e.g. 50
   higher. Phones build their own updates with the next numbers, so leave room. Write the number into the unit
   file's `"art": { "patch": … }` so messages can name it.
3. **Add the unit file:** copy `custom_unit.json` to `assets/custom_units/<id>.json` (e.g. `111907.json`).
4. **Start the server.** It sees the new unit and rebuilds the game update by itself. The log says:
   - `[custom units] 111907 Haruhi (GP Test)`: the server knows the unit;
   - `Custom units: 111907 Haruhi (GP Test) (1 of 1, rows in 19 tables)`: the game update has it.

   If it says `Custom unit 111907 skipped: … files aren't in the game files yet`, the art update from step 2
   is missing.
5. **Open the game.** It downloads a small update at the title screen. Then give or summon the unit (below).

### On a phone, copying from your PC (setup B)

1. Do the PC steps above first, and check the PC's log lines.
2. Start the PC's server so the phone can reach it (`LISTEN_HOST="0.0.0.0"`, as in setup B).
3. In **StarPoint Companion**, tap **Game data**, then **Download from PC**, and tick **Game updates**:
   it brings the unit's art update. The unit files always come along, whatever you tick. (Leave **My save**
   unticked unless you mean to replace the phone's save with the PC's.)
4. Back on the main screen the server starts, sees the new unit and rebuilds its own game update (a minute
   or two). Nothing else to do.
5. **Check it worked:** the companion's log shows `[custom units] 111907 Haruhi (GP Test)` and "rebuilding the
   CN schedule update". Open the game: it downloads a small update at the title screen. Then give the unit
   (below): it arrives in Mail and shows in your unit list.

If you forgot **Game updates**, the phone leaves the unit out for now. Copy again with it ticked: the phone
then rebuilds by itself.

### On a phone without a PC (setup C)

**Not supported.** The OBB and the data zip never carry custom units, and the companion can't add a unit
file on its own. You need a PC once, for setup B's copy. After that the unit stays on the phone (its file and
art survive companion updates and save imports).

### On an emulator

- **Setup A's emulator** plays against the PC's server: the PC steps are all it needs.
- **An emulator running StarPoint Companion** is the same as a phone: setup B.

### Giving and summoning it

- **Give:** in the dashboard, open **Players** > the player, and under **Give** choose **Character**. Type the unit's id
  (e.g. `111907`) and press **Send Mail**. In the game, open **Mail** and claim it.
  Only give it once the game has downloaded the update with the unit, or the game stops with C8601.
- **Summon:** list summon banner ids in the unit file's `"banners"` (e.g. `["1613"]`), then restart the server.
  The unit then drops from those banners as often as any other unit of its rarity. The banner's **Rates**
  screen won't list it. For a summonable unit the id's first digit must match its rarity (1 = 5★, 2 = 4★…).

### Removing a unit safely

A save that holds a unit the server or game no longer knows fails with **C8601**. So **first take the unit out
of every save that has it**, on the server that keeps that save (a phone's own save is on the phone: open the
dashboard from the companion app):

1. Close the game.
2. In the dashboard, open **Players** > the player, and under **Remove a unit** type the unit's id and press
   **Remove from save** (it asks to confirm). Download the save first if you want a copy.
   It removes the unit with its level, Mana Boards and amity. It also takes it out of your parties (a party it led gets the hero, or another
   unit, as leader: a party can't be without one), the home screen, Favorite Units, Rush and Score Attack records, the item log
   and unclaimed mail. Armaments and ability souls stay.
3. Do this for every player that has it.

Then delete `assets/custom_units/<id>.json` on the PC and restart the server. On a phone, copy from the PC
again: the phone deletes unit files the PC no longer has. The art update can stay.

(Keeping the unit is also fine: it does no harm.)

### Troubleshooting

- **"Insufficient data. Returning to the title screen"** (asset recovery), or **error 8100**: one of the unit's
  files is missing on the device. The server's request log (`logs/cn_requests.log`; on a phone it's in the
  companion's server folder, readable with adb) has a line `notify_asset_recovery 未找到素材 <file>`
  naming the file. Usually the art update isn't on the device: on a PC, check step 2; on a phone, copy again
  with **Game updates** ticked. If the art update is there, the unit's `art_files.json` lacks that file:
  remake the unit with it.
- **C8003** "…pixelart/special 的影像短片尚未加载" (an animation isn't loaded): an animation file of the unit
  still names the unit it was copied from. The unit maker renames these; remake the unit with it.
- **C8601** "指定的Key不存在" (a key that doesn't exist): the game is missing one of the unit's rows. Usually:
  - the game hasn't downloaded the update with the unit yet: restart it, and check the server log says
    `Custom units: <id>`;
  - the unit was removed while a save still holds it (see above);
  - the unit file is broken, e.g. its Mana Board node ids are wrong: the server leaves such a file out and
    logs `[custom units] skipped: …` with the reason.

  After a C8601 the game deletes its copy of that table; the next update puts it back. Fix the cause, then
  restart the server so it rebuilds.

## Changing an existing unit

Custom unit files are only for new units. To change a unit the game already has (its abilities, leader
skill, stats, skill gauge, name or class), use the dashboard's **Unit editor** ([UNIT_EDITOR.md](UNIT_EDITOR.md)):
it checks what the game can read, saves a change file and rebuilds the game update for you, on a PC or in the
companion. For other rows, or new pictures for a unit, see
[MAKING_UNITS.md](MAKING_UNITS.md#changing-an-existing-unit-by-hand).
