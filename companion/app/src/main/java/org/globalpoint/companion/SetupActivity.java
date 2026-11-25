package org.globalpoint.companion;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.AppOpsManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.SpannableString;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Setup check: a checklist for playing on this phone (setup C), each line green, yellow or red with a button that
 * fixes it where the app can. It finds the downloaded OBB (the 3 parts or the single file) in Download and the like,
 * checks it's undamaged and moves it into starpoint_game for the game; it removes loose game files left in the
 * drop-off folders from an earlier setup (the game would spend ages listing them); and it shows when the server
 * is ready. What only the person can do (installing the game, Android's permission switches) it opens the right
 * screen for.
 *
 * Tr.t("Set up everything") does it all in one go for players who'd rather not follow steps: it asks for the two
 * permissions (this app's and the game's All files access), then checks and moves the OBB, imports the data pack and
 * the comics pack (optional) found in Download and the like, removes leftovers and starts the server.
 */
public class SetupActivity extends Activity {
    private static final String GAME = "com.leiting.wf";
    private static final int GREEN = 0xFF2E9E44, YELLOW = 0xFFE0A000, RED = 0xFFD32F2F, GREY = 0xFF8A8A8A;
    private static final File SDCARD = new File("/sdcard");
    /** where the game picks up game files (scripts/client_mod/as3/starpoint/StorageDropoff.as) */
    private static final File[] DROP = {new File(SDCARD, "Android/obb/" + GAME), new File(SDCARD, "StarPoint/game"), new File(SDCARD, "starpoint_game")};
    private static final File TARGET = new File(SDCARD, "starpoint_game");
    private static final Pattern OBB_NAME = Pattern.compile("^main\\.\\d+\\.com\\.leiting\\.wf(\\.part(\\d+)of(\\d+))?\\.obb$", Pattern.CASE_INSENSITIVE);
    /** the names downloads end up with: a browser's " (1)" or "-1" for a repeat download, or ".bin" added; moved under the real name */
    private static final Pattern OBB_LOOSE = Pattern.compile("^main\\.\\d+\\.com\\.leiting\\.wf(\\.part(\\d+)of(\\d+))?(?:\\s*\\(\\d+\\)|-\\d+)?\\.obb(?:\\.bin)?$", Pattern.CASE_INSENSITIVE);
    private static final Pattern OBB_EXTRA = Pattern.compile("(?:\\s*\\(\\d+\\)|-\\d+)?\\.obb(?:\\.bin)?$", Pattern.CASE_INSENSITIVE);

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private LinearLayout list;
    private TextView status;
    private ProgressBar bar;
    private boolean busy, visible;
    /** Tr.t("Set up everything") waiting for a permission screen: 1 this app's storage, 2 the game's All files access */
    private int autoStage;
    /** set when this screen is left while autoStage waits, so it only carries on after a real trip to the settings */
    private boolean wentAway;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        setTitle(Tr.t("Setup check"));
        Ui u = new Ui(this);
        u.text(Tr.t("Everything needed to play on this phone. Green is done; yellow and red say what's left, with a button where this app can do it for you."), 14);
        u.text(Tr.t("Or let this app do it all: put the downloads (the OBB, starpoint-data.zip and, if you want comics, the comics zip) in Download, then press the button below and allow what Android asks."), 14);
        Button all = u.button(Tr.t("Set up everything"), this::setUpEverything);
        all.setTextSize(17);
        list = u.add(new LinearLayout(this));
        list.setOrientation(LinearLayout.VERTICAL);
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(1000);
        bar.setVisibility(View.GONE);
        u.add(bar);
        status = u.text("", 13);
        u.button(Tr.t("Check again"), this::refresh);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(u.root);
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        refresh();
        // back from a permission screen that Tr.t("Set up everything") opened: carry on
        if (!wentAway) return;
        wentAway = false;
        if (autoStage == 1) {
            if (ownStorage()) setUpEverything();
            else { autoStage = 0; status.setText(Tr.t("\"All files access\" for StarPoint Companion is still off, so it can't find the downloads. Press Set up everything again and turn it on.")); }
        } else if (autoStage == 2) {
            setUpEverything();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != 1 || autoStage != 1) return;
        if (ownStorage()) setUpEverything();
        else { autoStage = 0; status.setText(Tr.t("Storage access is off, so this app can't find the downloads. Press Set up everything again and allow it.")); }
    }

    @Override
    protected void onPause() {
        super.onPause();
        visible = false;
        if (autoStage > 0) wentAway = true;
    }

    // ---- the checks ----

    /** One line of the checklist. */
    private static final class Line {
        final int color;
        final String text, action;
        final Runnable fix;
        Line(int color, String text, String action, Runnable fix) { this.color = color; this.text = text; this.action = action; this.fix = fix; }
    }

    private void refresh() {
        if (busy) return;
        worker.execute(() -> {
            List<Line> lines = checks();
            ui.post(() -> show(lines));
        });
    }

    private void show(List<Line> lines) {
        list.removeAllViews();
        for (Line l : lines) {
            TextView t = new TextView(this);
            SpannableString s = new SpannableString("●  " + l.text);
            s.setSpan(new ForegroundColorSpan(l.color), 0, 1, 0);
            s.setSpan(new RelativeSizeSpan(1.4f), 0, 1, 0);
            t.setText(s);
            t.setTextSize(15);
            t.setPadding(0, 24, 0, 4);
            list.addView(t);
            if (l.fix != null) {
                Button b = new Button(this);
                b.setText(l.action);
                b.setEnabled(!busy);
                b.setOnClickListener(v -> l.fix.run());
                list.addView(b);
            }
        }
    }

    private List<Line> checks() {
        List<Line> out = new ArrayList<>();

        // 1. the game
        PackageInfo game = null;
        try { game = getPackageManager().getPackageInfo(GAME, 0); } catch (Exception ignored) { }
        out.add(game != null
                ? new Line(GREEN, Tr.t("World Flipper is installed (%s).", game.versionName), null, null)
                : new Line(RED, Tr.t("World Flipper isn't installed: install the game APK (build 25) from the downloads."), null, null));

        // 2. this app may look at the phone's storage (to find, check and move the OBB)
        boolean storage = ownStorage();
        out.add(storage
                ? new Line(GREEN, Tr.t("This app can use the phone's storage."), null, null)
                : new Line(RED, Tr.t("Allow \"All files access\" for StarPoint Companion, so it can find and move the game files."), Tr.t("Allow"), this::askOwnStorage));

        // 3. the game may read its files from shared storage
        if (game != null) {
            Boolean access = gameStorage();
            if (Boolean.TRUE.equals(access)) out.add(new Line(GREEN, Tr.t("World Flipper can read its game files (All files access is on)."), null, null));
            else if (access == null) out.add(new Line(YELLOW, Tr.t("Can't tell whether World Flipper has \"All files access\": check it's on, and the storage permissions (Photos and videos, Music and audio)."), Tr.t("Open World Flipper's settings"), this::openGameAccess));
            else out.add(new Line(RED, Tr.t("Turn on \"All files access\" for World Flipper, and allow its storage permissions (Photos and videos, Music and audio). Without them it can't see the OBB."), Tr.t("Open World Flipper's settings"), this::openGameAccess));
        }

        // 4. the OBB and 5. loose files left in the drop-off folders
        if (storage) {
            Obb inPlace = findObb(DROP, false), elsewhere = findObb(lookIn(), true);
            if (inPlace.any()) {
                String where = inPlace.folder;
                boolean obbFolder = where.contains("Android/obb");
                out.add(new Line(obbFolder ? YELLOW : GREEN, Tr.t("OBB in place (%s, in %s). The game unpacks it when it starts.", inPlace.describe(), where)
                        + (obbFolder ? Tr.t(" Some phones' file apps leave files there unreadable for the game; if it asks to download ~10 GB, move it to starpoint_game.") : ""), null, null));
            } else if (elsewhere.any()) {
                out.add(new Line(YELLOW, Tr.t("Found the OBB (%s) in %s. This app can check it's undamaged and move it to starpoint_game for the game (moving is instant, no extra space).", elsewhere.describe(), elsewhere.folder),
                        Tr.t("Check and move it"), () -> checkAndMove(elsewhere)));
            } else {
                out.add(new Line(GREY, Tr.t("No OBB found. If the game already has its files (it got past its title screen before), nothing to do. Otherwise download the OBB (the 3 parts) into Download and check again."), null, null));
            }
            if (inPlace.oldSingle() || (!inPlace.any() && elsewhere.oldSingle()))
                out.add(new Line(RED, Tr.t("This is the old single OBB (game files 1.4.203). GlobalPoint 1.0 doesn't support it: the updates it needs aren't in starpoint-data.zip any more. Download the OBB in 3 parts (game files 1.4.800) instead."), null, null));
            long[] loose = looseFiles();
            if (loose[0] > 0) {
                boolean obb = inPlace.any() || elsewhere.any();
                String what = Tr.t("%d loose game file(s) (%s) in the drop-off folders", loose[0], gb(loose[1]));
                out.add(obb
                        ? new Line(YELLOW, what + Tr.t(", from an earlier setup. With the OBB they aren't needed, and the game would spend a long time listing them before it starts."), Tr.t("Remove them"), this::removeLoose)
                        : new Line(GREY, what + Tr.t(". The game moves these in when it starts (e.g. after Download from PC with Full game files). Keep the game open until it's done."), null, null));
            }
        }

        // 6. the server's data
        boolean data = new File(ServerFiles.dataDir(this), ".cdn/cn/path").exists();
        out.add(data
                ? new Line(GREEN, Tr.t("The server has its data (%s).", DataTransfer.summary(this).split("\n")[0]), null, null)
                : new Line(RED, Tr.t("The server needs its data: import starpoint-data.zip (Game data > Import pack...), or Download from PC."), Tr.t("Game data"), () -> startActivity(new Intent(this, DataActivity.class))));

        // 6b. comics (optional): the comics pack, or Download from PC with Comics
        File comicsDir = new File(ServerFiles.dataDir(this), ".cdn/comics");
        String[] comicFiles = comicsDir.list();
        out.add(comicFiles != null && comicFiles.length > 0
                ? new Line(GREEN, Tr.t("Comics are in (Menu > Other > Comics in the game)."), null, null)
                : new Line(GREY, Tr.t("Comics: not added (optional). Import the comics zip (Game data > Import pack...), or Download from PC with Comics ticked."), Tr.t("Game data"), () -> startActivity(new Intent(this, DataActivity.class))));

        // 7. the server
        boolean up = ServerProbe.running(), own = ServerProbe.ownProcess(this);
        Boolean rebuilding = up ? ServerProbe.updateRebuilding() : null;
        if (own && up && Boolean.TRUE.equals(rebuilding)) out.add(new Line(YELLOW, Tr.t("Server running, but the game update is being rebuilt: wait before opening the game."), null, null));
        else if (own && up) out.add(new Line(GREEN, Tr.t("Server ready: open the game."), null, null));
        else if (own) out.add(new Line(YELLOW, Tr.t("Server starting..."), null, null));
        else out.add(new Line(RED, Tr.t("Server stopped."), data ? Tr.t("Start") : null, data ? () -> { ServerService.start(this); ui.postDelayed(this::refresh, 3000); } : null));
        return out;
    }

    // ---- permissions ----

    private boolean ownStorage() {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        return checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private void askOwnStorage() {
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getPackageName())));
            } catch (ActivityNotFoundException e) {
                startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
            }
        } else {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE, Manifest.permission.READ_EXTERNAL_STORAGE}, 1);
        }
    }

    /** Whether World Flipper has All files access (Android 11+) or storage (older); null when Android won't say. */
    @SuppressWarnings("deprecation")
    private Boolean gameStorage() {
        try {
            PackageManager pm = getPackageManager();
            if (Build.VERSION.SDK_INT >= 30) {
                int uid = pm.getApplicationInfo(GAME, 0).uid;
                AppOpsManager ops = getSystemService(AppOpsManager.class);
                int mode = Build.VERSION.SDK_INT >= 29 ? ops.unsafeCheckOpNoThrow("android:manage_external_storage", uid, GAME) : ops.checkOpNoThrow("android:manage_external_storage", uid, GAME);
                return mode == AppOpsManager.MODE_ALLOWED;
            }
            return pm.checkPermission(Manifest.permission.READ_EXTERNAL_STORAGE, GAME) == PackageManager.PERMISSION_GRANTED;
        } catch (Exception e) {
            return null;
        }
    }

    private void openGameAccess() {
        try {
            if (Build.VERSION.SDK_INT >= 30) startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + GAME)));
            else startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + GAME)));
        } catch (ActivityNotFoundException e) {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + GAME)));
        }
    }

    // ---- the OBB ----

    private static final long OLD_SINGLE_OBB_BYTES = 10293099326L;

    /** The OBB files found in one folder: the split parts (if all are there) or the single file. */
    private static final class Obb {
        String folder = "";
        File single;
        File[] parts;
        int partCount;
        boolean any() { return single != null || parts != null; }
        /** The old single OBB (game files 1.4.203, by its size): its updates left the data pack in GlobalPoint 1.0. */
        boolean oldSingle() { return parts == null && single != null && single.length() == OLD_SINGLE_OBB_BYTES; }
        List<File> files() {
            List<File> f = new ArrayList<>();
            if (parts != null) for (File p : parts) f.add(p);
            else if (single != null) f.add(single);
            return f;
        }
        String describe() {
            if (parts != null) return Tr.t("%d parts, %s", partCount, gb(total(files())));
            return Tr.t("the single file, %s", gb(single.length()));
        }
    }

    /** The first folder with a usable OBB: all parts of a split one (preferred), else a single one. */
    private static Obb findObb(File[] folders, boolean skipDrop) {
        Obb best = new Obb();
        for (File dir : folders) {
            if (skipDrop && isDrop(dir)) continue;
            File[] list = dir.listFiles();
            if (list == null) continue;
            File single = null;
            File[] parts = null;
            int count = 0;
            for (File f : list) {
                if (!f.isFile()) continue;
                Matcher m = (isDrop(dir) ? OBB_NAME : OBB_LOOSE).matcher(f.getName());
                if (!m.matches()) continue;
                // a file under its real name wins over a repeat download's " (1)"
                if (m.group(1) == null) { if (single == null || f.getName().equalsIgnoreCase(realName(f))) single = f; continue; }
                int n = Integer.parseInt(m.group(3)), i = Integer.parseInt(m.group(2));
                if (n < 2 || i < 1 || i > n) continue;
                if (parts == null || count != n) { parts = new File[n]; count = n; }
                if (parts[i - 1] == null || f.getName().equalsIgnoreCase(realName(f))) parts[i - 1] = f;
            }
            boolean whole = parts != null;
            if (whole) for (File p : parts) if (p == null) { whole = false; break; }
            // a split OBB being unpacked: only part 1 left (the game cuts the parts shorter as it goes)
            if (!whole && parts != null && parts[0] != null && isDrop(dir)) whole = true;
            if (whole) {
                Obb o = new Obb();
                o.folder = shortPath(dir);
                o.parts = parts[0] != null && parts.length > 1 && parts[1] == null ? new File[]{parts[0]} : parts;
                o.partCount = count;
                return o;
            }
            if (single != null && !best.any()) { best.folder = shortPath(dir); best.single = single; }
        }
        return best;
    }

    /** The OBB's real name (what the game looks for), from a downloaded one. */
    private static String realName(File f) { return OBB_EXTRA.matcher(f.getName()).replaceFirst(".obb"); }

    /**
     * Where downloads may be: Download, Downloads and Documents with their folders one level down (some phones'
     * browsers save into Download/Browser and the like), the top of storage, and the same on an SD card.
     */
    private static File[] lookIn() {
        List<File> roots = new ArrayList<>();
        roots.add(SDCARD);
        File[] volumes = new File("/storage").listFiles();
        if (volumes != null) for (File v : volumes) if (v.isDirectory() && !v.getName().equals("emulated") && !v.getName().equals("self")) roots.add(v);
        List<File> out = new ArrayList<>();
        for (File root : roots) {
            for (String name : new String[]{"Download", "Downloads", "Documents"}) {
                File dir = new File(root, name);
                out.add(dir);
                File[] sub = dir.listFiles();
                if (sub != null) for (File d : sub) if (d.isDirectory() && !d.getName().startsWith(".")) out.add(d);
            }
            out.add(root);
        }
        return out.toArray(new File[0]);
    }

    private static boolean isDrop(File dir) {
        for (File d : DROP) if (d.getAbsolutePath().equals(dir.getAbsolutePath())) return true;
        return false;
    }

    private void checkAndMove(Obb obb) {
        run(() -> moveObb(obb));
    }

    /** Checks the OBB files, then moves them to starpoint_game; returns what happened. */
    private String moveObb(Obb obb) throws Exception {
        List<File> files = obb.files();
        {
            // check every file first: nothing is moved if one is damaged
            int i = 0;
            for (File f : files) {
                i++;
                String step = Tr.t("Checking %d of %d: %s", i, files.size(), f.getName());
                DownloadCheck.Result r = DownloadCheck.check(f, (m, done, total) -> progress(step, done, total));
                if (!r.good) return Tr.t("Nothing was moved.") + "\n\n" + r.message;
                if (r.what == null || !r.what.contains("OBB")) return Tr.t("Nothing was moved: %s is %s, not an OBB. Rename it back, or download the OBB.", f.getName(), r.what == null ? "?" : Tr.t(r.what));
            }
            if (!TARGET.isDirectory() && !TARGET.mkdirs()) throw new java.io.IOException(Tr.t("couldn't make %s", shortPath(TARGET)));
            i = 0;
            for (File f : files) {
                i++;
                File to = new File(TARGET, realName(f));
                if (to.exists() && !to.delete()) throw new java.io.IOException(Tr.t("couldn't replace %s", shortPath(to)));
                if (!f.renameTo(to)) copyThenDelete(f, to, Tr.t("Moving %d of %d: %s", i, files.size(), f.getName()));
            }
            return Tr.t("Checked and moved %d file(s) to starpoint_game. Open the game: it unpacks them by itself (keep it open until it's done).", files.size());
        }
    }

    /** When a move can't be a rename (another storage): copy, then delete the original. */
    private void copyThenDelete(File from, File to, String step) throws Exception {
        long size = from.length();
        if (TARGET.getUsableSpace() < size + (64L << 20)) throw new java.io.IOException(Tr.t("not enough free space to copy %s (%s)", from.getName(), gb(size)));
        try (InputStream in = new FileInputStream(from); OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[1 << 20];
            long done = 0, shown = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                done += n;
                if (done - shown >= 32L << 20) { shown = done; progress(step, done, size); }
            }
        } catch (Exception e) {
            to.delete();
            throw e;
        }
        if (to.length() != size) { to.delete(); throw new java.io.IOException(Tr.t("the copy of %s came out short", from.getName())); }
        from.delete();
    }

    // ---- loose files left in the drop-off folders ----

    /** [count, bytes] of the files in the drop-off folders other than OBBs and server.txt. */
    private static long[] looseFiles() {
        long[] r = {0, 0};
        for (File d : DROP) count(d, true, r);
        return r;
    }

    private static void count(File dir, boolean top, long[] r) {
        File[] list = dir.listFiles();
        if (list == null) return;
        for (File f : list) {
            if (f.isDirectory()) { count(f, false, r); continue; }
            if (top && (OBB_NAME.matcher(f.getName()).matches() || f.getName().toLowerCase(Locale.US).endsWith(".obb") || f.getName().equalsIgnoreCase("server.txt"))) continue;
            r[0]++;
            r[1] += f.length();
        }
    }

    private void removeLoose() {
        new AlertDialog.Builder(this)
                .setTitle(Tr.t("Remove the loose game files?"))
                .setMessage(Tr.t("They're left from an earlier setup. The OBB has every game file, so they aren't needed. OBB files and server.txt stay."))
                .setPositiveButton(Tr.t("Remove"), (d, w) -> run(() -> Tr.t("Removed %d loose file(s).", removeLooseNow())))
                .setNegativeButton(Tr.t("Keep"), null)
                .show();
    }

    /** Deletes everything in the drop-off folders but OBBs and server.txt; returns how many files. */
    private static int removeLooseNow() {
        int removed = 0;
        for (File dir : DROP) {
            File[] list = dir.listFiles();
            if (list == null) continue;
            for (File f : list) {
                String name = f.getName().toLowerCase(Locale.US);
                if (f.isFile() && (name.endsWith(".obb") || name.equals("server.txt"))) continue;
                removed += delete(f);
            }
        }
        return removed;
    }

    private static int delete(File f) {
        int n = 0;
        if (f.isDirectory()) {
            File[] list = f.listFiles();
            if (list != null) for (File c : list) n += delete(c);
            f.delete();
            return n;
        }
        return f.delete() ? 1 : 0;
    }

    // ---- set up everything ----

    /** What Tr.t("Set up everything") found before it starts. */
    private static final class Plan {
        boolean game;
        Obb inPlace, elsewhere;
        long[] loose;
        File dataPack, comicsPack;
        String dataPackVersion = "";
        boolean data, comics, importData, importComics;
    }

    /** One button: the permissions first (each opens Android's screen; this carries on when the player is back), then the rest. */
    private void setUpEverything() {
        if (busy) return;
        if (!ownStorage()) {
            autoStage = 1;
            wentAway = false;
            status.setText(Tr.t("Turn on \"All files access\" for StarPoint Companion, then come back here: setup carries on by itself."));
            askOwnStorage();
            return;
        }
        if (gameInstalled() && autoStage < 2 && Boolean.FALSE.equals(gameStorage())) {
            autoStage = 2;
            wentAway = false;
            status.setText(Tr.t("Turn on \"All files access\" for World Flipper (and its storage permissions if listed), then come back here: setup carries on by itself."));
            openGameAccess();
            return;
        }
        autoStage = 0;
        status.setText(Tr.t("Looking for the downloads..."));
        worker.execute(() -> {
            Plan plan = plan();
            ui.post(() -> confirm(plan));
        });
    }

    private boolean gameInstalled() {
        try { getPackageManager().getPackageInfo(GAME, 0); return true; } catch (Exception e) { return false; }
    }

    private Plan plan() {
        Plan p = new Plan();
        p.game = gameInstalled();
        p.inPlace = findObb(DROP, false);
        p.elsewhere = findObb(lookIn(), true);
        p.loose = looseFiles();
        File data = ServerFiles.dataDir(this);
        p.data = new File(data, ".cdn/cn/path").exists();
        String[] comicFiles = new File(data, ".cdn/comics").list();
        p.comics = comicFiles != null && comicFiles.length > 0;
        long dataTime = 0, comicsTime = 0;
        for (File dir : lookIn()) {
            File[] files = dir.listFiles();
            if (files == null) continue;
            for (File f : files) {
                if (!f.isFile() || !f.getName().toLowerCase(Locale.US).endsWith(".zip")) continue;
                org.json.JSONObject info = DataTransfer.packInfo(this, Uri.fromFile(f));
                if (info == null) continue;
                String kind = info.optString("kind");
                if (kind.equals("starpoint-data-pack") && f.lastModified() > dataTime) { dataTime = f.lastModified(); p.dataPack = f; p.dataPackVersion = info.optString("gameFilesVersion"); }
                // the English comics; a Chinese comics pack (content "zh") is an extra for Game data > Import pack
                if (kind.equals("starpoint-comics-pack") && !"zh".equals(info.optString("content")) && f.lastModified() > comicsTime) { comicsTime = f.lastModified(); p.comicsPack = f; }
            }
        }
        // a data pack goes in when the server has no data yet, or it's another version than the one imported here
        String imported = DataTransfer.importedDataPackVersion(this);
        p.importData = p.dataPack != null && (!p.data || (!imported.isEmpty() && !imported.equals(p.dataPackVersion)));
        p.importComics = p.comicsPack != null && !p.comics;
        return p;
    }

    /** Says what's about to happen, then does it. */
    private void confirm(Plan p) {
        StringBuilder todo = new StringBuilder();
        if (!p.inPlace.any() && p.elsewhere.any()) todo.append(Tr.t("• Check the OBB (%s) and move it to starpoint_game. Checking takes a few minutes.\n", p.elsewhere.describe()));
        boolean obbAfter = p.inPlace.any() || p.elsewhere.any();
        if (obbAfter && p.loose[0] > 0) todo.append(Tr.t("• Remove %d leftover game file(s) (%s) from an earlier setup.\n", p.loose[0], gb(p.loose[1])));
        if (p.importData) todo.append(Tr.t("• Import the data pack (%s, %s). Your save isn't touched.\n", p.dataPack.getName(), gb(p.dataPack.length())));
        if (p.importComics) todo.append(Tr.t("• Import the comics pack (%s, %s).\n", p.comicsPack.getName(), gb(p.comicsPack.length())));
        if ((p.data || p.importData) && !ServerProbe.ownProcess(this)) todo.append(Tr.t("• Start the server.\n"));
        if (todo.length() == 0) {
            status.setText(finalReport(p, Tr.t("Nothing left for this app to do.")));
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle(Tr.t("Set up everything"))
                .setMessage(Tr.t("This will:\n\n%s\nKeep this screen open until it's done.", todo))
                .setPositiveButton(Tr.t("Go"), (d, w) -> run(() -> doAll(p)))
                .setNegativeButton(Tr.t("Cancel"), null)
                .show();
    }

    private String doAll(Plan p) {
        StringBuilder done = new StringBuilder();
        // 1. the OBB
        if (!p.inPlace.any() && p.elsewhere.any()) {
            try { done.append(Tr.t("OBB: ")).append(moveObb(p.elsewhere)).append("\n\n"); }
            catch (Exception e) { done.append(Tr.t("OBB: not moved (%s).\n\n", e.getMessage())); }
        }
        // 2. leftovers, once an OBB is in place
        if (findObb(DROP, false).any() && looseFiles()[0] > 0) {
            progress(Tr.t("Removing leftover game files..."), 0, -1);
            done.append(Tr.t("Removed %d leftover game file(s).\n\n", removeLooseNow()));
        }
        // 3. the data pack (the server is stopped while its files are replaced)
        List<File> imported = new ArrayList<>();
        if (p.importData) {
            try {
                if (ServerProbe.ownProcess(this)) {
                    progress(Tr.t("Stopping the server first..."), 0, -1);
                    ServerProbe.stopAndWait(this);
                }
                DataTransfer.PackResult r = DataTransfer.importDataPack(this, Uri.fromFile(p.dataPack), this::progress);
                done.append(Tr.t("Data pack imported (game files version %s). Your save wasn't touched.\n\n", r.version));
                imported.add(p.dataPack);
            } catch (Exception e) {
                done.append(Tr.t("Data pack: failed (%s). Try Game data > Import pack, or download it again.\n\n", e.getMessage()));
            }
        }
        // 4. the comics pack (optional)
        if (p.importComics) {
            try {
                DataTransfer.importComicsPack(this, Uri.fromFile(p.comicsPack), this::progress);
                done.append(Tr.t("Comics imported (Menu > Other > Comics in the game).\n\n"));
                imported.add(p.comicsPack);
            } catch (Exception e) {
                done.append(Tr.t("Comics pack: failed (%s). The game works without it.\n\n", e.getMessage()));
            }
        }
        // 5. the server
        if (new File(ServerFiles.dataDir(this), ".cdn/cn/path").exists() && !ServerProbe.ownProcess(this)) {
            ui.post(() -> ServerService.start(this));
            ui.postDelayed(this::refresh, 4000);
        }
        if (!imported.isEmpty()) ui.post(() -> offerDeletePacks(imported));
        return finalReport(plan(), done.toString().trim());
    }

    /** What's done and what the player still has to do, after Tr.t("Set up everything"). */
    private String finalReport(Plan p, String done) {
        List<String> left = new ArrayList<>();
        if (!p.game) left.add(Tr.t("Install World Flipper (the game APK, build 25), then press Set up everything again so it gets its file access."));
        else if (Boolean.FALSE.equals(gameStorage())) left.add(Tr.t("Turn on \"All files access\" for World Flipper (press Set up everything again)."));
        if (!p.inPlace.any() && p.elsewhere.any()) left.add(Tr.t("The OBB is still in %s, not moved: see the message above (download it again if it's damaged).", p.elsewhere.folder));
        if (!p.data) left.add(Tr.t(p.dataPack == null ? "No data pack found: download starpoint-data.zip into Download (or use Game data > Download from PC)." : "The server still has no data: see the message above."));
        String head = done.isEmpty() ? "" : done + "\n\n";
        // this app can't see whether the game already unpacked its files (they're in its private storage), so no OBB is only a note
        String noObb = !p.inPlace.any() && !p.elsewhere.any()
                ? Tr.t("\n\nNo OBB found: fine if the game has got past its title screen before. If not, download the OBB (the 3 parts) into Download and press the button again.") : "";
        if (left.isEmpty()) return head + Tr.t("All set. Open the game once the server line above says ready.") + (p.comics ? "" : Tr.t(" Comics are optional: put the comics zip in Download and press the button again to add them.")) + noObb;
        StringBuilder s = new StringBuilder(head).append(Tr.t("Still to do:"));
        for (String l : left) s.append("\n• ").append(l);
        return s.append(noObb).toString();
    }

    /** After imports: the packs aren't needed any more. */
    private void offerDeletePacks(List<File> packs) {
        long bytes = 0;
        for (File f : packs) bytes += f.length();
        new AlertDialog.Builder(this)
                .setTitle(Tr.t("Delete the imported packs?"))
                .setMessage(Tr.t("They're unpacked, so the zip file(s) (%s) aren't needed any more.", gb(bytes)))
                .setPositiveButton(Tr.t("Delete"), (d, w) -> {
                    int n = 0;
                    for (File f : packs) if (f.delete()) n++;
                    status.append(Tr.t(n == packs.size() ? "\n\nThe packs were deleted." : "\n\nCouldn't delete every pack; delete them in your Files app."));
                })
                .setNegativeButton(Tr.t("Keep"), null)
                .show();
    }

    // ---- running jobs ----

    interface Job { String run() throws Exception; }

    private void run(Job job) {
        busy = true;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        bar.setVisibility(View.VISIBLE);
        bar.setIndeterminate(true);
        status.setText(Tr.t("Working..."));
        refreshButtons();
        worker.execute(() -> {
            String result;
            try { result = job.run(); } catch (Exception e) { result = Tr.t("Failed: %s", e.getMessage()); }
            String message = result;
            List<Line> lines = checks();
            ui.post(() -> {
                busy = false;
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                bar.setVisibility(View.GONE);
                status.setText(message);
                show(lines);
            });
        });
    }

    private void refreshButtons() {
        for (int i = 0; i < list.getChildCount(); i++) if (list.getChildAt(i) instanceof Button) list.getChildAt(i).setEnabled(!busy);
    }

    private void progress(String message, long done, long total) {
        ui.post(() -> {
            bar.setIndeterminate(total <= 0);
            if (total > 0) bar.setProgress((int) (1000 * Math.min(done, total) / total));
            status.setText(total > 0 ? String.format(Locale.US, "%s\n%.2f / %.2f GB", message, done / 1073741824.0, total / 1073741824.0) : message);
        });
    }

    // ---- small helpers ----

    private static long total(List<File> files) {
        long t = 0;
        for (File f : files) t += f.length();
        return t;
    }

    private static String gb(long bytes) { return String.format(Locale.US, "%.2f GB", bytes / 1073741824.0); }

    private static String shortPath(File f) { return f.getAbsolutePath().replace("/sdcard", Tr.t("Internal storage")).replace("/storage/emulated/0", Tr.t("Internal storage")); }
}
