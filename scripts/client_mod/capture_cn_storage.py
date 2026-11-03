# Copies the CN game's downloaded files off a rooted Android device (or emulator) into a folder laid out
# exactly as the storage drop-off patch expects (patch_cn_storage_dropoff.cjs): copy the folder's
# contents to /sdcard/StarPoint/game/ on a phone and the patched game moves them in on its next start.
# Layout and what each file is: STORAGE_LAYOUT.txt beside this script.
#
#   python -I capture_cn_storage.py <out dir> [--adb <adb.exe>] [--serial <device>]
#
# Reads Local Store/asset/asset_download/dummy/ (info.json + download/) through `su` and tar, streams it
# over adb, checks the download is finished (info.json there, no partial_downloaded* file) and writes
# <out dir>/CAPTURE.txt (version, file count, size). Nothing on the device is changed.

import argparse
import json
import os
import subprocess
import sys
import tarfile

PACKAGE = "com.leiting.wf"
# "Local\ Store": the command line passes through Windows quoting, adb and two device shells
DUMMY = rf"/data/data/{PACKAGE}/{PACKAGE}/Local\ Store/asset/asset_download/dummy"
# su on some devices (LDPlayer) runs under a terminal that turns \n into \r\n; raw mode keeps bytes exact
RAW = "stty raw -echo 2>/dev/null; "


def adb(args, cmd: str) -> bytes:
    """Runs `cmd` as root on the device, returns its output."""
    full = [args.adb] + (["-s", args.serial] if args.serial else []) + ["exec-out", f"su -c '{RAW}{cmd}'"]
    return subprocess.run(full, capture_output=True, check=True).stdout


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--adb", default="adb")
    ap.add_argument("--serial")
    ap.add_argument("--paths", nargs="+", default=["info.json", "download"], help="what to copy (default: everything)")
    args = ap.parse_args()

    listing = adb(args, f"ls -a {DUMMY}").decode("utf-8", "replace").split()
    if "info.json" not in listing:
        sys.exit(f"no info.json in {DUMMY}: the game has not finished a download")
    partial = [n for n in listing if n.startswith("partial_downloaded")]
    if partial:
        sys.exit(f"download not finished ({', '.join(partial)} present): let the game finish it first")
    info = json.loads(adb(args, f"cat {DUMMY}/info.json"))

    os.makedirs(args.out, exist_ok=True)
    if os.listdir(args.out):
        sys.exit(f"{args.out} is not empty")
    # stream info.json + download/ as a tar (temp/ and anything else the game keeps there is left out)
    full = [args.adb] + (["-s", args.serial] if args.serial else []) + \
        ["exec-out", f"su -c '{RAW}cd {DUMMY} && tar -cf - {' '.join(args.paths)}'"]
    proc = subprocess.Popen(full, stdout=subprocess.PIPE)
    count = size = 0
    with tarfile.open(fileobj=proc.stdout, mode="r|") as tar:
        for member in tar:
            if not (member.isfile() or member.isdir()):
                continue
            name = member.name.removeprefix("./")
            if not name or ".." in name.split("/"):
                continue
            dest = os.path.join(args.out, *name.split("/"))
            if member.isdir():
                os.makedirs(dest, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with tar.extractfile(member) as src, open(dest, "wb") as dst:
                while chunk := src.read(1 << 20):
                    dst.write(chunk)
            count += 1
            size += member.size
            if count % 5000 == 0:
                print(f"{count} files, {size / 2**30:.2f} GB", flush=True)
    proc.stdout.close()
    if proc.wait() != 0:
        sys.exit(f"adb/tar failed ({proc.returncode})")
    with open(os.path.join(args.out, "CAPTURE.txt"), "w", encoding="utf-8") as f:
        f.write(f"version {info.get('version')}\nfiles {count}\nbytes {size}\n"
                f"assetSizeKind {info.get('assetSizeKind')}\nbaseUrl {info.get('baseUrl')}\n")
    print(f"captured {count} files ({size / 2**30:.2f} GB), game files version {info.get('version')} -> {args.out}")


if __name__ == "__main__":
    main()
