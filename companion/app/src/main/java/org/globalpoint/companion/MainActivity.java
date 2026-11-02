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

        battery = u.button("Let the server run in the background", this::askBattery);
        CheckBox auto = u.check("Start the server when this app opens", prefs.getBoolean("autoStart", true));
        auto.setOnCheckedChangeListener((b, on) -> prefs.edit().putBoolean("autoStart", on).apply());

        logScroll = new ScrollView(this);
        log = new TextView(this);
        log.setTypeface(Typeface.MONOSPACE);
        log.setTextSize(11);
        logScroll.addView(log);
        u.root.addView(logScroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        setContentView(u.root);
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
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
            boolean up = ServerProbe.running();
            String tail = tail(ServerFiles.logFile(this), 6000);
            ui.post(() -> {
                status.setText(up ? "Server: running on 127.0.0.1:8000" : "Server: stopped");
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
