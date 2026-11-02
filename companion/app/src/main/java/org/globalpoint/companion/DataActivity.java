package org.globalpoint.companion;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.Locale;

/**
 * First-time data: copy the server's slim data set (and optionally the save, game updates,
 * dashboard pictures, comics) from a PC running StarPoint, or import a data zip. Stops the server
 * first, since the save may be replaced.
 */
public class DataActivity extends Activity {
    private static final int PICK_ZIP = 1;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private TextView summary, status;
    private ProgressBar bar;
    private EditText host;
    private CheckBox save, patches, images, comics;
    private Button download, importZip;
    private SharedPreferences prefs;
    private ScrollView scroll;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        setTitle("Game data");
        prefs = getSharedPreferences("companion", MODE_PRIVATE);
        Ui u = new Ui(this);

        u.text("The game keeps its own ~10 GB of files. The server on this phone only needs a small "
                + "set (~25 MB) from the StarPoint you set the game up with, plus anything you pick below.", 14);
        summary = u.text("", 15);

        u.heading("Copy from your PC's StarPoint (same Wi-Fi)");
        u.text("Start StarPoint on the PC, then enter its address as the phone sees it.", 13);
        host = new EditText(this);
        host.setHint("192.168.1.20:8000");
        host.setSingleLine(true);
        host.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        host.setText(prefs.getString("pcHost", ""));
        u.add(host);
        save = u.check("My save (account, units, progress)", prefs.getBoolean("optSave", true));
        images = u.check("Dashboard pictures (~80 MB)", prefs.getBoolean("optImages", true));
        comics = u.check("Comics (~1.4 GB)", prefs.getBoolean("optComics", false));
        patches = u.check("Game updates (~2 GB; only if the game still has to download them)", prefs.getBoolean("optPatches", false));
        download = u.button("Download from PC", this::startDownload);

        u.heading("Or import a data zip");
        u.text("A zip with .database/ and .cdn/ folders (and optionally .env), e.g. from the shared package.", 13);
        importZip = u.button("Choose zip...", () -> {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/zip", "application/x-zip-compressed", "application/octet-stream"});
            startActivityForResult(i, PICK_ZIP);
        });

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(1000);
        bar.setVisibility(View.GONE);
        u.add(bar);
        status = u.text("", 13);

        scroll = new ScrollView(this);
        scroll.addView(u.root);
        setContentView(scroll);
        refresh();
    }

    private void refresh() { summary.setText(DataTransfer.summary(this)); }

    private void busy(boolean on) {
        download.setEnabled(!on);
        importZip.setEnabled(!on);
        bar.setVisibility(on ? View.VISIBLE : View.GONE);
    }

    private void progress(String message, long done, long total) {
        ui.post(() -> {
            bar.setIndeterminate(total <= 0);
            if (total > 0) bar.setProgress((int) (1000 * Math.min(done, total) / total));
            status.setText(total > 0 ? String.format(Locale.US, "%s\n%.1f / %.1f MB", message, done / 1048576.0, total / 1048576.0) : message);
        });
    }

    private void startDownload() {
        String address = host.getText().toString().trim();
        if (address.isEmpty()) { status.setText("Enter the PC's address first."); return; }
        prefs.edit().putString("pcHost", address).putBoolean("optSave", save.isChecked()).putBoolean("optImages", images.isChecked())
                .putBoolean("optComics", comics.isChecked()).putBoolean("optPatches", patches.isChecked()).apply();
        DataTransfer.Options o = new DataTransfer.Options();
        o.save = save.isChecked();
        o.images = images.isChecked();
        o.comics = comics.isChecked();
        o.patches = patches.isChecked();
        run(() -> {
            int n = DataTransfer.downloadFromPc(this, address, o, this::progress);
            return "Downloaded " + n + " file(s). Press Start on the main screen.";
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent result) {
        super.onActivityResult(requestCode, resultCode, result);
        if (requestCode != PICK_ZIP || resultCode != RESULT_OK || result == null || result.getData() == null) return;
        Uri uri = result.getData();
        run(() -> {
            int n = DataTransfer.importZip(this, uri, this::progress);
            return "Imported " + n + " file(s). Press Start on the main screen.";
        });
    }

    interface Job { String run() throws Exception; }

    private void run(Job job) {
        busy(true);
        scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
        new Thread(() -> {
            String result;
            try {
                if (ServerProbe.ownProcess(this)) {
                    progress("Stopping the server first...", 0, -1);
                    ServerProbe.stopAndWait(this);
                }
                result = job.run();
            } catch (Exception e) {
                result = "Failed: " + e.getMessage();
            }
            String message = result;
            ui.post(() -> { busy(false); status.setText(message); refresh(); });
        }, "data-transfer").start();
    }
}
