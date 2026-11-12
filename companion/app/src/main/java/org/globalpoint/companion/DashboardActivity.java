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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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
                    // any file: the page's accept=".json" becomes a type filter, and Android often doesn't type a .json
                    // file as JSON, so the kit and mail files showed greyed out and couldn't be picked (player report)
                    Intent pick = params.createIntent();
                    pick.setType("*/*");
                    pick.removeExtra(Intent.EXTRA_MIME_TYPES);
                    startActivityForResult(pick, PICK_FILE);
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
            // the type without "; charset=...", which Android's lookups don't match
            String type = mimeType == null ? "" : mimeType.split(";")[0].trim();
            if (type.isEmpty()) type = "application/octet-stream";
            i.setType(type);
            i.putExtra(Intent.EXTRA_TITLE, downloadName(url, contentDisposition, type));
            startActivityForResult(i, SAVE_FILE);
        });
        setContentView(web);
        if (saved != null) web.restoreState(saved);
        else web.loadUrl(ServerProbe.URL_ROOT);
    }

    /**
     * The file name the server gave (Content-Disposition filename="..."). Android's own guess can turn a .json
     * into .bin, so it's only the fallback, with .json kept for JSON.
     */
    static String downloadName(String url, String contentDisposition, String type) {
        if (contentDisposition != null) {
            Matcher m = Pattern.compile("filename\\s*=\\s*\"?([^\";]+)\"?", Pattern.CASE_INSENSITIVE).matcher(contentDisposition);
            if (m.find()) {
                String name = m.group(1).trim().replaceAll("[\\\\/:*?<>|]", "_");
                if (!name.isEmpty()) return name;
            }
        }
        String guess = URLUtil.guessFileName(url, contentDisposition, type);
        if (type.equals("application/json") && !guess.toLowerCase().endsWith(".json")) {
            int dot = guess.lastIndexOf('.');
            guess = (dot > 0 ? guess.substring(0, dot) : guess) + ".json";
        }
        return guess;
    }

    /** A picked file copied into the app's cache (keeping its name), as a file:// Uri; null when it can't be read. */
    private Uri copyPicked(Uri uri, int index) {
        String name = "picked-" + index;
        try (android.database.Cursor c = getContentResolver().query(uri, new String[] { android.provider.OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && c.getString(0) != null) name = c.getString(0);
        } catch (Exception ignored) { }
        name = name.replaceAll("[\\\\/:*?<>|\"]", "_");
        java.io.File dir = new java.io.File(getCacheDir(), "picked/" + System.currentTimeMillis() + "-" + index);
        java.io.File old = new java.io.File(getCacheDir(), "picked");
        if (index == 0 && old.isDirectory()) deleteTree(old);
        if (!dir.mkdirs() && !dir.isDirectory()) return null;
        java.io.File file = new java.io.File(dir, name);
        try (InputStream in = getContentResolver().openInputStream(uri); OutputStream outStream = new java.io.FileOutputStream(file)) {
            if (in == null) return null;
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) outStream.write(buf, 0, n);
        } catch (Exception e) {
            return null;
        }
        return Uri.fromFile(file);
    }

    private static void deleteTree(java.io.File f) {
        java.io.File[] kids = f.listFiles();
        if (kids != null) for (java.io.File k : kids) deleteTree(k);
        f.delete();
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
            Uri[] picked = WebChromeClient.FileChooserParams.parseResult(resultCode, result);
            ValueCallback<Uri[]> callback = pendingUpload;
            pendingUpload = null;
            if (picked == null || picked.length == 0) { callback.onReceiveValue(picked); return; }
            // the page gets the app's own copy: some file managers (Xiaomi's, a player report) give the WebView a
            // file it reads as 0 bytes ("the file is empty"), while the app can read it through ContentResolver
            new Thread(() -> {
                Uri[] out = new Uri[picked.length];
                for (int i = 0; i < picked.length; i++) {
                    Uri copy = copyPicked(picked[i], i);
                    out[i] = copy != null ? copy : picked[i];
                }
                runOnUiThread(() -> callback.onReceiveValue(out));
            }).start();
        } else if (requestCode == SAVE_FILE && resultCode == RESULT_OK && result != null && pendingDownload != null) {
            Uri target = result.getData();
            String url = pendingDownload;
            pendingDownload = null;
            new Thread(() -> {
                String message;
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    try (InputStream in = c.getInputStream(); OutputStream out = getContentResolver().openOutputStream(target, "wt")) {
                        // "wt": saving over an older file replaces it ("w" can leave the old file's tail behind)
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
