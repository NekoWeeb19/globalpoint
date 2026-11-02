package org.globalpoint.companion;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.File;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Start/stop, server status, the dashboard button and the end of the server log. */
public class MainActivity extends Activity {
    static final String SERVER_URL = "http://127.0.0.1:8000/";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private TextView status, log;
    private ScrollView logScroll;
    private boolean visible;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("StarPoint Companion");
        title.setTextSize(22);
        root.addView(title);

        status = new TextView(this);
        status.setTextSize(16);
        status.setPadding(0, pad / 2, 0, pad / 2);
        root.addView(status);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.addView(button("Start", () -> {
            Intent i = new Intent(this, ServerService.class);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
        }));
        buttons.addView(button("Stop", () -> stopService(new Intent(this, ServerService.class))));
        buttons.addView(button("Dashboard", () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(SERVER_URL)))));
        root.addView(buttons);

        logScroll = new ScrollView(this);
        log = new TextView(this);
        log.setTypeface(Typeface.MONOSPACE);
        log.setTextSize(11);
        logScroll.addView(log);
        root.addView(logScroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        setContentView(root);
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
    }

    private Button button(String text, Runnable onClick) {
        Button b = new Button(this);
        b.setText(text);
        b.setOnClickListener(v -> onClick.run());
        return b;
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
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
            String state = probe();
            String tail = tail(ServerFiles.logFile(this), 6000);
            ui.post(() -> {
                status.setText(state);
                boolean atEnd = logScroll.getChildAt(0).getBottom() <= logScroll.getHeight() + logScroll.getScrollY() + 40;
                log.setText(tail);
                if (atEnd) logScroll.post(() -> logScroll.fullScroll(ScrollView.FOCUS_DOWN));
                ui.postDelayed(this::refresh, 1000);
            });
        });
    }

    private static String probe() {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(SERVER_URL).openConnection();
            c.setConnectTimeout(500);
            c.setReadTimeout(1500);
            int code = c.getResponseCode();
            c.disconnect();
            return "Server: running on 127.0.0.1:8000 (HTTP " + code + ")";
        } catch (Exception e) {
            return "Server: not answering";
        }
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
