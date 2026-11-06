package org.globalpoint.companion;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AppOpsManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.File;
import java.io.RandomAccessFile;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Start/stop, server status, dashboard, game data, battery setting and the end of the server log. */
public class MainActivity extends Activity {
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private TextView status, data, log;
    private Button battery, usage;
    private ScrollView logScroll;
    private SharedPreferences prefs;
    private boolean visible, autoStarted, syncingAwake;
    private CheckBox awakeBox;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences("companion", MODE_PRIVATE);
        Ui u = new Ui(this);

        status = u.text("", 16);
        data = u.text("", 14);
        // first time here, or something isn't working: a checklist that fixes what it can
        u.button("Setup check", () -> startActivity(new Intent(this, SetupActivity.class)));

        LinearLayout row1 = row(u);
        row1.addView(button("Start", () -> ServerService.start(this)));
        row1.addView(button("Stop", () -> ServerService.stop(this)));
        row1.addView(button("Dashboard", () -> startActivity(new Intent(this, DashboardActivity.class))));
        LinearLayout row2 = row(u);
        row2.addView(button("Game data", () -> startActivity(new Intent(this, DataActivity.class))));
        row2.addView(button("Open in browser", () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(ServerProbe.URL_ROOT)))));

        LinearLayout row3 = row(u);
        row3.addView(button("Export save", this::exportSave));
        row3.addView(button("Import save", this::importSave));
        // for bug reports: one text file with the game's crash reports and the server's logs, to send
        u.button("Save logs (for a bug report)", this::saveLogs);

        battery = u.button("Let the server run in the background", this::askBattery);
        // some phones' battery savers stop the server unless the app has usage access (as with Termux)
        usage = u.button("Allow usage access (if the server still stops in the background)", this::askUsage);
        CheckBox auto = u.check("Start the server when this app opens", prefs.getBoolean("autoStart", true));
        auto.setOnCheckedChangeListener((b, on) -> prefs.edit().putBoolean("autoStart", on).apply());
        // for phones whose battery saver still stops the server while the game is in front (like Termux's wake lock)
        awakeBox = u.check("Keep the server awake while it runs (for strict battery savers; uses more battery)", prefs.getBoolean(ServerService.KEEP_AWAKE, false));
        awakeBox.setOnCheckedChangeListener((b, on) -> {
            if (syncingAwake) return;
            prefs.edit().putBoolean(ServerService.KEEP_AWAKE, on).commit();
            ServerService.applyWake(this);
        });
        // where phone makers keep "Unrestricted" battery use and auto-start
        u.button("Battery and auto-start settings", this::openAppSettings);

        logScroll = new ScrollView(this);
        log = new TextView(this);
        log.setTypeface(Typeface.MONOSPACE);
        log.setTextSize(11);
        logScroll.addView(log);
        u.root.addView(logScroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        setContentView(u.root);
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
    }

    private static final int EXPORT_SAVE = 10, IMPORT_SAVE = 11, SAVE_LOGS = 12;

    private void saveLogs() {
        String name = "globalpoint-logs-" + new java.text.SimpleDateFormat("yyyyMMdd-HHmm", java.util.Locale.US).format(new java.util.Date()) + ".txt";
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("text/plain");
        i.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(i, SAVE_LOGS);
    }

    /** The logs file: this app and phone, the game's crash reports in full, then the ends of the server's logs. */
    private void writeLogs(Uri uri) throws Exception {
        // kept in the data folder (companion-main.js links the server's logs folder there), so app updates keep them
        File logs = new File(ServerFiles.dataDir(this), "logs");
        StringBuilder s = new StringBuilder();
        String version = "?";
        try { version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception ignored) { }
        s.append("GlobalPoint logs, ").append(new java.util.Date()).append('\n')
                .append("Companion ").append(version).append(", Android ").append(Build.VERSION.RELEASE)
                .append(" (API ").append(Build.VERSION.SDK_INT).append("), ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append("\n\n");
        section(s, "Game crash reports (cn_crash.log)", new File(logs, "cn_crash.log"), 400_000);
        section(s, "Server log (server.log)", ServerFiles.logFile(this), 300_000);
        section(s, "Game requests (cn_requests.log)", new File(logs, "cn_requests.log"), 300_000);
        try (java.io.OutputStream out = getContentResolver().openOutputStream(uri)) {
            if (out == null) throw new java.io.IOException("can't write the file");
            out.write(s.toString().getBytes("UTF-8"));
        }
    }

    private static void section(StringBuilder s, String title, File f, int bytes) {
        s.append("===== ").append(title).append(" =====\n");
        String text = tail(f, bytes);
        s.append(text.isEmpty() ? "(none)\n" : text).append("\n\n");
    }

    private void exportSave() {
        String name = "starpoint-save-" + new java.text.SimpleDateFormat("yyyyMMdd-HHmm", java.util.Locale.US).format(new java.util.Date()) + ".zip";
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/zip");
        i.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(i, EXPORT_SAVE);
    }

    private void importSave() {
        new android.app.AlertDialog.Builder(this)
                .setTitle("Import a save?")
                .setMessage("This replaces the save on this phone (account, units, progress) with the one in the zip you pick. "
                        + "The server restarts. Export your current save first if you may want it back.")
                .setPositiveButton("Choose zip...", (d, w) -> {
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    startActivityForResult(i, IMPORT_SAVE);
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent result) {
        super.onActivityResult(requestCode, resultCode, result);
        if (resultCode != RESULT_OK || result == null || result.getData() == null) return;
        Uri uri = result.getData();
        if (requestCode == EXPORT_SAVE) {
            toast("Exporting the save...");
            worker.execute(() -> {
                try {
                    int n = SaveBackup.export(this, uri);
                    toast("Save exported (" + n + " files)");
                } catch (Exception e) {
                    // don't leave an empty or half-written file behind
                    try { android.provider.DocumentsContract.deleteDocument(getContentResolver(), uri); } catch (Exception ignored) { }
                    toast("Export failed: " + e.getMessage());
                }
            });
        } else if (requestCode == SAVE_LOGS) {
            worker.execute(() -> {
                try {
                    writeLogs(uri);
                    toast("Logs saved: send that file with your bug report");
                } catch (Exception e) {
                    try { android.provider.DocumentsContract.deleteDocument(getContentResolver(), uri); } catch (Exception ignored) { }
                    toast("Saving the logs failed: " + e.getMessage());
                }
            });
        } else if (requestCode == IMPORT_SAVE) {
            toast("Importing the save...");
            worker.execute(() -> {
                try {
                    ServerProbe.stopAndWait(this);
                    int n = SaveBackup.importSave(this, uri);
                    ServerFiles.log(this, "[companion] save imported (" + n + " files)");
                    ServerService.start(this);
                    toast("Save imported (" + n + " files); server restarting");
                } catch (Exception e) {
                    toast("Import failed: " + e.getMessage());
                }
            });
        }
    }

    private void toast(String message) {
        ui.post(() -> android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_LONG).show());
    }

    private LinearLayout row(Ui u) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        return u.add(r);
    }

    private Button button(String text, Runnable onClick) {
        Button b = new Button(this);
        b.setText(text);
        b.setOnClickListener(v -> onClick.run());
        return b;
    }

    private boolean batteryFree() {
        PowerManager pm = getSystemService(PowerManager.class);
        return Build.VERSION.SDK_INT < 23 || pm.isIgnoringBatteryOptimizations(getPackageName());
    }

    // the notification's Keep awake / Allow sleep button changes the setting in the server's process
    private void syncAwakeBox() {
        @SuppressWarnings("deprecation") boolean awakeNow = getSharedPreferences("companion", MODE_MULTI_PROCESS).getBoolean(ServerService.KEEP_AWAKE, false);
        syncingAwake = true;
        awakeBox.setChecked(awakeNow);
        syncingAwake = false;
    }

    // closing the notification shade over this screen doesn't resume it, but gives it the focus back
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && awakeBox != null) awakeBox.postDelayed(this::syncAwakeBox, 300);
    }

    @SuppressWarnings("deprecation")
    private boolean usageAllowed() {
        AppOpsManager ops = getSystemService(AppOpsManager.class);
        int mode = Build.VERSION.SDK_INT >= 29
                ? ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), getPackageName())
                : ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), getPackageName());
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    // Settings > Usage access, at this app's switch where the phone supports it, else the list
    private void askUsage() {
        try {
            startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));
        }
    }

    // This app's page in Android's settings: Battery ("Unrestricted"), and on some phones Auto-start / "Allow
    // background activity", which the battery-optimization prompt doesn't cover
    private void openAppSettings() {
        startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
    }

    // Without this, some phones stop the server a while after the screen turns off or the game is closed
    @SuppressLint("BatteryLife")
    private void askBattery() {
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        battery.setVisibility(batteryFree() ? View.GONE : View.VISIBLE);
        usage.setVisibility(usageAllowed() ? View.GONE : View.VISIBLE);
        syncAwakeBox();
        data.setText(DataTransfer.summary(this));
        // start once per screen visit, only when the data is there
        if (!autoStarted && prefs.getBoolean("autoStart", true) && new File(ServerFiles.dataDir(this), ".cdn/cn/path").exists()) {
            autoStarted = true;
            ServerService.start(this);
        }
        refresh();
    }

    @Override
    protected void onPause() {
        super.onPause();
        visible = false;
    }

    private void refresh() {
        if (!visible) return;
        worker.execute(() -> {
            boolean up = ServerProbe.running(), own = ServerProbe.ownProcess(this);
            Boolean rebuilding = up ? ServerProbe.updateRebuilding() : null;
            String tail = tail(ServerFiles.logFile(this), 6000);
            ui.post(() -> {
                // the ready light: green = open the game; yellow = wait (starting, or the game update is being rebuilt); red = stopped
                if (own && up && Boolean.TRUE.equals(rebuilding)) light(YELLOW, "Wait: the game update is being rebuilt. Open the game when this turns green.");
                else if (own && up) light(GREEN, "Ready: open the game. (Server on 127.0.0.1:8000)");
                else if (own) light(YELLOW, "Wait: the server is starting...");
                else if (up) light(YELLOW, "Stopped here (another server answers on port 8000, e.g. a PC through adb)");
                else light(RED, "Stopped: press Start.");
                boolean atEnd = logScroll.getChildAt(0).getBottom() <= logScroll.getHeight() + logScroll.getScrollY() + 40;
                log.setText(tail);
                if (atEnd) logScroll.post(() -> logScroll.fullScroll(ScrollView.FOCUS_DOWN));
                ui.postDelayed(this::refresh, 1000);
            });
        });
    }

    private static final int GREEN = 0xFF2E9E44, YELLOW = 0xFFE0A000, RED = 0xFFD32F2F;

    /** The status line with a coloured dot in front. */
    private void light(int color, String text) {
        android.text.SpannableString s = new android.text.SpannableString("●  " + text);
        s.setSpan(new android.text.style.ForegroundColorSpan(color), 0, 1, 0);
        s.setSpan(new android.text.style.RelativeSizeSpan(1.4f), 0, 1, 0);
        status.setText(s);
    }

    private static String tail(File f, int bytes) {
        if (!f.exists()) return "";
        try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
            long start = Math.max(0, r.length() - bytes);
            r.seek(start);
            byte[] b = new byte[(int) (r.length() - start)];
            r.readFully(b);
            return new String(b, "UTF-8");
        } catch (Exception e) {
            return "";
        }
    }
}
