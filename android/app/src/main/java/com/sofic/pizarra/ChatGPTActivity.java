package com.sofic.pizarra;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.widget.RemoteViews;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;

/** Opens a fixed official URL. It never receives ChatGPT credentials or responses. */
public class ChatGPTActivity extends Activity {
    private static final int CHATGPT = 41;
    private static final String RETURN_TO_BOARD = "com.sofic.pizarra.RETURN_TO_BOARD";
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (RETURN_TO_BOARD.equals(getIntent().getAction())) {
            // Android may have reclaimed the original activity. In that case
            // reopen the app, whose board and draft were saved before leaving.
            startActivity(new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
            finish(); return;
        }
        if (savedInstanceState != null) return;
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int width = Math.min(Math.round(520 * metrics.density), Math.round(metrics.widthPixels * .65f));
        // Chrome owns authentication. A browser toolbar action returns to the
        // saved board without inspecting the current ChatGPT URL or cookies.
        Intent back = new Intent(this, ChatGPTActivity.class)
            .setAction(RETURN_TO_BOARD)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent returnToBoard = PendingIntent.getActivity(this, 42, back,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        RemoteViews toolbar = new RemoteViews(getPackageName(), R.layout.chatgpt_return_toolbar);
        CustomTabsIntent tab = new CustomTabsIntent.Builder()
            .setInitialActivityWidthPx(width)
            .setInitialActivityHeightPx(Math.round(metrics.heightPixels * .9f), CustomTabsIntent.ACTIVITY_HEIGHT_FIXED)
            .setActivitySideSheetBreakpointDp(600)
            .setActivitySideSheetPosition(CustomTabsIntent.ACTIVITY_SIDE_SHEET_POSITION_END)
            .setActivitySideSheetMaximizationEnabled(false)
            .setCloseButtonEnabled(true)
            .setCloseButtonPosition(CustomTabsIntent.CLOSE_BUTTON_POSITION_START)
            .setUrlBarHidingEnabled(false)
            .setSecondaryToolbarViews(toolbar, new int[]{R.id.return_to_board}, returnToBoard)
            .addMenuItem("Volver a la pizarra", returnToBoard)
            .setSendToExternalDefaultHandlerEnabled(false)
            .setShowTitle(true)
            .build();
        String browser = CustomTabsClient.getPackageName(this, java.util.Collections.singletonList("com.android.chrome"));
        if (browser != null) tab.intent.setPackage(browser);
        tab.intent.setData(Uri.parse("https://chatgpt.com/"));
        try { startActivityForResult(tab.intent, CHATGPT); }
        catch (ActivityNotFoundException error) { finish(); }
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (RETURN_TO_BOARD.equals(intent.getAction())) finish();
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == CHATGPT) finish();
    }
}
