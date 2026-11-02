# Rebuilds the game APK with replaced or added files, keeping every other entry as it is (same
# compression), and drops the old signature files so the APK can be re-signed.
#
#   python -I repack_apk.py <original.apk> <out-unsigned.apk> <entry>=<file> [<entry>=<file> ...]
#
# An entry that exists is replaced in place; a new one is added at the end (stored uncompressed if it
# is a .swf, like the game's own SWF).

import sys
import zipfile


def is_signature(name: str) -> bool:
    if not name.startswith("META-INF/") or name.count("/") != 1:
        return False
    upper = name.upper()
    return upper == "META-INF/MANIFEST.MF" or upper.endswith((".SF", ".RSA", ".DSA", ".EC"))


def main() -> None:
    original, out = sys.argv[1:3]
    changes = {}
    for arg in sys.argv[3:]:
        entry, _, path = arg.partition("=")
        with open(path, "rb") as f:
            changes[entry] = f.read()
    with zipfile.ZipFile(original) as src, zipfile.ZipFile(out, "w") as dst:
        names = set()
        for info in src.infolist():
            if is_signature(info.filename):
                continue
            names.add(info.filename)
            data = changes.get(info.filename)
            if data is None:
                data = src.read(info.filename)
            new = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            new.compress_type = info.compress_type
            new.external_attr = info.external_attr
            dst.writestr(new, data)
        for entry, data in changes.items():
            if entry in names:
                continue
            new = zipfile.ZipInfo(entry, date_time=(2024, 1, 1, 0, 0, 0))
            new.compress_type = zipfile.ZIP_STORED if entry.endswith(".swf") else zipfile.ZIP_DEFLATED
            dst.writestr(new, data)
    print(f"wrote {out}: {', '.join(('replaced ' if e in names else 'added ') + e for e in changes)}")


if __name__ == "__main__":
    main()
