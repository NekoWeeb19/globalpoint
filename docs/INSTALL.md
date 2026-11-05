# Installing GlobalPoint

Every setup in full, with what to do when something goes wrong. The [README](../README.md) has the
short version; most people want setup C (phone only) and its quick steps there.

- [Which setup](#which-setup)
- [Downloads](#downloads)
- [A. On a PC (emulator)](#a-on-a-pc-emulator)
- [B. On a phone, copying from your PC over Wi-Fi](#b-on-a-phone-copying-from-your-pc-over-wi-fi)
- [C. On a phone, with the OBB file](#c-on-a-phone-with-the-obb-file)
- [D. On a phone, with the server on your PC](#d-on-a-phone-with-the-server-on-your-pc)

## Which setup

| | Where the server runs | Where the game runs | Needs |
|---|---|---|---|
| **A. PC** | your PC | an Android emulator on the same PC (e.g. LDPlayer) | Windows, Node.js 20+, ~16 GB free; the CN game files and `starpoint-data.zip` |
| **B. Phone, Wi-Fi** | on the phone (StarPoint Companion app) | the same phone | a PC running setup A on the same Wi-Fi, once; ~25 GB free on the phone |
| **C. Phone, OBB** | on the phone (StarPoint Companion app) | the same phone | the OBB file (from the Drive, or built on a PC with setup A) and `starpoint-data.zip`; ~15 GB free |
| **D. Phone + PC server** | your PC | a phone | setup A on the PC; the phone on the same Wi-Fi (or a USB cable with USB debugging) |

Setups A and D keep the server on your PC. Use them if you'd rather not keep everything on your
phone or don't want the companion app.

The game app is **build 25** of the patched CN app. By default it talks to `127.0.0.1:8000`: your
PC's server through the emulator in setup A, or the companion app on the phone itself in setups B
and C. A small `server.txt` file on the phone points it at your PC instead (setup D). That takes
the place of original StarPoint's mitmproxy route, which only worked for the global app.

## Downloads

| File | What it is | Where | Size |
|---|---|---|---|
| **World Flipper (game) APK** | the patched game app (build 25; installs over builds 23 and 24), for every setup | [Google Drive](https://drive.google.com/drive/folders/1EdY0GajMm-v6c219s02ZnuEz0u_0XdOO) | 139 MB |
| **StarPoint Companion APK** | the server-on-your-phone app (0.7.12), for setups B and C | [Google Drive](https://drive.google.com/drive/folders/1EdY0GajMm-v6c219s02ZnuEz0u_0XdOO) | 76 MB |
| **OBB in 3 parts** (`main.1008001.com.leiting.wf.part1of3.obb`, `part2of3`, `part3of3`) | every game file (game files 1.4.800, up to date), for setup C; download all three | [Google Drive](https://drive.google.com/drive/folders/1EdY0GajMm-v6c219s02ZnuEz0u_0XdOO) | 3.6 GB each |
| **OBB** (`main.1008001.com.leiting.wf.obb`), the alternative | the same as one 10 GB file (game files 1.4.203: older, the game updates after unpacking), for phones and file apps that handle one big file | [Google Drive](https://drive.google.com/drive/folders/1EdY0GajMm-v6c219s02ZnuEz0u_0XdOO) | 10.3 GB |
| **`starpoint-data.zip`** | GlobalPoint's English tables, game updates (art and text patches), schedule files, dashboard pictures and news. Setup A unzips it into the server folder; setup C imports it into the companion | [Google Drive](https://drive.google.com/drive/folders/1EdY0GajMm-v6c219s02ZnuEz0u_0XdOO) | 2.25 GB |
| **Comics zip** (optional) | the in-game comics, used the same way as `starpoint-data.zip` | [Google Drive](https://drive.google.com/drive/folders/1EdY0GajMm-v6c219s02ZnuEz0u_0XdOO) | 1.4 GB |
| **CN game files** (CN CDN 1.4.54) | the official CN game's files, for setup A: six parts `cn-cdn.tar.part.00` to `05`, plus `SHA256SUMS.txt` | [dennis96292/.cdn, release cdn-1.4.54](https://github.com/dennis96292/.cdn/releases/tag/cdn-1.4.54) | ~10.1 GB |
| **GlobalPoint** (this repository) | the server, the dashboard and the scripts | `git clone`, or **Code > Download ZIP** on GitHub | small |

Everything except the CN game files and the repository is on [Google Drive](https://drive.google.com/drive/folders/1EdY0GajMm-v6c219s02ZnuEz0u_0XdOO), and all of it except the
single-file OBB is also on [MEGA](https://mega.nz/folder/fWRATYbJ#z8wtDI7krmKgBn2HL_s0jg).

Setup C can also build its own OBB on a PC from setup A's files.

### Checksums

SHA-256 of the downloads, to check one (`certutil -hashfile <file> SHA256` on Windows,
`sha256sum <file>` elsewhere):

```
a57b1629b3564aa600cfaa9b1bbc88794a36eb1214b58f58238986dc0f0aebb7  main.1008001.com.leiting.wf.part1of3.obb
343438b6ee2debb1843609acbf386b2cf977d23a6ea018485e22e6d48a5fc453  main.1008001.com.leiting.wf.part2of3.obb
b3676a2042c945b26b7c0bfa1bd1127cb15e07984d7b2b47971c8b0d4aa9e412  main.1008001.com.leiting.wf.part3of3.obb
5494b5a79f6508068c133c6ebd971862b1f0aaef1e6d0b2955d85a76eca1f697  main.1008001.com.leiting.wf.obb (the single file)
8637a682ab1439e8c62040ebe9a4ce47b3b3ec28b4f1f65c4ba00f5332a6e393  starpoint-data.zip
7409b79cbe56c8c7ff05e48755904c7c35fb9677914925607a474f5a33424174  starpoint-comics.zip
198f2b4fb31568e2050ca5e1989d711ff63077494b21ff990562263c0ff0774e  World Flipper (game) APK, build 25
```

## A. On a PC (emulator)

1. Install [Node.js](https://nodejs.org) 20 or newer, and an Android emulator (tested: LDPlayer 9).
2. **Get GlobalPoint:** `git clone https://github.com/NekoWeeb19/globalpoint.git`, or download the
   repository's ZIP and unpack it. Put it on a drive with at least 16 GB free. The steps below call
   this folder `<folder>`.
3. **Get the CN game files.** Download the six `cn-cdn.tar.part.*` files and `SHA256SUMS.txt` from
   the [CN CDN 1.4.54 release](https://github.com/dennis96292/.cdn/releases/tag/cdn-1.4.54).
   - **Check them** (optional, recommended): in Command Prompt, run
     `certutil -hashfile cn-cdn.tar.part.00 SHA256` for each part and compare with `SHA256SUMS.txt`.
     With Git Bash, Linux or macOS: `sha256sum -c SHA256SUMS.txt`.
   - **Unpack them into `<folder>\.cdn`** (make the `.cdn` folder first if it isn't there). Windows
     10 and newer have `tar` built in. In Command Prompt (not PowerShell), in the download folder:
     ```bat
     copy /b cn-cdn.tar.part.00 + cn-cdn.tar.part.01 + cn-cdn.tar.part.02 + cn-cdn.tar.part.03 + cn-cdn.tar.part.04 + cn-cdn.tar.part.05 cn-cdn.tar
     ```
     ```bat
     tar -xf cn-cdn.tar -C <folder>\.cdn
     ```
     Joining the parts into one `cn-cdn.tar` needs about 10 GB more space for a while; delete
     `cn-cdn.tar` and the parts afterwards. With Git Bash, Linux or macOS you can skip the join:
     `cat cn-cdn.tar.part.* | tar -x -C <folder>/.cdn`.
   - You get `<folder>\.cdn\cn\...` (the `archive-*` folders and `entities`), which is where the
     server looks by default. No settings to change.
4. **Unzip `starpoint-data.zip` into `<folder>`** itself, so its `.cdn` and `.database` folders land
   on top of the ones already there. Do the same with the comics zip if you want comics.
5. **Put the game APK in `<folder>\apk\`** (make the `apk` folder), or install it on the emulator
   yourself.
6. Run **`setup.bat`**. It installs the server's packages (needs internet once), builds the server,
   makes your `.env` from `.env.example`, and checks the game files and updates; if something is
   missing it stops and says what. If it finds `adb`, it offers to install the APK from the `apk`
   folder on your emulator. Then it starts the server.
7. Open the game.
   - The first screen is the CN publisher's agreement, in Chinese. The **right** button (同意) agrees
     and continues; the left one (拒绝) closes the game.
   - The first start downloads ~12 GB of game files from your own server (about 6 minutes on an
     emulator). That only happens once.

After that, run **`start-cn.bat`** and open the game. Close the server window to stop it.

The short version of these steps is in [`HOW-TO-PLAY.txt`](../HOW-TO-PLAY.txt). Linux and macOS have `setup.sh` and
`start-cn.sh`, which are untested.

## B. On a phone, copying from your PC over Wi-Fi

You need setup A running on a PC on the same Wi-Fi, and ~25 GB free on the phone.

1. On the PC, set `LISTEN_HOST="0.0.0.0"` in `.env` so the phone can reach the server, and start it.
   If Windows asks about the firewall, allow it on **Private networks**.
2. Find the PC's address: the dashboard's **Play on a phone over Wi-Fi** shows it, or run `ipconfig`
   and use the **IPv4 Address** line (it starts with `192.168.` or `10.`).
3. Install both APKs on the phone: the **game** and **StarPoint Companion**. If Android blocks it,
   tap **Settings** and turn on **Allow from this source**. **Don't open the game yet.**
4. Open **StarPoint Companion**, tap **Game data**, and type your PC's address with the port, e.g.
   `192.168.1.20:8000` (use your own; that one is only an example).
5. Tick **Full game files**, **My save** (to bring your PC account), **Game updates**, **Event
   schedule editing** and **Dashboard pictures**. Comics are optional.
6. Tap **Download from PC**. When asked, turn on **All files access** for the companion and press
   back. The copy starts by itself and takes a while (~12 GB).
7. On the same screen, tap the button that opens **World Flipper's "All files access"** page and turn
   it on. The game never asks for it itself.
8. On the companion's main screen, check that it says **Server: running**, then tap **Let the server
   run in the background**. Allow notifications if asked. If your phone still stops the server in
   the background, tick **Keep the server awake**, and try **Battery and auto-start settings** and
   **Allow usage access** on the same screen.
9. Open the game. The first start moves the game files into place (a few minutes), then you're in,
   with no download.

If the phone says **"failed to connect"**, the address is wrong or the PC's firewall is blocking
Node.js (allow it on Private networks in Windows Security > Firewall > Allow an app). A phone that
already has the game (from the OBB) only needs the boxes other than **Full game files**.

From then on your save lives on the phone. Use **Export save** / **Import save** in the companion to
move it.

## C. On a phone, with the OBB file

The phone plays on its own: the game's files come from the **OBB** (every game file, ~10.3 GB), and
**StarPoint Companion** runs the server on the phone. StarPoint Companion can do most of the setup for you
(**Setup check**); the [steps by hand](#by-hand) still work the same way.

**Downloads** (from the [Google Drive folder](https://drive.google.com/drive/folders/1EdY0GajMm-v6c219s02ZnuEz0u_0XdOO)):
- the **game** APK (build 25) and the **StarPoint Companion** APK (0.7.12 or newer);
- the **OBB**: the 3 parts `part1of3` / `part2of3` / `part3of3` (~3.6 GB each, game files 1.4.800, up to
  date), or the single `.obb` (10.3 GB, game files 1.4.203: older, the game updates itself after
  unpacking). Either works; the 3 parts are newer and easier to download;
- **`starpoint-data.zip`** (the server's data), and the comics zip if you want comics.

Or build the OBB on a PC that has setup A, in `<folder>` (needs ~10.3 GB free; leave out `--parts 3` for
one file):
```bash
node scripts/build_cn_obb.cjs <output folder> --parts 3
```

### The easy way: Setup check

1. Put the downloads in the phone's **Download** folder (where the browser saves them anyway, or copy
   them there from a PC over USB). Don't unzip or rename anything.
2. Install both APKs. **Don't open the game yet.**
3. Open **StarPoint Companion**, tap **Game data** > **Import pack...** and pick `starpoint-data.zip`
   (then the comics zip the same way, if you have it). With setup A running on the same Wi-Fi, **Download
   from PC** (without **Full game files**) does the same.
4. Back on the main screen, tap **Setup check**. Each line is **green** (done), **yellow** or **red**
   (something left), with a button where the app can do it:
   - **Allow** "All files access" for StarPoint Companion, so it can find and move the OBB;
   - **Open World Flipper's settings**: turn on **All files access** and allow the storage permissions
     (on Android 13 and newer they're **Music and audio** and **Photos and videos**; older Android:
     **Storage**). Only you can flip these switches; the game never asks for them, and without them it
     can't see the OBB;
   - **Check and move it**: checks every OBB file is undamaged (a minute or two per few GB), then moves
     them into `starpoint_game` (made for you; instant, no extra space). If a file is damaged nothing is
     moved and it says which one to download again;
   - **Remove them**: leftover game files from an earlier setup, which would make the game's start very
     slow;
   - **Start** the server, if it isn't running.
5. When every line is green, the main screen's light is **green: Ready**. Open the game (if it was
   already open, close it fully first). It shows "Unpacking game files", unpacks the OBB by itself and
   deletes it when done.

The light on StarPoint Companion's main screen: **green** = open the game; **yellow** = wait (the server
is starting, or it's rebuilding the game update after a change on the dashboard; a game opened meanwhile
would get the old update); **red** = stopped. **Game data > Check a file** checks any download (an OBB part,
the data pack, the comics zip, the game APK) without changing anything.

### By hand

1. Install the game APK (build 25). **Don't open it yet.**
2. At the top of internal storage, create a folder named exactly **`starpoint_game`**
   (`Internal storage/starpoint_game/`; `Internal storage/StarPoint/game/` works the same way).
3. Put the OBB in it: all three parts together, directly in that folder (not in a subfolder), or the
   single file. From a PC copy them over USB; already on the phone, **Move** them with the file app (Move,
   not Copy: a copy needs twice the space). Don't let anything compress or zip them. To check a download,
   compare its SHA-256 with the [list above](#checksums).
4. Android Settings > Apps > World Flipper: turn on **All files access**, and under **Permissions** allow
   the storage permissions (as in step 4 above).
5. Install StarPoint Companion, import `starpoint-data.zip` (**Game data** > **Import pack...**), and
   start the server as in step 8 of setup B.
6. Open the game, as in step 5 above.

### If something goes wrong

The phone needs only a little free space beyond the OBB: the game shrinks the OBB as it unpacks, and if
it's interrupted it carries on where it stopped next time. Setup check shows most of these too.

- **A part missing or cut short:** the game says so, e.g. "Game files part 2 of 3 is missing" or
  "...is incomplete: x of y GB", and unpacks nothing. Copy the missing part next to the others (or
  download it again) and reopen the game.
- **The single-file OBB is older** (game files 1.4.203). After it unpacks, the game downloads the rest
  from the companion once (~2 GB, from the phone itself, so it's quick). The 3 parts and an OBB you build
  yourself are already up to date.
- **Stuck on "Finding game files… (a number)" after unpacking:** a drop-off folder still holds loose
  game files from an earlier setup, usually a `download` folder in `StarPoint/game`, `starpoint_game` or
  `Android/obb/com.leiting.wf` (e.g. from the companion's **Full game files**). The game lists and moves
  every one of them, which takes very long and isn't needed: the OBB already has every file. Close the
  game fully, then Setup check > **Remove them** (or delete that `download` folder by hand, leaving any
  `.obb` there, even a small leftover `part1of3`), and reopen the game.
- **If the game asks to download ~10 GB**, or the title screen shows **ResVer null**, instead of
  "Unpacking game files", it can't see the OBB. Tap Cancel. Check that the OBB is directly in
  `starpoint_game/` and that World Flipper has **All files access** and the storage permissions (Setup
  check shows both). Close the game fully and reopen it. Nothing is lost.
- **The file names don't matter** when placing them by hand, as long as they end in `.obb` and sit
  directly in the folder. One renamed to `.obb.zip` doesn't work. (Setup check looks for the names as
  downloaded: `main.1008001.com.leiting.wf.obb` and `main.1008001.com.leiting.wf.partNof3.obb`.)
- **`Android/obb/com.leiting.wf/` also works on some phones,** with no permissions needed (they don't
  apply there either way). What matters is which app wrote the file: some phones' file apps (Samsung's My
  Files, for one) leave it unreadable to the game. `starpoint_game` with the permissions above is the
  reliable route, and the one Setup check uses.
- **With a PC and adb**, `Android/obb` always works. If the folder doesn't exist yet:
  ```bash
  adb shell mkdir -p /sdcard/Android/obb/com.leiting.wf
  ```
  ```bash
  adb shell chmod 777 /sdcard/Android/obb/com.leiting.wf
  ```
  ```bash
  adb push main.1008001.com.leiting.wf.obb /sdcard/Android/obb/com.leiting.wf/
  ```
  (For the 3 parts, push each one the same way.)
  adb can't fix a folder a file app already made: rename or delete that folder first.
- **GrapheneOS:** give World Flipper **All files access**, not Storage Scopes. Scopes only shows an app
  the files it made plus ones you pick, and the game also has to shrink and delete the OBB.

## D. On a phone, with the server on your PC

The phone plays against your PC's StarPoint, so your save stays on the PC and the PC must be on
while you play. The game needs its files first: on a fresh install it downloads ~12 GB from your
PC, or use an OBB as in setup C, "By hand" steps 1-4.

**Over Wi-Fi (game build 23 or newer):**
1. On the PC, set `LISTEN_HOST="0.0.0.0"` in `.env` and start the server. Allow it if Windows asks
   about the firewall.
2. Open the dashboard on the PC (**http://127.0.0.1:8000**). Under **Play on a phone over Wi-Fi**,
   pick the PC's address (the one starting with 192.168 or 10) and tap **Download phone connection
   file**. You get `server.txt`.
3. Put `server.txt` on the phone in `Internal storage/Android/obb/com.leiting.wf/` (make the
   folder if needed). You can send it to yourself, or download the file straight on the phone by
   opening the dashboard there at `http://<PC address>:8000`.

   Whether the game can read a file there depends on the app that wrote it, as with the OBB in
   setup C. If the title screen doesn't show "Server: ...", that's the likely cause: put
   `server.txt` in `Internal storage/StarPoint/` instead and give World Flipper the permissions
   from setup C ("By hand", step 4), or push it with adb (`adb push server.txt
   /sdcard/Android/obb/com.leiting.wf/`, after the folder steps in setup C). The game doesn't read
   `server.txt` from `starpoint_game`.
4. Install the game and open it. The title screen shows **"Server: 192.168.x.y:8000"**. If it says
   "server.txt not understood", the file's address line is wrong.

`server.txt` is just one line, the PC's address and port, e.g. `192.168.1.20:8000`, so you can
also write it by hand. Lines starting with `#` are ignored. The game reads it each time it starts.
Delete it to go back to the phone's own server (the companion). If your router gives the PC a new
address, download the file again.

**Over USB (any game build):** turn on **USB debugging** in the phone's Developer options, connect
it to the PC, and run `start-cn.bat`. It forwards the phone's `127.0.0.1:8000` to the PC with
`adb reverse`. Android 11+ can do the same without a cable through **Wireless debugging**. The link
drops whenever adb loses the phone; run `start-cn.bat` again to restore it.
