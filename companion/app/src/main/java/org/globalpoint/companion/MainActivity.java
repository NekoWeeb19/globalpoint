package org.globalpoint.companion;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
    private Button battery;
    private ScrollView logScroll;
    private SharedPreferences prefs;
    private boolean visible, autoStarted;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences("companion", MODE_PRIVATE);
        Ui u = new Ui(this);

        status = u.text("", 16);
        data = u.text("", 14);

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

        battery = u.button("Let the server run in the background", this::askBattery);
        CheckBox auto = u.check("Start the server when this app opens", prefs.getBoolean("autoStart", true));
        auto.setOnCheckedChangeListener((b, on) -> prefs.edit().putBoolean("autoStart", on).apply());
        // for phones whose battery saver still stops the server while the game is in front (like Termux's wake lock)
        CheckBox awake = u.check("Keep the server awake while it runs (for strict battery savers; uses more battery)", prefs.getBoolean(ServerService.KEEP_AWAKE, false));
        awake.setOnCheckedChangeListener((b, on) -> {
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

    private static final int EXPORT_SAVE = 10, IMPORT_SAVE = 11;

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
            String tail = tail(ServerFiles.logFile(this), 6000);
            ui.post(() -> {
                status.setText(own && up ? "Server: running on 127.0.0.1:8000"
                        : own ? "Server: starting..."
                        : up ? "Server: stopped (another server answers on port 8000, e.g. a PC through adb)"
                        : "Server: stopped");
                boolean atEnd = logScroll.getChildAt(0).getBottom() <= logScroll.getHeight() + logScroll.getScrollY() + 40;
                log.setText(tail);
                if (atEnd) logScroll.post(() -> logScroll.fullScroll(ScrollView.FOCUS_DOWN));
                ui.postDelayed(this::refresh, 1000);
            });
        });
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
