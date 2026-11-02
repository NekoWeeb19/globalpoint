package org.globalpoint.companion;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.Process;
import android.util.Log;

/**
 * Runs the StarPoint server on 127.0.0.1:8000 as a foreground service, so it keeps running while the
 * game is in front. Lives in its own process (":node", see AndroidManifest.xml) because Node starts
 * only once per process: stopping the service ends that process, and the next start gets a new one.
 */
public class ServerService extends Service {
    private static final String CHANNEL = "server";
    private static boolean nodeStarted = false;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
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
        try {
            ServerFiles.prepare(this);
            String main = ServerFiles.serverDir(this).getAbsolutePath() + "/companion-main.js";
            int code = NodeBridge.startNode("node", main, ServerFiles.dataDir(this).getAbsolutePath());
            ServerFiles.log(this, "[companion] node exited with code " + code);
        } catch (Throwable t) {
            Log.e("companion", "server failed", t);
            ServerFiles.log(this, "[companion] server failed: " + t);
        }
        stopSelf();
        Process.killProcess(Process.myPid());
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
        Notification n = b.setContentTitle("StarPoint server is running")
                .setContentText("127.0.0.1:8000 - tap to open the companion")
                .setSmallIcon(android.R.drawable.stat_sys_upload_done)
                .setContentIntent(open)
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
