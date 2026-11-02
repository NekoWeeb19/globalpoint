package org.globalpoint.companion;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.Process;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Runs the StarPoint server on 127.0.0.1:8000 as a foreground service, so it keeps running while the
 * game is in front. Lives in its own process (":node", see AndroidManifest.xml) because Node starts
 * only once per process: stopping the service ends that process, and the next start gets a new one.
 *
 * If the system kills the process, START_STICKY brings it back. If Node itself stops with an error,
 * the process ends without stopping the service, so Android restarts it too, unless that already
 * happened 3 times in 2 minutes (then it stays stopped and the log says why).
 */
public class ServerService extends Service {
    static final String ACTION_STOP = "org.globalpoint.companion.STOP";
    private static final String CHANNEL = "server";
    private static final long CRASH_WINDOW_MS = 2 * 60 * 1000;
    private static final int CRASH_LIMIT = 3;
    private static boolean nodeStarted = false;

    static void start(Context c) {
        Intent i = new Intent(c, ServerService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, ServerService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        goForeground();
        synchronized (ServerService.class) {
            if (!nodeStarted) {
                nodeStarted = true;
                new Thread(null, this::runNode, "node", 16 * 1024 * 1024).start();
            }
        }
        return START_STICKY;
    }

    private void runNode() {
        int code = -1;
        try {
            ServerFiles.prepare(this);
            String main = ServerFiles.serverDir(this).getAbsolutePath() + "/companion-main.js";
            code = NodeBridge.startNode("node", main, ServerFiles.dataDir(this).getAbsolutePath());
            ServerFiles.log(this, "[companion] node exited with code " + code);
        } catch (Throwable t) {
            Log.e("companion", "server failed", t);
            ServerFiles.log(this, "[companion] server failed: " + t);
        }
        if (code == 0 || tooManyCrashes()) {
            if (code != 0) ServerFiles.log(this, "[companion] stopped " + CRASH_LIMIT + " times in a row; not restarting. Press Start to try again.");
            stopSelf();
        } else {
            ServerFiles.log(this, "[companion] restarting...");
        }
        Process.killProcess(Process.myPid());
    }

    // remembers recent crash times in data/crashes.txt; true when there were too many
    private boolean tooManyCrashes() {
        File f = new File(ServerFiles.dataDir(this), "crashes.txt");
        long now = System.currentTimeMillis();
        List<Long> recent = new ArrayList<>();
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = new byte[4096];
            int n = in.read(b);
            if (n > 0) for (String s : new String(b, 0, n).split("\n")) {
                try { long t = Long.parseLong(s.trim()); if (now - t < CRASH_WINDOW_MS) recent.add(t); } catch (NumberFormatException ignored) { }
            }
        } catch (IOException ignored) { }
        recent.add(now);
        try (FileWriter w = new FileWriter(f)) {
            for (long t : recent) w.write(t + "\n");
        } catch (IOException ignored) { }
        if (recent.size() >= CRASH_LIMIT) { f.delete(); return true; }
        return false;
    }

    private void goForeground() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Server", NotificationManager.IMPORTANCE_LOW));
            b = new Notification.Builder(this, CHANNEL);
        } else {
            b = new Notification.Builder(this);
        }
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, ServerService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        Notification n = b.setContentTitle("StarPoint server is running")
                .setContentText("127.0.0.1:8000 - tap to open the companion")
                .setSmallIcon(R.drawable.ic_notification)
                .setContentIntent(open)
                .addAction(new Notification.Action.Builder(null, "Stop", stop).build())
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, n);
    }

    @Override
    public void onDestroy() {
        // Node can't be stopped and started again in one process
        Process.killProcess(Process.myPid());
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
