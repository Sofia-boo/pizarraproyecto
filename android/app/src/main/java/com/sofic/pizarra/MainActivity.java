package com.sofic.pizarra;

import android.app.Activity;
import android.content.ComponentName;
import android.net.Uri;
import android.os.Bundle;
import androidx.browser.customtabs.CustomTabsCallback;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsService;
import androidx.browser.customtabs.CustomTabsServiceConnection;
import androidx.browser.customtabs.CustomTabsSession;
import androidx.browser.trusted.TrustedWebActivityIntentBuilder;

/** Chrome retains the board's existing origin, storage and authentication. */
public class MainActivity extends Activity {
    private final Uri origin=Uri.parse("https://pizarraproyecto.vercel.app");
    private CustomTabsSession session;
    private boolean validated, navigated, launched, stopped;
    private final CustomTabsCallback callback=new CustomTabsCallback(){
        @Override public void onRelationshipValidationResult(int relation,Uri requested,boolean result,Bundle extras){
            if(relation==CustomTabsService.RELATION_USE_AS_ORIGIN&&origin.equals(requested)){validated=result;channel();}
        }
        @Override public void onNavigationEvent(int event,Bundle extras){
            if(event==NAVIGATION_FINISHED){navigated=true;channel();}
        }
        @Override public void onMessageChannelReady(Bundle extras){
            session.postMessage("{\"type\":\"pizarra-native-ready\",\"version\":3}",null);
        }
        @Override public void onPostMessage(String message,Bundle extras){
            runOnUiThread(()->NativeChatGPT.receive(MainActivity.this,message,reply->{
                if(session!=null)session.postMessage(reply,null);
            }));
        }
    };
    private void channel(){if(session!=null&&validated&&navigated)session.requestPostMessageChannel(origin,origin,new Bundle());}
    private final CustomTabsServiceConnection connection=new CustomTabsServiceConnection(){
        @Override public void onCustomTabsServiceConnected(ComponentName name,CustomTabsClient client){
            client.warmup(0);session=client.newSession(callback);
            if(session==null){finish();return;}
            session.validateRelationship(CustomTabsService.RELATION_USE_AS_ORIGIN,origin,null);
            launchBoard();
        }
        @Override public void onServiceDisconnected(ComponentName name){session=null;}
    };
    private void launchBoard(){
        launched=true;stopped=false;navigated=false;
        new TrustedWebActivityIntentBuilder(Uri.parse(origin+"/?app=1&native=1")).build(session).launchTrustedWebActivity(this);
    }
    @Override protected void onNewIntent(android.content.Intent intent){super.onNewIntent(intent);stopped=false;if(session!=null)launchBoard();}
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        NativeChatGPT.cleanupInterruptedFiles(this);
        String browser=CustomTabsClient.getPackageName(this,java.util.Collections.singletonList("com.android.chrome"));
        if(browser==null||!CustomTabsClient.bindCustomTabsService(this,browser,connection))finish();
    }
    @Override protected void onDestroy(){
        try{unbindService(connection);}catch(IllegalArgumentException ignored){}
        super.onDestroy();
    }
    @Override protected void onStop(){super.onStop();stopped=true;}
    @Override protected void onResume(){super.onResume();if(stopped&&launched)finish();}
}
