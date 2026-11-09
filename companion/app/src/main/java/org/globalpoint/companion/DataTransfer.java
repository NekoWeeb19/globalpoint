package org.globalpoint.companion;

import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.os.StatFs;
import android.util.JsonReader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Brings the server's data into files/data: from a zip (any zip whose entries are .database/...,
 * .cdn/... or .env, also inside one top folder), or from a PC running StarPoint over Wi-Fi
 * (GET /companion/manifest and /companion/file, src/routes/companion.ts). The server must be
 * stopped while the save (.database) is replaced. From a PC it can also copy the game's full set of
 * files into the game's drop-off folder (/sdcard/StarPoint/game/, needs "All files access").
 */
final class DataTransfer {
    interface Progress { void update(String message, long done, long total); }

    static final class Options {
        boolean save, patches, images, comics, schedule, game;
        /** Filled by downloadFromPc: what the PC said it couldn't provide. */
        String notes = "";
    }

    private DataTransfer() {}

    /** Where a data path may go, or null if it's outside the allowed folders. */
    private static File target(File data, String name) throws IOException {
        name = name.replace('\\', '/');
        while (name.startsWith("./")) name = name.substring(2);
        boolean ok = name.startsWith(".database/") || name.startsWith(".cdn/") || name.equals(".env");
        if (!ok) return null;
        File out = new File(data, name);
        String root = data.getCanonicalPath() + File.separator;
        if (!out.getCanonicalPath().startsWith(root)) return null;
        return out;
    }

    // a new database file must not meet the old one's write-ahead log
    private static void beforeWrite(File out) {
        if (out.getName().equals("wdfp_data.db")) {
            new File(out.getPath() + "-wal").delete();
            new File(out.getPath() + "-shm").delete();
        }
    }

    private static void copy(InputStream in, File out, long size, long[] done, long total, Progress p, String label) throws IOException {
        out.getParentFile().mkdirs();
        File part = new File(out.getPath() + ".part");
        byte[] buffer = new byte[256 * 1024];
        long last = 0;
        try (OutputStream os = new FileOutputStream(part)) {
            int n;
            while ((n = in.read(buffer)) > 0) {
                os.write(buffer, 0, n);
                done[0] += n;
                long now = System.currentTimeMillis();
                if (now - last > 250) { p.update(label, done[0], total); last = now; }
            }
        }
        if (size >= 0 && part.length() != size) {
            part.delete();
            throw new IOException(label + ": got " + part.length() + " of " + size + " bytes");
        }
        beforeWrite(out);
        out.delete();
        if (!part.renameTo(out)) throw new IOException("can't write " + out);
    }

    /** Unpacks a data zip into files/data. Returns the number of files written. */
    static int importZip(Context c, Uri uri, Progress p) throws IOException {
        File data = ServerFiles.dataDir(c);
        data.mkdirs();
        long total = -1;
        try (android.content.res.AssetFileDescriptor fd = c.getContentResolver().openAssetFileDescriptor(uri, "r")) {
            if (fd != null) total = fd.getLength();
        } catch (Exception ignored) { }
        int count = 0;
        long[] done = {0};
        String prefix = null;
        try (InputStream raw = c.getContentResolver().openInputStream(uri);
             CountingStream counted = new CountingStream(new BufferedInputStream(raw, 1 << 20));
             ZipInputStream zip = new ZipInputStream(counted)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String name = entry.getName().replace('\\', '/');
                // also accept zips with everything inside one top folder (e.g. phone-data/.database/...)
                if (prefix == null && !name.startsWith(".")) {
                    int slash = name.indexOf('/');
                    if (slash > 0 && name.substring(slash + 1).startsWith(".")) prefix = name.substring(0, slash + 1);
                }
                if (prefix != null && name.startsWith(prefix)) name = name.substring(prefix.length());
                File out = target(data, name);
                if (out == null) continue;
                long[] ignore = {0};
                copy(zip, out, -1, ignore, total, (m, d, t) -> p.update(m, counted.count, t), name);
                count++;
                p.update(name, counted.count, total);
            }
        }
        if (count == 0) throw new IOException("no .database/, .cdn/ or .env files in this zip");
        return count;
    }

    /** The game's drop-off folder: game build 21+ moves what's in it into its own storage at its next start. */
    static File gameDropOff() { return new File(Environment.getExternalStorageDirectory(), "StarPoint/game"); }

    /** Where a manifest path goes: the data folder, or the game's drop-off folder for game/... */
    /** Whether a file is in its folder, from one listing per folder (kept in listings). */
    private static boolean listed(Map<String, java.util.Set<String>> listings, File file) {
        File dir = file.getParentFile();
        if (dir == null) return file.exists();
        String key = dir.getPath();
        java.util.Set<String> names = listings.get(key);
        if (names == null) {
            String[] list = dir.list();
            names = list == null ? java.util.Collections.emptySet() : new java.util.HashSet<>(java.util.Arrays.asList(list));
            listings.put(key, names);
        }
        return names.contains(file.getName());
    }

    private static File place(File data, String name) throws IOException {
        if (!name.startsWith("game/")) return target(data, name);
        File root = gameDropOff();
        File out = new File(root, name.substring("game/".length()));
        if (!out.getCanonicalPath().startsWith(root.getCanonicalPath() + File.separator)) return null;
        return out;
    }

    private static final class Item {
        final String path; final long size; final File out;
        Item(String path, long size, File out) { this.path = path; this.size = size; this.out = out; }
    }

    /** First entry of a comics pack (scripts/build_comics_pack.cjs). */
    static final String COMICS_MARKER = "starpoint-comics-pack.json";

    /** First entry of a data pack (scripts/build_pack.cjs data). */
    static final String DATA_MARKER = "starpoint-data-pack.json";

    /** What a pack import did. */
    static final class PackResult { int written, skipped, removed; long packBytes; String version = ""; }

    /** "comics", "data", or null when the file isn't a pack: read from its first entry. */
    static String packKind(Context c, Uri uri) {
        try (InputStream raw = c.getContentResolver().openInputStream(uri);
             ZipInputStream zip = new ZipInputStream(new BufferedInputStream(raw, 1 << 16))) {
            ZipEntry first = zip.getNextEntry();
            if (first == null) return null;
            if (COMICS_MARKER.equals(first.getName())) return "comics";
            if (DATA_MARKER.equals(first.getName())) return "data";
        } catch (Exception ignored) { }
        return null;
    }

    /** A pack's info (its first entry: kind, gameFilesVersion, files, bytes), or null when the file isn't a pack. */
    static JSONObject packInfo(Context c, Uri uri) {
        try (InputStream raw = c.getContentResolver().openInputStream(uri);
             ZipInputStream zip = new ZipInputStream(new BufferedInputStream(raw, 1 << 16))) {
            ZipEntry first = zip.getNextEntry();
            if (first == null || !(COMICS_MARKER.equals(first.getName()) || DATA_MARKER.equals(first.getName()))) return null;
            return new JSONObject(new String(readAll(zip), "UTF-8"));
        } catch (Exception ignored) { }
        return null;
    }

    /** The game files version of the last data pack imported here ("" if none was, or it was before 0.7.24). */
    static String importedDataPackVersion(Context c) {
        return c.getSharedPreferences("companion", Context.MODE_PRIVATE).getString("dataPackVersion", "");
    }

    /**
     * Unpacks a data pack (the basics, schedule-edit data, patch zips, pictures) into files/data, with the
     * server stopped. Never touches the save or account files: from .database only the files the pack
     * says it replaces. Afterwards leftovers in the folders it replaces (e.g. from earlier schedule edits
     * on this phone) are removed, so the server starts in the pack's state.
     */
    static PackResult importDataPack(Context c, Uri uri, Progress p) throws Exception {
        File data = ServerFiles.dataDir(c);
        data.mkdirs();
        long total = -1;
        try (android.content.res.AssetFileDescriptor fd = c.getContentResolver().openAssetFileDescriptor(uri, "r")) {
            if (fd != null) total = fd.getLength();
        } catch (Exception ignored) { }
        PackResult result = new PackResult();
        result.packBytes = total;
        java.util.Set<String> inPack = new java.util.HashSet<>();
        JSONObject info;
        try (InputStream raw = c.getContentResolver().openInputStream(uri);
             CountingStream counted = new CountingStream(new BufferedInputStream(raw, 1 << 20));
             ZipInputStream zip = new ZipInputStream(counted)) {
            ZipEntry first = zip.getNextEntry();
            if (first == null || !DATA_MARKER.equals(first.getName())) throw new IOException("this isn't a data pack");
            info = new JSONObject(new String(readAll(zip), "UTF-8"));
            if (!"starpoint-data-pack".equals(info.optString("kind"))) throw new IOException("this isn't a data pack");
            result.version = info.optString("gameFilesVersion");
            JSONObject replaces = info.optJSONObject("replaces");
            java.util.Set<String> databaseFiles = new java.util.HashSet<>();
            JSONArray db = replaces == null ? null : replaces.optJSONArray("database");
            if (db != null) for (int i = 0; i < db.length(); i++) databaseFiles.add(".database/" + db.getString(i));
            long free = new StatFs(data.getPath()).getAvailableBytes();
            long need = info.optLong("bytes", 0) + (64L << 20);
            if (free < need) {
                throw new IOException(String.format(Locale.US, "Not enough free space: the pack needs up to %.1f GB, %.1f GB free.", need / 1073741824.0, free / 1073741824.0));
            }
            ZipEntry entry;
            long last = 0;
            while ((entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String name = entry.getName().replace('\\', '/');
                boolean database = name.startsWith(".database/");
                if (database ? !databaseFiles.contains(name) : !name.startsWith(".cdn/")) continue; // never the save
                File out = target(data, name);
                if (out == null) continue;
                inPack.add(name);
                long size = entry.getSize();
                if (!database && size >= 0 && out.exists() && out.length() == size) {
                    result.skipped++;
                } else {
                    long[] ignore = {0};
                    copy(zip, out, size, ignore, total, (m, d, t) -> { }, name);
                    result.written++;
                }
                long now = System.currentTimeMillis();
                if (now - last > 250) {
                    p.update("Data: " + (result.written + result.skipped) + " / " + info.optInt("files") + " files", counted.count, total);
                    last = now;
                }
            }
            // leftovers: schedule files the pack doesn't have (the server's defaults apply), and files in
            // the replaced folders that aren't in the pack
            for (String name : databaseFiles) if (!inPack.contains(name) && new File(data, name).delete()) result.removed++;
            JSONArray folders = replaces == null ? null : replaces.optJSONArray("folders");
            if (folders != null) for (int i = 0; i < folders.length(); i++) {
                String folder = folders.getString(i);
                if (!folder.startsWith(".cdn/") && !folder.equals(".generated")) continue;
                result.removed += removeOthers(new File(data, folder), folder, inPack);
            }
        }
        if (result.written + result.skipped == 0) throw new IOException("the pack holds no data");
        c.getSharedPreferences("companion", Context.MODE_PRIVATE).edit().putString("dataPackVersion", result.version).apply();
        p.update("Done", total, total);
        return result;
    }

    /** Deletes the files under dir (shown as at/...) that aren't in keep; returns how many. */
    private static int removeOthers(File dir, String at, java.util.Set<String> keep) {
        int n = 0;
        File[] list = dir.listFiles();
        if (list == null) return 0;
        for (File f : list) {
            String name = at + "/" + f.getName();
            if (f.isDirectory()) {
                n += removeOthers(f, name, keep);
                String[] left = f.list();
                if (left != null && left.length == 0) f.delete();
            } else if (!keep.contains(name) && f.delete()) {
                n++;
            }
        }
        return n;
    }

    /**
     * Unpacks a comics pack into files/data/.cdn/comics. Files already there with the same size are
     * skipped, so a stopped import resumes. The server may keep running: it reads the comics folder per
     * request, and every file is written next to its place first, then renamed.
     */
    static PackResult importComicsPack(Context c, Uri uri, Progress p) throws Exception {
        File data = ServerFiles.dataDir(c);
        File comics = new File(data, ".cdn/comics");
        long total = -1;
        try (android.content.res.AssetFileDescriptor fd = c.getContentResolver().openAssetFileDescriptor(uri, "r")) {
            if (fd != null) total = fd.getLength();
        } catch (Exception ignored) { }
        PackResult result = new PackResult();
        result.packBytes = total;
        try (InputStream raw = c.getContentResolver().openInputStream(uri);
             CountingStream counted = new CountingStream(new BufferedInputStream(raw, 1 << 20));
             ZipInputStream zip = new ZipInputStream(counted)) {
            ZipEntry first = zip.getNextEntry();
            if (first == null || !COMICS_MARKER.equals(first.getName())) {
                throw new IOException("this isn't a comics pack (make one on the PC with: node scripts/build_comics_pack.cjs comics.zip)");
            }
            JSONObject info = new JSONObject(new String(readAll(zip), "UTF-8"));
            if (!"starpoint-comics-pack".equals(info.optString("kind"))) throw new IOException("this isn't a comics pack");
            long bytes = info.optLong("bytes", 0);
            // room for what isn't here yet (files already in place are skipped)
            long have = folderSize(comics);
            comics.mkdirs();
            long free = new StatFs(data.getPath()).getAvailableBytes();
            long need = Math.max(0, bytes - have) + (64L << 20);
            if (free < need) {
                throw new IOException(String.format(Locale.US, "Not enough free space: the comics need %.1f GB, %.1f GB free.", need / 1073741824.0, free / 1073741824.0));
            }
            ZipEntry entry;
            long last = 0;
            while ((entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String name = entry.getName().replace('\\', '/');
                if (!name.startsWith(".cdn/comics/")) continue;
                File out = target(data, name);
                if (out == null) continue;
                long size = entry.getSize();
                if (size >= 0 && out.exists() && out.length() == size) {
                    result.skipped++;
                } else {
                    long[] ignore = {0};
                    copy(zip, out, size, ignore, total, (m, d, t) -> { }, name);
                    result.written++;
                }
                long now = System.currentTimeMillis();
                if (now - last > 250) {
                    p.update("Comics: " + (result.written + result.skipped) + " / " + info.optInt("files") + " files", counted.count, total);
                    last = now;
                }
            }
        }
        if (result.written + result.skipped == 0) throw new IOException("the pack holds no comics");
        p.update("Done", total, total);
        return result;
    }

    private static long folderSize(File dir) {
        long n = 0;
        File[] list = dir.listFiles();
        if (list != null) for (File f : list) n += f.isDirectory() ? folderSize(f) : f.length();
        return n;
    }

    /** Downloads the chosen data from a PC's StarPoint (host like 192.168.1.20:8000). Returns the number of files downloaded. */
    static int downloadFromPc(Context c, String host, Options o, Progress p) throws Exception {
        File data = ServerFiles.dataDir(c);
        data.mkdirs();
        // the game files are ~138k small requests: keep connections open and fetch several at a time
        System.setProperty("http.keepAlive", "true");
        System.setProperty("http.maxConnections", String.valueOf(THREADS + 2));
        String base = "http://" + host.trim().replaceFirst("^https?://", "").replaceAll("/+$", "");
        p.update("Asking " + base + " for the file list...", 0, -1);
        String query = "?save=" + (o.save ? 1 : 0) + "&patches=" + (o.patches ? 1 : 0) + "&images=" + (o.images ? 1 : 0) + "&comics=" + (o.comics ? 1 : 0)
                + "&schedule=" + (o.schedule ? 1 : 0) + "&game=" + (o.game ? 1 : 0);

        // read as a stream: with the game files the list has ~138k entries
        List<String[]> files = new ArrayList<>();
        Map<String, String> env = new LinkedHashMap<>();
        long total = -1;
        HttpURLConnection mc = open(base + "/companion/manifest" + query);
        try (JsonReader r = new JsonReader(new InputStreamReader(new BufferedInputStream(mc.getInputStream(), 1 << 16), "UTF-8"))) {
            r.beginObject();
            while (r.hasNext()) {
                String key = r.nextName();
                if (key.equals("files")) {
                    r.beginArray();
                    while (r.hasNext()) {
                        String path = null; long size = -1;
                        r.beginObject();
                        while (r.hasNext()) {
                            String k = r.nextName();
                            if (k.equals("path")) path = r.nextString();
                            else if (k.equals("size")) size = r.nextLong();
                            else r.skipValue();
                        }
                        r.endObject();
                        if (path != null) files.add(new String[]{path, String.valueOf(size)});
                    }
                    r.endArray();
                } else if (key.equals("totalSize")) {
                    total = r.nextLong();
                } else if (key.equals("notes")) {
                    r.beginArray();
                    while (r.hasNext()) o.notes += (o.notes.isEmpty() ? "" : "\n") + r.nextString();
                    r.endArray();
                } else if (key.equals("env")) {
                    r.beginObject();
                    while (r.hasNext()) { String k = r.nextName(); env.put(k, r.nextString()); }
                    r.endObject();
                } else {
                    r.skipValue();
                }
            }
            r.endObject();
        } finally {
            mc.disconnect();
        }

        // skip files already here with the same size, except the save and schedules (always fresh);
        // the game's info.json comes last, so the game never takes a half-filled folder as finished
        List<Item> todo = new ArrayList<>();
        Item gameInfo = null, updateList = null;
        long skipped = 0, gameMissing = 0;
        int checked = 0;
        // each folder is listed once (shared storage makes every per-file check slow): a file not in its
        // folder's listing is missing without asking the storage for it. A file that is there and that this
        // app copied before with the same size (the record) is skipped; any other gets a size check, several
        // at a time, and goes on the record when it matches, so the next copy needs no checks at all.
        Map<String, java.util.Set<String>> listings = new java.util.HashMap<>();
        CopyRecord record = new CopyRecord(c);
        List<Item> unsure = new ArrayList<>();
        for (String[] f : files) {
            String path = f[0];
            long size = Long.parseLong(f[1]);
            File out = place(data, path);
            if (out == null) continue;
            if (++checked % 2000 == 0) p.update("Checking what's already here... " + checked + " / " + files.size(), 0, -1);
            Item item = new Item(path, size, out);
            if (path.equals("game/info.json")) { gameInfo = item; continue; }
            // the update list names this phone's own schedule updates, whose zips are only here: the PC's list
            // replaces it only together with the PC's zips (game updates ticked), or when there's none yet
            if (path.equals(".cdn/cn_patches/patches.json") && !o.patches && out.exists()) continue;
            // the update list comes after the zips it names (like the game's info.json), so a copy that stops
            // partway never leaves a list pointing at missing zips (the game's U0000)
            if (path.equals(".cdn/cn_patches/patches.json")) { updateList = item; continue; }
            // the update list is rewritten by this phone's own server (its schedule builds), so it's always fetched
            // so are custom unit files (small; an edited one can keep its size)
            boolean always = path.startsWith(".database/") || path.equals(".cdn/cn_patches/patches.json") || path.startsWith(CUSTOM_UNITS + "/");
            if (!always && listed(listings, out)) {
                // the record only stands in for the slow size checks of the game files on shared storage; the
                // server's own files are in this app's storage (fast to check, and the server may change them)
                if (path.startsWith("game/") && record.has(path, size)) { skipped += size; continue; }
                if (!path.startsWith("game/")) {
                    if (out.length() == size) { skipped += size; continue; }
                    todo.add(item);
                    continue;
                }
                unsure.add(item);
                continue;
            }
            todo.add(item);
            if (path.startsWith("game/")) gameMissing += size;
        }
        if (!unsure.isEmpty()) {
            AtomicInteger sized = new AtomicInteger();
            List<Item> same = java.util.Collections.synchronizedList(new ArrayList<>());
            ExecutorService checks = Executors.newFixedThreadPool(16);
            for (Item item : unsure) checks.execute(() -> {
                if (item.out.length() == item.size) same.add(item);
                sized.incrementAndGet();
            });
            checks.shutdown();
            while (!checks.awaitTermination(300, TimeUnit.MILLISECONDS)) {
                p.update("Checking the files already here... " + sized.get() + " / " + unsure.size(), 0, -1);
            }
            java.util.Set<Item> matched = new java.util.HashSet<>(same);
            for (Item item : unsure) {
                if (matched.contains(item)) { skipped += item.size; record.add(item.path, item.size); continue; }
                todo.add(item);
                if (item.path.startsWith("game/")) gameMissing += item.size;
            }
            record.flush();
        }
        if (gameInfo != null) {
            File dir = gameDropOff();
            dir.mkdirs();
            if (!dir.isDirectory()) throw new IOException("Can't make " + dir + ": allow this app \"All files access\" first.");
            long free = new StatFs(dir.getPath()).getAvailableBytes();
            // the game later moves the files into its own storage, so it needs the room once more at that point
            if (free < gameMissing + (512L << 20)) {
                throw new IOException(String.format(Locale.US, "Not enough free space for the game files: %.1f GB more needed, %.1f GB free.",
                        gameMissing / 1073741824.0, free / 1073741824.0));
            }
            new File(dir, "info.json").delete();
        }

        AtomicLong done = new AtomicLong(skipped);
        AtomicInteger count = new AtomicInteger();
        AtomicReference<Exception> failed = new AtomicReference<>();
        ExecutorService pool = Executors.newFixedThreadPool(THREADS);
        for (Item item : todo) {
            pool.execute(() -> {
                if (failed.get() != null) return;
                try {
                    fetch(base, item, done);
                    if (item.path.startsWith("game/")) record.add(item.path, item.size);
                    count.incrementAndGet();
                } catch (Exception e) {
                    failed.compareAndSet(null, e);
                }
            });
        }
        pool.shutdown();
        long t = total;
        long lastFlush = System.currentTimeMillis();
        try {
            while (!pool.awaitTermination(300, TimeUnit.MILLISECONDS)) {
                p.update("Copying " + count.get() + " / " + todo.size() + " files", done.get(), t);
                // kept on disk as it goes, so a stopped copy still knows what it finished
                if (System.currentTimeMillis() - lastFlush > 5000) { record.flush(); lastFlush = System.currentTimeMillis(); }
            }
        } finally {
            record.flush();
        }
        if (failed.get() != null) throw failed.get();
        if (updateList != null) { fetch(base, updateList, done); count.incrementAndGet(); }
        if (gameInfo != null) { fetch(base, gameInfo, done); count.incrementAndGet(); }

        if (!env.isEmpty()) mergeEnv(new File(data, ".env"), env);
        removeOldCustomUnits(data, files);
        p.update("Done", total, total);
        return count.get();
    }

    private static final int THREADS = 6;

    /** Custom units and changes to existing units (docs/CUSTOM_UNITS.md): the phone's server reads them from here (companion-main.js). */
    private static final String CUSTOM_UNITS = ".cdn/custom_units";

    /**
     * Removes the custom unit files the PC no longer has. Only when the PC sent its index (_units.json):
     * a PC server too old to send custom units leaves the phone's alone.
     */
    private static void removeOldCustomUnits(File data, List<String[]> files) {
        java.util.Set<String> sent = new java.util.HashSet<>();
        for (String[] f : files) if (f[0].startsWith(CUSTOM_UNITS + "/")) sent.add(f[0]);
        if (!sent.contains(CUSTOM_UNITS + "/_units.json")) return;
        // the unit files, and the changes to existing units (changes/)
        for (String folder : new String[]{CUSTOM_UNITS, CUSTOM_UNITS + "/changes"}) {
            File[] here = new File(data, folder).listFiles();
            if (here != null) for (File f : here) {
                if (f.isFile() && f.getName().endsWith(".json") && !sent.contains(folder + "/" + f.getName())) f.delete();
            }
        }
    }

    /**
     * The files this app copied over Wi-Fi, with their sizes (in its own storage, which is fast to read), so a
     * later copy can skip them without asking the shared storage for each file's size. Files are written as
     * .part and renamed when complete, so a file under its own name with a matching record is whole.
     */
    private static final class CopyRecord {
        private final File file;
        private final Map<String, Long> sizes = new java.util.HashMap<>();
        private final StringBuilder pending = new StringBuilder();

        CopyRecord(Context c) {
            file = new File(c.getFilesDir(), "wifi-copied.tsv");
            if (!file.exists()) return;
            try (java.io.BufferedReader r = new java.io.BufferedReader(new InputStreamReader(new FileInputStream(file), "UTF-8"), 1 << 16)) {
                String line;
                while ((line = r.readLine()) != null) {
                    int tab = line.indexOf('\t');
                    if (tab <= 0) continue;
                    try { sizes.put(line.substring(tab + 1), Long.parseLong(line.substring(0, tab))); } catch (NumberFormatException ignored) { }
                }
            } catch (IOException ignored) {
                sizes.clear(); // an unreadable record only means every file gets checked
            }
        }

        synchronized boolean has(String path, long size) {
            Long known = sizes.get(path);
            return known != null && known == size;
        }

        synchronized void add(String path, long size) {
            Long known = sizes.put(path, size);
            if (known == null || known != size) pending.append(size).append('\t').append(path).append('\n');
        }

        /** Appends the new entries (a later line for a path wins when read back). */
        synchronized void flush() {
            if (pending.length() == 0) return;
            try (OutputStream os = new FileOutputStream(file, true)) {
                os.write(pending.toString().getBytes("UTF-8"));
                pending.setLength(0);
            } catch (IOException ignored) {
                // not kept: those files are checked again next time
            }
        }
    }

    /** One file, tried up to 3 times (a long copy over Wi-Fi may meet a dropped connection). */
    private static void fetch(String base, Item item, AtomicLong done) throws IOException {
        String url = base + "/companion/file?path=" + URLEncoder.encode(item.path, "UTF-8");
        for (int attempt = 1; ; attempt++) {
            try {
                HttpURLConnection conn = open(url);
                // read to the end and close without disconnect(), so the connection is reused
                try (InputStream in = conn.getInputStream()) {
                    copy(in, item.out, item.size, done);
                }
                return;
            } catch (IOException e) {
                if (attempt >= 3) throw new IOException(item.path + ": " + e.getMessage(), e);
                try { Thread.sleep(1000L * attempt); } catch (InterruptedException ie) { throw new IOException("stopped"); }
            }
        }
    }

    private static void copy(InputStream in, File out, long size, AtomicLong done) throws IOException {
        File parent = out.getParentFile();
        if (!parent.isDirectory() && !parent.mkdirs() && !parent.isDirectory()) throw new IOException("can't make " + parent);
        File part = new File(out.getPath() + ".part");
        byte[] buffer = new byte[64 * 1024];
        long got = 0;
        try (OutputStream os = new FileOutputStream(part)) {
            int n;
            while ((n = in.read(buffer)) > 0) { os.write(buffer, 0, n); got += n; done.addAndGet(n); }
        } catch (IOException e) {
            done.addAndGet(-got);
            part.delete();
            throw e;
        }
        if (size >= 0 && got != size) {
            done.addAndGet(-got);
            part.delete();
            throw new IOException("got " + got + " of " + size + " bytes");
        }
        beforeWrite(out);
        out.delete();
        if (!part.renameTo(out)) throw new IOException("can't write " + out);
    }

    /** Sets these keys in a .env file, keeping its other lines. */
    static void mergeEnv(File file, Map<String, String> values) throws IOException {
        List<String> lines = new ArrayList<>();
        if (file.exists()) {
            try (InputStream in = new FileInputStream(file)) {
                for (String line : new String(readAll(in), "UTF-8").split("\r?\n")) {
                    String key = line.contains("=") ? line.substring(0, line.indexOf('=')).trim() : null;
                    if (key == null || !values.containsKey(key)) if (!line.isEmpty()) lines.add(line);
                }
            }
        }
        for (Map.Entry<String, String> e : values.entrySet()) lines.add(e.getKey() + "=\"" + e.getValue() + "\"");
        try (OutputStream os = new FileOutputStream(file)) { os.write((String.join("\n", lines) + "\n").getBytes("UTF-8")); }
    }

    private static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(60000);
        int code = conn.getResponseCode();
        if (code != 200) { conn.disconnect(); throw new IOException(url + ": HTTP " + code); }
        return conn;
    }

    private static byte[] get(String url) throws IOException {
        HttpURLConnection conn = open(url);
        try (InputStream in = conn.getInputStream()) { return readAll(in); } finally { conn.disconnect(); }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[64 * 1024];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
        return out.toByteArray();
    }

    private static final class CountingStream extends java.io.FilterInputStream {
        long count;
        CountingStream(InputStream in) { super(in); }
        @Override public int read() throws IOException { int b = super.read(); if (b >= 0) count++; return b; }
        @Override public int read(byte[] b, int off, int len) throws IOException { int n = super.read(b, off, len); if (n > 0) count += n; return n; }
    }

    /** One line about what's in files/data. */
    static String summary(Context c) {
        File data = ServerFiles.dataDir(c);
        boolean path = new File(data, ".cdn/cn/path").exists();
        boolean patches = new File(data, ".cdn/cn_patches/patches.json").exists();
        boolean save = new File(data, ".database/wdfp_data.db").exists();
        File comics = new File(data, ".cdn/comics");
        if (!path || !patches) return "Game data: missing (copy it from your PC or a zip in \"Game data\").";
        return "Game data: ready" + (save ? ", save present" : ", no save yet (a new account is made)") + (comics.isDirectory() ? ", comics" : "");
    }
}
