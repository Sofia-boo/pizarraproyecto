package com.sofic.pizarra;

import android.app.Activity;
import android.app.PendingIntent;
import android.app.AlertDialog;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.widget.RemoteViews;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;

/** Chrome owns authentication. Response copying is limited to an explicit job. */
public class ChatGPTActivity extends Activity {
    private static final int CHATGPT = 41;
    static final String RETURN_TO_BOARD = "com.sofic.pizarra.RETURN_TO_BOARD";
    private boolean launched,returning,setup,reading;
    private int attempts;
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setup=getIntent().getBooleanExtra("setupAutomation",false);
        if (RETURN_TO_BOARD.equals(getIntent().getAction())) {
            if(NativeChatGPT.active!=null&&NativeChatGPT.active.copyRequested){returning=true;return;}
            // Android may have reclaimed the original activity. In that case
            // reopen the app, whose board and draft were saved before leaving.
            startActivity(new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
            finish(); return;
        }
        if (savedInstanceState != null) return;
        if(setup&&!NativeChatGPT.enabled(this)){
            android.widget.LinearLayout panel=new android.widget.LinearLayout(this);panel.setOrientation(android.widget.LinearLayout.VERTICAL);panel.setPadding(24,24,24,24);panel.setBackgroundColor(0xffffffff);
            android.widget.TextView explanation=new android.widget.TextView(this);explanation.setText("Activá Pizarra: control local de ChatGPT en Accesibilidad. Requiere Android 10 o posterior.");panel.addView(explanation);
            android.widget.Button settings=new android.widget.Button(this);settings.setText("Abrir Accesibilidad");settings.setOnClickListener(view->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));panel.addView(settings);
            android.widget.Button back=new android.widget.Button(this);back.setText("Volver a la pizarra");back.setOnClickListener(view->finish());panel.addView(back);setContentView(panel);
            new AlertDialog.Builder(this).setTitle("Control local de ChatGPT")
                .setMessage("Este permiso permite escribir y adjuntar tu consulta en Chrome y copiar su respuesta al volver. Sólo actúa cuando conectás ChatGPT o enviás desde la pizarra. No completa contraseñas ni verificaciones humanas. Podés desactivarlo en Accesibilidad. Requiere Android 10 o posterior.")
                .setPositiveButton("Abrir Accesibilidad",(dialog,which)->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)))
                .setNegativeButton("Cancelar",(dialog,which)->finish()).setOnCancelListener(dialog->finish()).show();
        }
    }
    @Override public void onWindowFocusChanged(boolean focus){
        super.onWindowFocusChanged(focus);
        if(!focus)return;
        if(returning){collectResponse();return;}
        if(launched||(setup&&!NativeChatGPT.enabled(this)))return;
        NativeChatGPT.Job job=NativeChatGPT.active;
        if(job!=null&&job.status.equals("running")){
            ClipboardManager clipboard=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
            ClipDescription description=clipboard.getPrimaryClipDescription();
            job.clipboardBefore=android.os.Build.VERSION.SDK_INT>=26&&description!=null?description.getTimestamp():System.currentTimeMillis();
        }
        launched=true;launchBrowser();
    }
    private void launchBrowser(){
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
        NativeChatGPT.Job job=NativeChatGPT.active;
        String target=job!=null&&job.conversation!=null&&!job.conversation.isEmpty()?job.conversation:"https://chatgpt.com/";
        tab.intent.setData(Uri.parse(target));
        try { startActivityForResult(tab.intent, CHATGPT); }
        catch (ActivityNotFoundException error) { finish(); }
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (RETURN_TO_BOARD.equals(intent.getAction())){
            if(NativeChatGPT.active!=null&&NativeChatGPT.active.copyRequested){returning=true;if(hasWindowFocus())collectResponse();}
            else{cancelOutstanding();finish();}
        }
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == CHATGPT){
            if(NativeChatGPT.active!=null&&NativeChatGPT.active.copyRequested){returning=true;if(hasWindowFocus())collectResponse();}
            else{cancelOutstanding();finish();}
        }
    }
    private void cancelOutstanding(){
        if(NativeChatGPT.active!=null&&NativeChatGPT.active.status.equals("running"))NativeChatGPT.fail(this,NativeChatGPT.active,"Se cerró la ventana. Revisá ChatGPT antes de volver a enviar.");
    }
    private void collectResponse(){
        NativeChatGPT.Job job=NativeChatGPT.active;
        if(reading||job==null||!job.copyRequested||!hasWindowFocus())return;
        reading=true;
        ClipboardManager clipboard=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
        ClipDescription description=clipboard.getPrimaryClipDescription();
        boolean fresh=android.os.Build.VERSION.SDK_INT>=26&&description!=null&&ChatGPTUiRules.freshClipboard(job.clipboardBefore,description.getTimestamp());
        ClipData clip=fresh?clipboard.getPrimaryClip():null;
        CharSequence value=clip!=null&&clip.getItemCount()>0?clip.getItemAt(0).getText():null;
        if(value!=null&&!value.toString().trim().isEmpty()){
            NativeChatGPT.complete(this,job,value.toString().substring(0,Math.min(60000,value.length())));finish();return;
        }
        if(++attempts<10){new Handler(getMainLooper()).postDelayed(()->{reading=false;collectResponse();},200);return;}
        NativeChatGPT.fail(this,job,"Chrome no copió una respuesta nueva. Usá Copiar en ChatGPT y pegala desde la pizarra.");finish();
    }
}
