package com.sofic.pizarra;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.DisplayMetrics;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;

/** Opens a fixed official URL. It never receives ChatGPT credentials or responses. */
public class ChatGPTActivity extends Activity {
    private static final int CHATGPT = 41;
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) return;
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int width = Math.min(Math.round(520 * metrics.density), Math.round(metrics.widthPixels * .65f));
        CustomTabsIntent tab = new CustomTabsIntent.Builder()
            .setInitialActivityWidthPx(width)
            .setInitialActivityHeightPx(Math.round(metrics.heightPixels * .9f))
            .setActivitySideSheetBreakpointDp(600)
            .setActivitySideSheetPosition(CustomTabsIntent.ACTIVITY_SIDE_SHEET_POSITION_END)
            .setActivitySideSheetMaximizationEnabled(true)
            .setCloseButtonPosition(CustomTabsIntent.CLOSE_BUTTON_POSITION_END)
            .setShowTitle(true)
            .build();
        String browser = CustomTabsClient.getPackageName(this, java.util.Collections.singletonList("com.android.chrome"));
        if (browser != null) tab.intent.setPackage(browser);
        tab.intent.setData(Uri.parse("https://chatgpt.com/"));
        try { startActivityForResult(tab.intent, CHATGPT); }
        catch (ActivityNotFoundException error) { finish(); }
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == CHATGPT) finish();
    }
}
