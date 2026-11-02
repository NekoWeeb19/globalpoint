package org.globalpoint.companion;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
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
        web.setBackgroundColor(0xFF171306);
        web.setWebViewClient(new WebViewClient() {
            // Always the dashboard's dark scheme, even on a phone in light mode or with an older
            // WebView: its stylesheet switches with @media (prefers-color-scheme: dark), so that
            // condition is made to always apply as the stylesheet loads (the server's files stay as they are).
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                boolean local = "127.0.0.1".equals(url.getHost()) || "localhost".equals(url.getHost());
                if (!local || url.getPath() == null || !url.getPath().endsWith(".css") || !"GET".equals(request.getMethod())) return null;
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(url.toString()).openConnection();
                    try (InputStream in = c.getInputStream()) {
                        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                        byte[] b = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(b)) > 0) out.write(b, 0, n);
                        String css = out.toString("UTF-8").replaceAll("@media\\s*\\(\\s*prefers-color-scheme\\s*:\\s*dark\\s*\\)", "@media all");
                        return new WebResourceResponse("text/css", "UTF-8", new java.io.ByteArrayInputStream(css.getBytes("UTF-8")));
                    } finally {
                        c.disconnect();
                    }
                } catch (Exception e) {
                    return null; // let the WebView load it as it is
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

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
