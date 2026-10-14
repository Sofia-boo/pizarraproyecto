package com.sofic.pizarra;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.HashSet;
import java.util.function.Consumer;

/** Device-local jobs only. No server, API key or ChatGPT credential storage. */
public final class NativeChatGPT {
    static String normalizeFilename(String value){return value.trim().toLowerCase(java.util.Locale.ROOT);}
    static final int MAX_BYTES=20000000;
    static String state="closed";
    static boolean opening;
    static Job active;
    static final Map<String,Job> jobs=new HashMap<>();
    static void registerFile(Context context,Uri uri,boolean add){
        android.content.SharedPreferences preferences=context.getSharedPreferences("chatgpt-temporary-files",Context.MODE_PRIVATE);
        java.util.Set<String> uris=new HashSet<>(preferences.getStringSet("uris",java.util.Collections.emptySet()));
        if(add)uris.add(uri.toString());else uris.remove(uri.toString());
        preferences.edit().putStringSet("uris",uris).commit();
    }
    static void cleanupInterruptedFiles(Context context){
        if(active!=null||!jobs.isEmpty())return;
        android.content.SharedPreferences preferences=context.getSharedPreferences("chatgpt-temporary-files",Context.MODE_PRIVATE);
        for(String item:new HashSet<>(preferences.getStringSet("uris",java.util.Collections.emptySet()))){
            if(item.matches("content://media/(?:external|external_primary)/downloads/[0-9]+"))try{context.getContentResolver().delete(Uri.parse(item),null,null);}catch(Exception ignored){}
        }
        preferences.edit().remove("uris").apply();
    }
    static class Upload {
        String name,type;int size;Uri uri;
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();
    }
    static class Job {
        String id,prompt,conversation,status="preparing",error="",text="",phase="composer";
        long started=System.currentTimeMillis(),sentAt,stableAt,clipboardBefore;
        int fileIndex,windowId=-1;boolean submitted,copyRequested;
        HashSet<Integer> previousCopyNodes=new HashSet<>();
        ArrayList<Upload> files=new ArrayList<>();
    }
    static boolean enabled(Context context){
        if(Build.VERSION.SDK_INT<29)return false;
        String services=Settings.Secure.getString(context.getContentResolver(),Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if(services==null)return false;
        android.content.ComponentName expected=new android.content.ComponentName(context,ChatGPTAccessService.class);
        for(String item:services.split(":"))if(expected.equals(android.content.ComponentName.unflattenFromString(item)))return true;
        return false;
    }
    static JSONObject object(Object... entries)throws Exception{
        JSONObject result=new JSONObject();for(int i=0;i<entries.length;i+=2)result.put((String)entries[i],entries[i+1]);return result;
    }
    static void receive(Activity activity,String raw,Consumer<String> reply){
        String id="",method="";
        try{
            if(raw.length()>90000)throw new Exception("Mensaje demasiado grande.");
            JSONObject input=new JSONObject(raw);id=input.getString("id");
            if(id.length()>64)throw new Exception("Solicitud inválida.");
            method=input.getString("method");JSONObject data=input.optJSONObject("data");if(data==null)data=new JSONObject();
            if(active!=null&&System.currentTimeMillis()-active.started>240000)fail(activity,active,"La consulta local venció. Revisá Chrome antes de reenviar.");
            Object result;
            switch(method){
                case "status":result=object("state",enabled(activity)?state:"permission","busy",active!=null);break;
                case "open":
                case "activate":
                    if(active!=null)throw new Exception("Esperá a que termine la consulta.");
                    opening=true;state=enabled(activity)?"loading":"permission";
                    activity.startActivity(new Intent(activity,ChatGPTActivity.class).putExtra("setupAutomation",true));
                    result=object("state",state);break;
                case "prepare":result=prepare(data,activity);break;
                case "chunk":result=chunk(data);break;
                case "submit":result=submit(data,activity);break;
                case "result":
                    Job job=jobs.get(data.getString("job"));if(job==null)throw new Exception("La consulta ya no está en este dispositivo. Revisá ChatGPT; no se reenviará.");
                    result=object("id",job.id,"status",job.status,"text",job.text,"error",job.error,"conversation",job.conversation==null?JSONObject.NULL:job.conversation);break;
                case "cancel":
                    Job cancel=jobs.get(data.getString("job"));
                    if(cancel!=null&&!cancel.status.equals("complete"))fail(activity,cancel,"Consulta detenida. Revisá ChatGPT antes de reenviar.");
                    result=object("ok",true);break;
                default:throw new Exception("Acción no permitida.");
            }
            reply.accept(object("type","pizarra-native-response","id",id,"data",result).toString());
        }catch(Exception error){
            try{reply.accept(object("type","pizarra-native-response","id",id,"status",method.equals("result")?404:400,"error",error.getMessage()==null?"No se pudo completar la acción local.":error.getMessage()).toString());}catch(Exception ignored){}
        }
    }
    private static Object prepare(JSONObject data,Context context)throws Exception{
        if(!enabled(context))throw new Exception("Activá el control local de ChatGPT en Accesibilidad de Android.");
        if(active!=null)throw new Exception("Esperá a que termine la consulta.");
        Job job=new Job();job.id=data.getString("request_id");job.prompt=data.getString("prompt");job.conversation=data.optString("conversation","");
        if(!job.id.matches("[A-Za-z0-9-]{16,64}")||job.prompt.trim().isEmpty()||job.prompt.length()>12000)throw new Exception("Consulta inválida.");
        if(!job.conversation.isEmpty()&&!job.conversation.matches("https://chatgpt\\.com/c/[A-Za-z0-9-]{16,80}"))throw new Exception("Conversación inválida.");
        if(jobs.containsKey(job.id))return object("id",job.id,"status",jobs.get(job.id).status);
        JSONArray metadata=data.optJSONArray("files");int total=0;
        if(metadata!=null){
            if(metadata.length()>3)throw new Exception("Adjuntá hasta tres archivos.");
            for(int i=0;i<metadata.length();i++){
                JSONObject item=metadata.getJSONObject(i);Upload file=new Upload();file.type=item.getString("type");file.size=item.getInt("size");
                String extension;
                switch(file.type){case "image/png":extension=".png";break;case "image/jpeg":extension=".jpg";break;case "image/webp":extension=".webp";break;case "application/pdf":extension=".pdf";break;default:throw new Exception("Tipo de archivo no admitido.");}
                if(file.size<=0||file.size>MAX_BYTES)throw new Exception("Los archivos deben ocupar hasta 20 MB.");
                total+=file.size;if(total>MAX_BYTES)throw new Exception("Los archivos deben ocupar hasta 20 MB.");
                file.name="pizarra-"+job.id+"-"+(i+1)+extension;job.files.add(file);
            }
        }
        jobs.entrySet().removeIf(entry->!entry.getValue().status.equals("running")&&System.currentTimeMillis()-entry.getValue().started>900000);
        if(jobs.size()>40)throw new Exception("Esperá antes de crear más consultas.");
        jobs.put(job.id,job);active=job;return object("id",job.id,"status",job.status);
    }
    private static Object chunk(JSONObject data)throws Exception{
        Job job=jobs.get(data.getString("job"));
        if(job==null||!job.status.equals("preparing"))throw new Exception("No hay un envío de archivos pendiente.");
        int index=data.getInt("index");if(index<0||index>=job.files.size())throw new Exception("Archivo inválido.");
        Upload file=job.files.get(index);byte[] bytes=Base64.decode(data.getString("chunk"),Base64.NO_WRAP);
        if(data.getInt("offset")!=file.bytes.size()||bytes.length>48000||file.bytes.size()+bytes.length>file.size)throw new Exception("Fragmento de archivo inválido.");
        file.bytes.write(bytes);return object("ok",true);
    }
    @android.annotation.TargetApi(29)
    private static Object submit(JSONObject data,Activity activity)throws Exception{
        Job job=jobs.get(data.getString("job"));if(job==null)throw new Exception("Consulta inexistente.");
        if(!job.status.equals("preparing"))return object("id",job.id,"status",job.status);
        try{
            if(!enabled(activity))throw new Exception("El control local está desactivado.");
            for(Upload file:job.files){
                if(file.bytes.size()!=file.size)throw new Exception("La transferencia del archivo está incompleta.");
                ContentValues values=new ContentValues();values.put(MediaStore.Downloads.DISPLAY_NAME,file.name);values.put(MediaStore.Downloads.MIME_TYPE,file.type);
                values.put(MediaStore.Downloads.RELATIVE_PATH,Environment.DIRECTORY_DOWNLOADS+"/PizarraTemporal");values.put(MediaStore.Downloads.IS_PENDING,1);
                file.uri=activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);
                if(file.uri==null)throw new Exception("No se pudo preparar el adjunto.");
                registerFile(activity,file.uri,true);
                try(OutputStream stream=activity.getContentResolver().openOutputStream(file.uri)){if(stream==null)throw new Exception("No se pudo preparar el adjunto.");file.bytes.writeTo(stream);}
                values.clear();values.put(MediaStore.Downloads.IS_PENDING,0);activity.getContentResolver().update(file.uri,values,null,null);file.bytes=new ByteArrayOutputStream();
            }
            job.status="running";job.started=System.currentTimeMillis();opening=false;
            activity.startActivity(new Intent(activity,ChatGPTActivity.class).putExtra("automatedJob",job.id));
            return object("id",job.id,"status","running");
        }catch(Exception error){fail(activity,job,"No se pudo preparar la consulta; no se envió.");throw error;}
    }
    static void cleanup(Context context,Job job){
        for(Upload file:job.files){file.bytes=new ByteArrayOutputStream();if(file.uri!=null){try{context.getContentResolver().delete(file.uri,null,null);registerFile(context,file.uri,false);}catch(Exception ignored){}file.uri=null;}}
    }
    static void fail(Context context,Job job,String error){job.status="error";job.error=error;cleanup(context,job);if(active==job)active=null;}
    static void complete(Context context,Job job,String text){job.text=text;job.status="complete";cleanup(context,job);if(active==job)active=null;state="ready";}
}
