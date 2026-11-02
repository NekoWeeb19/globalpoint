package org.globalpoint.companion;

import android.content.Context;
import android.content.pm.PackageManager;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * App storage layout:
 *   files/server/  the server code, unpacked from the APK's server.zip after every install or update
 *   files/data/    the player's data, kept: .database, .cdn, .env, server.log
 */
final class ServerFiles {
    private ServerFiles() {}

    static File serverDir(Context c) { return new File(c.getFilesDir(), "server"); }
    static File dataDir(Context c) { return new File(c.getFilesDir(), "data"); }
    static File logFile(Context c) { return new File(dataDir(c), "server.log"); }

    /** Unpacks the server code if this install hasn't yet. */
    static void prepare(Context c) throws IOException {
        File server = serverDir(c), data = dataDir(c);
        data.mkdirs();
        String stamp;
        try {
            stamp = String.valueOf(c.getPackageManager().getPackageInfo(c.getPackageName(), 0).lastUpdateTime);
        } catch (PackageManager.NameNotFoundException e) {
            stamp = "unknown";
        }
        File marker = new File(server, ".installed");
        if (marker.exists() && stamp.equals(readSmall(marker))) return;

        log(c, "[companion] unpacking the server files...");
        long start = System.currentTimeMillis();
        deleteTree(server);
        server.mkdirs();
        byte[] buffer = new byte[64 * 1024];
        int count = 0;
        try (InputStream raw = c.getAssets().open("server.zip");
             ZipInputStream zip = new ZipInputStream(new BufferedInputStream(raw, 256 * 1024))) {
            ZipEntry entry;
            String root = server.getCanonicalPath() + File.separator;
            while ((entry = zip.getNextEntry()) != null) {
                File out = new File(server, entry.getName());
                if (!out.getCanonicalPath().startsWith(root)) throw new IOException("bad entry " + entry.getName());
                if (entry.isDirectory()) { out.mkdirs(); continue; }
                out.getParentFile().mkdirs();
                try (OutputStream os = new FileOutputStream(out)) {
                    int n;
                    while ((n = zip.read(buffer)) > 0) os.write(buffer, 0, n);
                }
                count++;
            }
        }
        try (FileWriter w = new FileWriter(marker)) { w.write(stamp); }
        log(c, "[companion] unpacked " + count + " files in " + (System.currentTimeMillis() - start) + " ms");
    }

    static void log(Context c, String line) {
        try (FileWriter w = new FileWriter(logFile(c), true)) { w.write(line + "\n"); } catch (IOException ignored) { }
    }

    private static String readSmall(File f) {
        try (InputStream in = new java.io.FileInputStream(f)) {
            byte[] b = new byte[64];
            int n = in.read(b);
            return n > 0 ? new String(b, 0, n) : "";
        } catch (IOException e) {
            return "";
        }
    }

    // deletes links (server/.cdn points into data/) without following them
    private static void deleteTree(File f) throws IOException {
        File parent = f.getParentFile();
        boolean link = parent != null && !f.getCanonicalPath().equals(new File(parent.getCanonicalFile(), f.getName()).getPath());
        if (!link && f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) for (File child : children) deleteTree(child);
        }
        f.delete();
    }
}
