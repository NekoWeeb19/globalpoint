package org.globalpoint.companion;

import android.content.Context;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

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
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * The player's save is the companion's files/data/.database (wdfp_data.db + the json state files).
 * Export writes it as one zip of .database/... entries; import replaces .database from such a zip.
 * The database is never copied while something writes to it: with the server running, the export
 * asks the server for a snapshot (GET /companion/manifest?save=1, a VACUUM INTO copy); with it
 * stopped, the files (including the -wal file) are copied as they are, which is a consistent set.
 */
final class SaveBackup {
    private SaveBackup() {}

    static File databaseDir(Context c) { return new File(ServerFiles.dataDir(c), ".database"); }

    /** Writes the save zip to the chosen document. Returns the number of files. */
    static int export(Context c, Uri target) throws Exception {
        int count = 0;
        try (OutputStream raw = c.getContentResolver().openOutputStream(target);
             ZipOutputStream zip = new ZipOutputStream(raw)) {
            if (ServerProbe.ownProcess(c) && ServerProbe.running()) {
                JSONObject manifest = new JSONObject(new String(get(ServerProbe.URL_ROOT + "companion/manifest?save=1"), "UTF-8"));
                JSONArray files = manifest.getJSONArray("files");
                for (int i = 0; i < files.length(); i++) {
                    String path = files.getJSONObject(i).getString("path");
                    if (!path.startsWith(".database/")) continue;
                    HttpURLConnection conn = (HttpURLConnection) new URL(ServerProbe.URL_ROOT + "companion/file?path=" + URLEncoder.encode(path, "UTF-8")).openConnection();
                    try (InputStream in = conn.getInputStream()) { put(zip, path, in); } finally { conn.disconnect(); }
                    count++;
                }
                // state files the manifest doesn't carry (anything else in .database), from disk
                File[] local = databaseDir(c).listFiles();
                if (local != null) for (File f : local) {
                    String path = ".database/" + f.getName();
                    if (!f.isFile() || f.getName().startsWith("wdfp_data.db") || manifestHas(files, path)) continue;
                    try (InputStream in = new FileInputStream(f)) { put(zip, path, in); }
                    count++;
                }
            } else {
                File[] local = databaseDir(c).listFiles();
                if (local == null || local.length == 0) throw new IOException("there is no save on this phone yet");
                // the database first, then its -wal/-shm, so an import puts them back in order
                java.util.Arrays.sort(local, (a, b) -> a.getName().compareTo(b.getName()));
                for (File f : local) {
                    if (!f.isFile() || f.getName().endsWith(".part")) continue;
                    try (InputStream in = new FileInputStream(f)) { put(zip, ".database/" + f.getName(), in); }
                    count++;
                }
            }
        }
        return count;
    }

    private static boolean manifestHas(JSONArray files, String path) throws Exception {
        for (int i = 0; i < files.length(); i++) if (files.getJSONObject(i).getString("path").equals(path)) return true;
        return false;
    }

    private static void put(ZipOutputStream zip, String name, InputStream in) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        byte[] b = new byte[64 * 1024];
        int n;
        while ((n = in.read(b)) > 0) zip.write(b, 0, n);
        zip.closeEntry();
    }

    /**
     * Replaces .database with the save in this zip (entries .database/..., or the files at the zip's
     * top level). The server must be stopped. The old save is kept as .database.old until the new
     * one is in place. Returns the number of files.
     */
    static int importSave(Context c, Uri source) throws IOException {
        File db = databaseDir(c);
        File incoming = new File(ServerFiles.dataDir(c), ".database.new");
        deleteDir(incoming);
        incoming.mkdirs();
        int count = 0;
        boolean hasDatabase = false;
        try (InputStream raw = c.getContentResolver().openInputStream(source);
             ZipInputStream zip = new ZipInputStream(raw)) {
            ZipEntry entry;
            byte[] b = new byte[64 * 1024];
            while ((entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String name = entry.getName().replace('\\', '/');
                int at = name.lastIndexOf(".database/");
                String file = at >= 0 ? name.substring(at + ".database/".length()) : name;
                if (file.isEmpty() || file.contains("/") || file.startsWith(".")) continue;
                if (!(file.startsWith("wdfp_data.db") || file.endsWith(".json"))) continue;
                try (OutputStream out = new FileOutputStream(new File(incoming, file))) {
                    int n;
                    while ((n = zip.read(b)) > 0) out.write(b, 0, n);
                }
                if (file.equals("wdfp_data.db")) hasDatabase = true;
                count++;
            }
        }
        if (!hasDatabase) {
            deleteDir(incoming);
            throw new IOException("no wdfp_data.db in this zip");
        }
        File old = new File(ServerFiles.dataDir(c), ".database.old");
        deleteDir(old);
        if (db.exists() && !db.renameTo(old)) throw new IOException("can't move the old save aside");
        if (!incoming.renameTo(db)) {
            old.renameTo(db);
            throw new IOException("can't put the new save in place");
        }
        return count;
    }

    private static void deleteDir(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File child : children) deleteDir(child);
        f.delete();
    }

    private static byte[] get(String url) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(3000);
        conn.setReadTimeout(60000);
        try (InputStream in = conn.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] b = new byte[64 * 1024];
            int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            return out.toByteArray();
        } finally {
            conn.disconnect();
        }
    }
}
