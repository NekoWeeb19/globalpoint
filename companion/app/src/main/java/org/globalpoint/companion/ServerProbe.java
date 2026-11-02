package org.globalpoint.companion;

import java.net.HttpURLConnection;
import java.net.URL;

/** Whether the server answers on 127.0.0.1:8000. Call off the main thread. */
final class ServerProbe {
    static final String URL_ROOT = "http://127.0.0.1:8000/";

    private ServerProbe() {}

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
}
