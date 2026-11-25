package org.globalpoint.companion;

import java.util.Locale;

/**
 * The app's text in the phone's language: English, or Simplified Chinese (ZhStrings) when the phone (or this app's
 * own language setting) is Chinese. The English is the key, written in place in the code; a text with numbers or
 * names in it is a format ("Save exported (%d files)") and its Chinese has the same %s / %d in the same order.
 * Anything not in the table stays English. scripts/check_companion_zh.cjs checks every Tr.t text has its Chinese.
 */
final class Tr {
    private Tr() { }

    /** Whether the app shows Chinese (any Chinese locale: the table is Simplified Chinese). */
    static boolean zh() {
        return "zh".equals(Locale.getDefault().getLanguage());
    }

    static String t(String en, Object... args) {
        String text = zh() ? ZhStrings.get(en) : en;
        if (text == null) text = en;
        return args.length == 0 ? text : String.format(Locale.US, text, args);
    }
}
