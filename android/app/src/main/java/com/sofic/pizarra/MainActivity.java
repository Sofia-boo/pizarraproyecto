package com.sofic.pizarra;

import android.net.Uri;
import com.google.androidbrowserhelper.trusted.LauncherActivity;

/** Chrome owns the page and its storage; the APK contains no WebView or login. */
public class MainActivity extends LauncherActivity {
    @Override protected Uri getLaunchingUrl() {
        return Uri.parse("https://pizarraproyecto.vercel.app/?app=1&native=1");
    }
}
