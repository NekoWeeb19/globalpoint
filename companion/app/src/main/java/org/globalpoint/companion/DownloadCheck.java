package org.globalpoint.companion;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * Checks a download: works out its SHA-256 and says whether it's one of the GlobalPoint downloads, whole and
 * undamaged. A file of the right size with different contents is damaged. Used by Game data > Check a file and by
 * Setup check before it moves the OBB. Add a line to KNOWN whenever a download on the Drive changes (README.md
 * lists the same hashes).
 */
final class DownloadCheck {
    private DownloadCheck() { }

    /** sha256, size in bytes (-1: not known), what it is */
    private static final Object[][] KNOWN = {
            {"a57b1629b3564aa600cfaa9b1bbc88794a36eb1214b58f58238986dc0f0aebb7", -1L, "OBB part 1 of 3 (game files 1.4.800)"},
            {"343438b6ee2debb1843609acbf386b2cf977d23a6ea018485e22e6d48a5fc453", -1L, "OBB part 2 of 3 (game files 1.4.800)"},
            {"b3676a2042c945b26b7c0bfa1bd1127cb15e07984d7b2b47971c8b0d4aa9e412", -1L, "OBB part 3 of 3 (game files 1.4.800)"},
            {"5494b5a79f6508068c133c6ebd971862b1f0aaef1e6d0b2955d85a76eca1f697", 10293099326L, "the single OBB (game files 1.4.203)"},
            {"8637a682ab1439e8c62040ebe9a4ce47b3b3ec28b4f1f65c4ba00f5332a6e393", 2358543886L, "starpoint-data.zip (data pack, game files 1.4.800)"},
            {"7409b79cbe56c8c7ff05e48755904c7c35fb9677914925607a474f5a33424174", 1427068120L, "starpoint-comics.zip (comics pack)"},
            {"198f2b4fb31568e2050ca5e1989d711ff63077494b21ff990562263c0ff0774e", 139394817L, "World Flipper (game) APK, build 25"},
    };

    interface Progress { void update(String message, long done, long total); }

    /** good: a known download, whole; what: which one (or null); message: the full text to show */
    static final class Result {
        final boolean good;
        final String what, message;
        Result(boolean good, String what, String message) { this.good = good; this.what = what; this.message = message; }
    }

    /** Game data > Check a file: a file picked in the system file picker. */
    static String check(Context c, Uri uri, Progress progress) throws Exception {
        String name = "the file";
        long size = -1;
        try (Cursor cur = c.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (cur != null && cur.moveToFirst()) {
                if (!cur.isNull(0)) name = cur.getString(0);
                if (!cur.isNull(1)) size = cur.getLong(1);
            }
        } catch (Exception ignored) { }
        try (InputStream in = c.getContentResolver().openInputStream(uri)) {
            if (in == null) throw new java.io.IOException("can't open " + name);
            return verify(in, name, size, progress).message;
        }
    }

    /** A file on the phone's storage (Setup check, before moving the OBB). */
    static Result check(File f, Progress progress) throws Exception {
        try (InputStream in = new FileInputStream(f)) {
            return verify(in, f.getName(), f.length(), progress);
        }
    }

    private static Result verify(InputStream in, String name, long size, Progress progress) throws Exception {
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        long done = 0, shown = 0;
        byte[] buf = new byte[1 << 20];
        int n;
        while ((n = in.read(buf)) > 0) {
            sha.update(buf, 0, n);
            done += n;
            if (done - shown >= 32L << 20) { shown = done; progress.update("Checking " + name + "...", done, size); }
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : sha.digest()) hex.append(String.format(Locale.US, "%02x", b));
        String hash = hex.toString();
        String detail = "\n\n" + name + "\n" + String.format(Locale.US, "%,d bytes (%.2f GB)", done, done / 1073741824.0) + "\nSHA-256: " + hash;

        for (Object[] k : KNOWN)
            if (k[0].equals(hash)) return new Result(true, (String) k[2], "OK: this is " + k[2] + ". It's complete and undamaged." + detail);
        for (Object[] k : KNOWN)
            if ((Long) k[1] == done) return new Result(false, (String) k[2], "DAMAGED: this is the size of " + k[2] + ", but its contents are different. Download it again." + detail);
        if (size > 0 && done != size) return new Result(false, null, "INCOMPLETE: only " + done + " of " + size + " bytes could be read. Copy or download it again." + detail);
        return new Result(false, null, "Not one of the known GlobalPoint downloads. It may be damaged, cut short, or a different version than this app knows: "
                + "compare its SHA-256 with the list in the README, or download it again." + detail);
    }
}
