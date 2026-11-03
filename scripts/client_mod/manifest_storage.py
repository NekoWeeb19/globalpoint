# Adds shared-storage access to the game's binary AndroidManifest.xml, for the storage drop-off patch
# (patch_cn_storage_dropoff.cjs):
#   - <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE"/> ("All files access",
#     Android 11+; the APK targets SDK 30, so READ/WRITE_EXTERNAL_STORAGE no longer reach other files there)
#   - READ_EXTERNAL_STORAGE / WRITE_EXTERNAL_STORAGE if missing (Android 6-10 runtime permissions). The
#     official manifest has both, plus a misspelled READ_EXTERNAL_STORGE that does nothing (left as is).
#   - android:requestLegacyExternalStorage="true" on <application> (Android 10 has no All files access;
#     this keeps the pre-10 file access there)
# Already-present entries are left alone, so it can run twice.
#
#   python -I manifest_storage.py <in.apk or AndroidManifest.xml> <out AndroidManifest.xml>
# then: python -I repack_apk.py <in.apk> <out-unsigned.apk> AndroidManifest.xml=<out AndroidManifest.xml> ...

import struct
import sys
import zipfile

RES_XML = 0x0003
STRING_POOL = 0x0001
RESOURCE_MAP = 0x0180
START_ELEMENT = 0x0102
END_ELEMENT = 0x0103

ANDROID_NS = "http://schemas.android.com/apk/res/android"
ATTR_NAME = 0x01010003
ATTR_LEGACY_STORAGE = 0x01010603  # android:requestLegacyExternalStorage
TYPE_STRING = 0x03
TYPE_BOOLEAN = 0x12
NO_INDEX = 0xFFFFFFFF

PERMISSIONS = [
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
    "android.permission.MANAGE_EXTERNAL_STORAGE",
]


class StringPool:
    def __init__(self, data: bytes):
        _, header_size, size, count, style_count, flags, strings_start, styles_start = struct.unpack_from("<HHIIIIII", data, 0)
        if style_count:
            raise ValueError("string pool with styles is not supported")
        self.utf8 = bool(flags & 0x100)
        self.flags = flags & ~0x1  # appended strings break the 'sorted' flag
        offsets = struct.unpack_from(f"<{count}I", data, header_size)
        self.strings = [self._read(data, strings_start + o) for o in offsets]

    def _read(self, data: bytes, p: int) -> str:
        if self.utf8:
            def length8(p):
                n = data[p]
                if n & 0x80:
                    return ((n & 0x7F) << 8) | data[p + 1], p + 2
                return n, p + 1
            _, p = length8(p)  # utf-16 length
            n, p = length8(p)  # byte length
            return data[p:p + n].decode("utf-8")
        n = struct.unpack_from("<H", data, p)[0]
        p += 2
        if n & 0x8000:
            n = ((n & 0x7FFF) << 16) | struct.unpack_from("<H", data, p)[0]
            p += 2
        return data[p:p + n * 2].decode("utf-16-le")

    def index(self, s: str) -> int:
        if s in self.strings:
            return self.strings.index(s)
        self.strings.append(s)
        return len(self.strings) - 1

    def build(self) -> bytes:
        body = bytearray()
        offsets = []
        for s in self.strings:
            offsets.append(len(body))
            if self.utf8:
                raw = s.encode("utf-8")
                for n in (len(s), len(raw)):
                    body += bytes([0x80 | (n >> 8), n & 0xFF]) if n > 0x7F else bytes([n])
                body += raw + b"\0"
            else:
                raw = s.encode("utf-16-le")
                n = len(raw) // 2
                body += struct.pack("<HH", 0x8000 | (n >> 16), n & 0xFFFF) if n > 0x7FFF else struct.pack("<H", n)
                body += raw + b"\0\0"
        while len(body) % 4:
            body += b"\0"
        header_size = 28
        strings_start = header_size + 4 * len(self.strings)
        size = strings_start + len(body)
        head = struct.pack("<HHIIIIII", STRING_POOL, header_size, size, len(self.strings), 0, self.flags, strings_start, 0)
        return head + struct.pack(f"<{len(offsets)}I", *offsets) + bytes(body)


def chunks(data: bytes, start: int):
    p = start
    while p < len(data):
        ctype, header_size, size = struct.unpack_from("<HHI", data, p)
        yield ctype, data[p:p + size]
        p += size


def patch(manifest: bytes) -> tuple[bytes, list[str]]:
    ctype, header_size, total = struct.unpack_from("<HHI", manifest, 0)
    if ctype != RES_XML:
        raise ValueError("not a binary XML file")
    parts = list(chunks(manifest, header_size))
    if parts[0][0] != STRING_POOL:
        raise ValueError("string pool not first")
    pool = StringPool(parts[0][1])
    resmap = []
    if parts[1][0] == RESOURCE_MAP:
        resmap = list(struct.unpack_from(f"<{(len(parts[1][1]) - 8) // 4}I", parts[1][1], 8))
    nodes = [bytearray(c) for t, c in parts[1:] if t != RESOURCE_MAP]
    S = pool.strings
    changes = []

    def res_name(res_id: int, name: str) -> int:
        # an attribute's resource id is found through the resource map (same index as its name string)
        for i, r in enumerate(resmap):
            if r == res_id and S[i] == name:
                return i
        i = pool.index(name)
        while len(resmap) <= i:
            resmap.append(0)  # 0 = no resource id, the same as having no entry
        resmap[i] = res_id
        return i

    def element(node: bytearray):
        t = struct.unpack_from("<H", node, 0)[0]
        if t not in (START_ELEMENT, END_ELEMENT):
            return t, None
        return t, S[struct.unpack_from("<I", node, 20)[0]]

    def attrs(node: bytearray):
        start, asize, count = struct.unpack_from("<HHH", node, 24)
        for k in range(count):
            p = 16 + start + k * asize
            ns, name, raw, vsize, _, vtype, vdata = struct.unpack_from("<IIIHBBI", node, p)
            yield p, ns, name, raw, vtype, vdata

    android = pool.index(ANDROID_NS)

    # permissions already declared
    have = set()
    last_permission_end = None
    for n, node in enumerate(nodes):
        t, name = element(node)
        if name == "uses-permission" and t == START_ELEMENT:
            for p, ns, a, raw, vtype, vdata in attrs(node):
                if (resmap[a] if a < len(resmap) else 0) == ATTR_NAME:
                    have.add(S[raw] if raw != NO_INDEX else S[vdata])
        if name == "uses-permission" and t == END_ELEMENT:
            last_permission_end = n
    if last_permission_end is None:
        raise ValueError("no uses-permission element to copy")

    name_attr = res_name(ATTR_NAME, "name")
    perm_name = pool.index("uses-permission")
    new_nodes = []
    for perm in PERMISSIONS:
        if perm in have:
            continue
        v = pool.index(perm)
        start = struct.pack("<HHIII", START_ELEMENT, 16, 36 + 20, 0, NO_INDEX)
        start += struct.pack("<IIHHHHHH", NO_INDEX, perm_name, 20, 20, 1, 0, 0, 0)
        start += struct.pack("<IIIHBBI", android, name_attr, v, 8, 0, TYPE_STRING, v)
        end = struct.pack("<HHIII", END_ELEMENT, 16, 24, 0, NO_INDEX) + struct.pack("<II", NO_INDEX, perm_name)
        new_nodes += [bytearray(start), bytearray(end)]
        changes.append(f"added uses-permission {perm}")
    nodes[last_permission_end + 1:last_permission_end + 1] = new_nodes

    # android:requestLegacyExternalStorage="true" on <application>
    for n, node in enumerate(nodes):
        t, name = element(node)
        if name != "application" or t != START_ELEMENT:
            continue
        ids = [(resmap[a] if a < len(resmap) else 0) for _, _, a, _, _, _ in attrs(node)]
        if ATTR_LEGACY_STORAGE in ids:
            break
        legacy = res_name(ATTR_LEGACY_STORAGE, "requestLegacyExternalStorage")
        start, asize, count, id_i, class_i, style_i = struct.unpack_from("<HHHHHH", node, 24)
        # attributes must stay sorted by resource id (Android walks them in order); plain names last
        at = next((k for k, r in enumerate(ids) if r == 0 or r > ATTR_LEGACY_STORAGE), count)
        attr = struct.pack("<IIIHBBI", android, legacy, NO_INDEX, 8, 0, TYPE_BOOLEAN, 0xFFFFFFFF)
        p = 16 + start + at * asize
        node[p:p] = attr
        fix = lambda i: i + 1 if i > at else i  # the 1-based id/class/style attribute indexes
        struct.pack_into("<HHH", node, 28, count + 1, fix(id_i), fix(class_i))
        struct.pack_into("<H", node, 34, fix(style_i))
        struct.pack_into("<I", node, 4, len(node))
        changes.append("added application android:requestLegacyExternalStorage=true")
        break

    out = bytearray()
    out += pool.build()
    if resmap:
        out += struct.pack("<HHI", RESOURCE_MAP, 8, 8 + 4 * len(resmap)) + struct.pack(f"<{len(resmap)}I", *resmap)
    for node in nodes:
        out += node
    return struct.pack("<HHI", RES_XML, 8, 8 + len(out)) + bytes(out), changes


def main() -> None:
    src, out = sys.argv[1:3]
    if src.lower().endswith(".apk"):
        with zipfile.ZipFile(src) as z:
            data = z.read("AndroidManifest.xml")
    else:
        with open(src, "rb") as f:
            data = f.read()
    result, changes = patch(data)
    with open(out, "wb") as f:
        f.write(result)
    print(f"wrote {out}: " + ("; ".join(changes) if changes else "nothing to change"))


if __name__ == "__main__":
    main()
