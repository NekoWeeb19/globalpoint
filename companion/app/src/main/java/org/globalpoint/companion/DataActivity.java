package org.globalpoint.companion;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.view.WindowManager;
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
    private static final int PICK_ZIP = 1, PICK_COMICS = 3;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private TextView summary, status;
    private ProgressBar bar;
    private EditText host;
    private static final String GAME = "com.leiting.wf";
    private CheckBox save, patches, images, comics, schedule, game;
    private Button download, importZip, comicsPack;
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
        schedule = u.check("Event schedule editing (~140 MB; lets the dashboard move events)", prefs.getBoolean("optSchedule", true));
        patches = u.check("Game updates (~2 GB; only if the game still has to download them)", prefs.getBoolean("optPatches", false));
        game = u.check("Full game files (~10 GB; first install, game not installed yet or never downloaded)", prefs.getBoolean("optGame", false));
        u.text("Full game files go in StarPoint/game on the phone's storage. The game (build 21 or newer) moves "
                + "them into its own storage when it starts, so it needs no download. This app and the game both need "
                + "\"All files access\" for it. Keep this screen open until it's done.", 13);
        download = u.button("Download from PC", this::startDownload);
        u.button("Allow World Flipper \"All files access\"", this::openGameAccess);

        u.heading("Or import a data zip");
        u.text("A zip with .database/ and .cdn/ folders (and optionally .env), e.g. from the shared package.", 13);
        importZip = u.button("Choose zip...", () -> {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/zip", "application/x-zip-compressed", "application/octet-stream"});
            startActivityForResult(i, PICK_ZIP);
        });

        u.heading("Comics without a PC");
        u.text("A comics pack (~1.4 GB, made on a PC with scripts/build_comics_pack.cjs) copied to this phone, "
                + "e.g. into Downloads. It's unpacked into the server's comics folder; the server can keep running.", 13);
        comicsPack = u.button("Comics pack...", () -> {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/zip", "application/x-zip-compressed", "application/octet-stream"});
            startActivityForResult(i, PICK_COMICS);
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

    private WifiManager.WifiLock wifiLock;

    private void busy(boolean on) {
        // a full game copy takes a while: keep the screen and Wi-Fi awake meanwhile
        if (on) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            try {
                WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
                wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "companion:copy");
                wifiLock.acquire();
            } catch (Exception ignored) { wifiLock = null; }
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
            wifiLock = null;
        }
        download.setEnabled(!on);
        importZip.setEnabled(!on);
        comicsPack.setEnabled(!on);
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
                .putBoolean("optComics", comics.isChecked()).putBoolean("optPatches", patches.isChecked()).putBoolean("optSchedule", schedule.isChecked())
                .putBoolean("optGame", game.isChecked()).apply();
        if (game.isChecked() && !canWriteStorage()) { askStorage(); return; }
        DataTransfer.Options o = new DataTransfer.Options();
        o.save = save.isChecked();
        o.images = images.isChecked();
        o.comics = comics.isChecked();
        o.patches = patches.isChecked();
        o.schedule = schedule.isChecked();
        o.game = game.isChecked();
        run(() -> {
            int n = DataTransfer.downloadFromPc(this, address, o, this::progress);
            String next = o.game
                    ? "\n\nThe game files are in " + DataTransfer.gameDropOff() + ". Next:\n"
                      + "1. Install World Flipper (build 21 or newer) if it isn't yet.\n"
                      + "2. Allow it \"All files access\" (button above; the game never asks by itself).\n"
                      + "3. Start the server here, then open the game: it moves the files in (a few minutes) and needs no download."
                    : " Back on the main screen the server starts.";
            return "Downloaded " + n + " file(s)." + next + (o.notes.isEmpty() ? "" : "\n\nNote from the PC:\n" + o.notes);
        });
    }

    /** Whether this app may write the game's drop-off folder in shared storage. */
    private boolean canWriteStorage() {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        return checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    /** Set while the player is in the permission screen: the download goes on once they're back with it allowed. */
    private boolean waitingForStorage;

    @Override
    protected void onResume() {
        super.onResume();
        if (waitingForStorage && canWriteStorage()) {
            waitingForStorage = false;
            startDownload();
        } else if (waitingForStorage) {
            waitingForStorage = false;
            status.setText("\"All files access\" is still off, so the game files can't be copied. Allow it, or untick Full game files.");
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != 2) return;
        waitingForStorage = false;
        if (canWriteStorage()) startDownload();
        else status.setText("Storage access is off, so the game files can't be copied. Allow it, or untick Full game files.");
    }

    private void askStorage() {
        waitingForStorage = Build.VERSION.SDK_INT >= 30;
        if (Build.VERSION.SDK_INT >= 30) {
            status.setText("Allow \"All files access\" for StarPoint Companion, come back and press Download again.");
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getPackageName())));
            } catch (ActivityNotFoundException e) {
                startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
            }
        } else {
            status.setText("Allow storage access, then press Download again.");
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE, Manifest.permission.READ_EXTERNAL_STORAGE}, 2);
        }
    }

    /** Opens the game's own storage permission screen (it reads the drop-off folder but never asks). */
    private void openGameAccess() {
        try {
            getPackageManager().getPackageInfo(GAME, 0);
        } catch (PackageManager.NameNotFoundException e) {
            status.setText("World Flipper isn't installed yet: install it first, then press this again.");
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + GAME)));
            } else {
                status.setText("In the game's app info, open Permissions and allow Storage.");
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + GAME)));
            }
        } catch (ActivityNotFoundException e) {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + GAME)));
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent result) {
        super.onActivityResult(requestCode, resultCode, result);
        if (resultCode != RESULT_OK || result == null || result.getData() == null) return;
        Uri uri = result.getData();
        if (requestCode == PICK_COMICS) {
            run(() -> {
                DataTransfer.PackResult r = DataTransfer.importComicsPack(this, uri, this::progress);
                ui.post(() -> offerDelete(uri, r.packBytes));
                return "Comics ready: " + r.written + " file(s) unpacked" + (r.skipped > 0 ? ", " + r.skipped + " already here" : "")
                        + ". They show in the game under Menu > Other > Comics.";
            }, false);
            return;
        }
        if (requestCode != PICK_ZIP) return;
        run(() -> {
            int n = DataTransfer.importZip(this, uri, this::progress);
            return "Imported " + n + " file(s). Press Start on the main screen.";
        });
    }

    /** After a comics pack import: offer to delete the pack, if the place it came from allows that. */
    private void offerDelete(Uri uri, long bytes) {
        boolean canDelete = false;
        try (android.database.Cursor cur = getContentResolver().query(uri, new String[]{android.provider.DocumentsContract.Document.COLUMN_FLAGS}, null, null, null)) {
            if (cur != null && cur.moveToFirst()) canDelete = (cur.getInt(0) & android.provider.DocumentsContract.Document.FLAG_SUPPORTS_DELETE) != 0;
        } catch (Exception ignored) { }
        String size = bytes > 0 ? String.format(Locale.US, " (%.1f GB)", bytes / 1073741824.0) : "";
        if (!canDelete) {
            status.append("\n\nThe pack" + size + " can be deleted now. This app isn't allowed to delete it there, so delete it in your Files app.");
            return;
        }
        new android.app.AlertDialog.Builder(this)
                .setTitle("Delete the comics pack?")
                .setMessage("The comics are unpacked, so the pack" + size + " isn't needed any more.")
                .setPositiveButton("Delete", (d, w) -> {
                    boolean deleted = false;
                    try { deleted = android.provider.DocumentsContract.deleteDocument(getContentResolver(), uri); } catch (Exception ignored) { }
                    status.append(deleted ? "\n\nThe pack was deleted." : "\n\nCouldn't delete the pack; delete it in your Files app.");
                })
                .setNegativeButton("Keep", null)
                .show();
    }

    interface Job { String run() throws Exception; }

    private void run(Job job) { run(job, true); }

    /** Runs a job off the main thread; stopServer: stop the server first (when the save may be replaced). */
    private void run(Job job, boolean stopServer) {
        busy(true);
        scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
        new Thread(() -> {
            String result;
            try {
                if (stopServer && ServerProbe.ownProcess(this)) {
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
