package org.globalpoint.companion;

import android.content.Context;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Brings the server's data into files/data: from a zip (any zip whose entries are .database/...,
 * .cdn/... or .env, also inside one top folder), or from a PC running StarPoint over Wi-Fi
 * (GET /companion/manifest and /companion/file, src/routes/companion.ts). The server must be
 * stopped while the save (.database) is replaced.
 */
final class DataTransfer {
    interface Progress { void update(String message, long done, long total); }

    static final class Options {
        boolean save, patches, images, comics;
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

    /** Downloads the chosen data from a PC's StarPoint (host like 192.168.1.20:8000). Returns the number of files downloaded. */
    static int downloadFromPc(Context c, String host, Options o, Progress p) throws Exception {
        File data = ServerFiles.dataDir(c);
        data.mkdirs();
        String base = "http://" + host.trim().replaceFirst("^https?://", "").replaceAll("/+$", "");
        p.update("Asking " + base + " for the file list...", 0, -1);
        String query = "?save=" + (o.save ? 1 : 0) + "&patches=" + (o.patches ? 1 : 0) + "&images=" + (o.images ? 1 : 0) + "&comics=" + (o.comics ? 1 : 0);
        JSONObject manifest = new JSONObject(new String(get(base + "/companion/manifest" + query), "UTF-8"));
        JSONArray files = manifest.getJSONArray("files");
        long total = manifest.optLong("totalSize", -1);

        // skip files already here with the same size, except the save and schedules (always fresh)
        List<JSONObject> todo = new ArrayList<>();
        long skipped = 0;
        for (int i = 0; i < files.length(); i++) {
            JSONObject f = files.getJSONObject(i);
            File out = target(data, f.getString("path"));
            if (out == null) continue;
            boolean always = f.getString("path").startsWith(".database/");
            if (!always && out.exists() && out.length() == f.getLong("size")) { skipped += f.getLong("size"); continue; }
            todo.add(f);
        }
        long[] done = {skipped};
        for (JSONObject f : todo) {
            String path = f.getString("path");
            File out = target(data, path);
            HttpURLConnection conn = open(base + "/companion/file?path=" + URLEncoder.encode(path, "UTF-8"));
            try (InputStream in = conn.getInputStream()) {
                copy(in, out, f.getLong("size"), done, total, p, path);
            } finally {
                conn.disconnect();
            }
        }

        JSONObject env = manifest.optJSONObject("env");
        if (env != null && env.length() > 0) {
            Map<String, String> values = new LinkedHashMap<>();
            for (java.util.Iterator<String> it = env.keys(); it.hasNext(); ) { String k = it.next(); values.put(k, env.getString(k)); }
            mergeEnv(new File(data, ".env"), values);
        }
        p.update("Done", total, total);
        return todo.size();
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
