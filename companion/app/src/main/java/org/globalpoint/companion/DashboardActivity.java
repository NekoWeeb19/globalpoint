package org.globalpoint.companion;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * The server's dashboard (http://127.0.0.1:8000/) inside the app, so no browser setup screens get in
 * the way. File fields open the system file picker; downloads (e.g. a save export) are saved where
 * the player picks. Links to other sites open in the browser.
 */
public class DashboardActivity extends Activity {
    private static final int PICK_FILE = 1, SAVE_FILE = 2;

    private WebView web;
    private ValueCallback<Uri[]> pendingUpload;
    private String pendingDownload;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        setTitle("Dashboard");
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        // light or dark like the phone: with targetSdk 33+ the WebView reports prefers-color-scheme from the
        // app theme (values / values-night), and the dashboard's own dark colors apply. No automatic
        // darkening on top (off by default at this target; said explicitly so pages aren't darkened twice).
        web.setBackgroundColor(getColor(R.color.surface));
        if (Build.VERSION.SDK_INT >= 33) s.setAlgorithmicDarkeningAllowed(false);
        // a page cached in the other mode must not show: clear the cache once when the mode differs from last time
        android.content.SharedPreferences prefs = getSharedPreferences("companion", MODE_PRIVATE);
        if (prefs.getBoolean("dashboardNight", false) != isNight()) {
            web.clearCache(true);
            prefs.edit().putBoolean("dashboardNight", isNight()).apply();
        }
        web.setWebViewClient(new WebViewClient() {
            // Below Android 13 the WebView may not report dark from the app theme (Android 9 has no
            // isLightTheme at all, and setForceDark is ignored for apps targeting 33+), so in dark mode the
            // stylesheet's @media (prefers-color-scheme: dark) block is made to apply as it loads. In light
            // mode, and on 13+, the stylesheet is left alone.
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (Build.VERSION.SDK_INT >= 33 || !isNight()) return null; // the mode as it is now, per request
                Uri url = request.getUrl();
                boolean local = "127.0.0.1".equals(url.getHost()) || "localhost".equals(url.getHost());
                if (!local || url.getPath() == null || !url.getPath().endsWith(".css") || !"GET".equals(request.getMethod())) return null;
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(url.toString()).openConnection();
                    try (InputStream in = c.getInputStream()) {
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        byte[] b = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(b)) > 0) out.write(b, 0, n);
                        String css = out.toString("UTF-8").replaceAll("@media\\s*\\(\\s*prefers-color-scheme\\s*:\\s*dark\\s*\\)", "@media all");
                        java.util.Map<String, String> headers = new java.util.HashMap<>();
                        headers.put("Cache-Control", "no-store"); // never reused in light mode
                        return new WebResourceResponse("text/css", "UTF-8", 200, "OK", headers, new ByteArrayInputStream(css.getBytes("UTF-8")));
                    } finally {
                        c.disconnect();
                    }
                } catch (Exception e) {
                    return null; // the WebView loads it as it is
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("127.0.0.1".equals(url.getHost()) || "localhost".equals(url.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, url));
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingUpload != null) pendingUpload.onReceiveValue(null);
                pendingUpload = callback;
                try {
                    startActivityForResult(params.createIntent(), PICK_FILE);
                } catch (Exception e) {
                    pendingUpload = null;
                    return false;
                }
                return true;
            }
        });
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> {
            pendingDownload = url;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType(mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType);
            i.putExtra(Intent.EXTRA_TITLE, URLUtil.guessFileName(url, contentDisposition, mimeType));
            startActivityForResult(i, SAVE_FILE);
        });
        setContentView(web);
        if (saved != null) web.restoreState(saved);
        else web.loadUrl(ServerProbe.URL_ROOT);
    }

    private boolean isNight() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent result) {
        super.onActivityResult(requestCode, resultCode, result);
        if (requestCode == PICK_FILE && pendingUpload != null) {
            pendingUpload.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, result));
            pendingUpload = null;
        } else if (requestCode == SAVE_FILE && resultCode == RESULT_OK && result != null && pendingDownload != null) {
            Uri target = result.getData();
            String url = pendingDownload;
            pendingDownload = null;
            new Thread(() -> {
                String message;
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    try (InputStream in = c.getInputStream(); OutputStream out = getContentResolver().openOutputStream(target)) {
                        byte[] b = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(b)) > 0) out.write(b, 0, n);
                    } finally {
                        c.disconnect();
                    }
                    message = "Saved";
                } catch (Exception e) {
                    message = "Not saved: " + e.getMessage();
                }
                String m = message;
                runOnUiThread(() -> Toast.makeText(this, m, Toast.LENGTH_SHORT).show());
            }).start();
        }
    }

    // Back leaves the dashboard at once (back to the app), instead of stepping through its pages like a browser
    @Override
    public void onBackPressed() {
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
