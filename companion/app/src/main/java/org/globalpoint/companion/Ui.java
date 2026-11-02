package org.globalpoint.companion;

import android.app.Activity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Small helper to build the app's simple screens in code. */
final class Ui {
    final LinearLayout root;
    private final Activity a;
    final int pad;

    Ui(Activity a) {
        this.a = a;
        pad = (int) (16 * a.getResources().getDisplayMetrics().density);
        root = new LinearLayout(a);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);
    }

    <T extends View> T add(T v) { root.addView(v); return v; }

    TextView text(String s, int size) {
        TextView t = new TextView(a);
        t.setText(s);
        t.setTextSize(size);
        t.setPadding(0, pad / 4, 0, pad / 4);
        return add(t);
    }

    TextView heading(String s) {
        TextView t = text(s, 17);
        t.setPadding(0, pad, 0, pad / 4);
        return t;
    }

    CheckBox check(String s, boolean on) {
        CheckBox c = new CheckBox(a);
        c.setText(s);
        c.setChecked(on);
        return add(c);
    }

    Button button(String s, Runnable onClick) {
        Button b = new Button(a);
        b.setText(s);
        b.setOnClickListener(v -> onClick.run());
        return add(b);
    }
}
