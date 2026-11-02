package org.globalpoint.companion;

import android.app.ActivityManager;
import android.content.Context;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;

/** Whether the server answers on 127.0.0.1:8000, and whether it's this app's. Call off the main thread. */
final class ServerProbe {
    static final String URL_ROOT = "http://127.0.0.1:8000/";

    private ServerProbe() {}

    /** Something answers on 127.0.0.1:8000 (this app's server, or another one such as an adb-forwarded PC). */
    static boolean running() {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(URL_ROOT).openConnection();
            c.setConnectTimeout(500);
            c.setReadTimeout(1500);
            int code = c.getResponseCode();
            c.disconnect();
            return code > 0;
        } catch (Exception e) {
            return false;
        }
    }

    /** This app's server process (":node") exists. */
    static boolean ownProcess(Context c) {
        ActivityManager am = c.getSystemService(ActivityManager.class);
        List<ActivityManager.RunningAppProcessInfo> list = am.getRunningAppProcesses();
        if (list == null) return false;
        String name = c.getPackageName() + ":node";
        for (ActivityManager.RunningAppProcessInfo p : list) if (name.equals(p.processName)) return true;
        return false;
    }

    /** Stops this app's server and waits (up to 10 s) until its process is gone. */
    static void stopAndWait(Context c) throws InterruptedException {
        if (!ownProcess(c)) return;
        ServerService.stop(c);
        for (int i = 0; i < 50 && ownProcess(c); i++) Thread.sleep(200);
    }
}
