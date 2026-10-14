package com.sofic.pizarra;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.ArrayList;
import java.util.List;

/** Controls visible Chrome UI only for an explicit job or connection request. */
public class ChatGPTAccessService extends AccessibilityService {
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final Runnable tick=new Runnable(){public void run(){inspect();handler.postDelayed(this,700);}};
    @Override protected void onServiceConnected(){handler.post(tick);}
    @Override public void onAccessibilityEvent(AccessibilityEvent event){}
    @Override public void onInterrupt(){if(NativeChatGPT.active!=null)NativeChatGPT.fail(this,NativeChatGPT.active,"El control de Chrome se interrumpió. Revisá ChatGPT antes de reenviar.");}
    @Override public void onDestroy(){handler.removeCallbacks(tick);if(NativeChatGPT.active!=null)NativeChatGPT.fail(this,NativeChatGPT.active,"Se desactivó el control local. Revisá ChatGPT antes de reenviar.");super.onDestroy();}
    static String normalize(CharSequence value){return ChatGPTUiRules.normalize(value);}
    private String label(AccessibilityNodeInfo node){
        String description=normalize(node.getContentDescription());return description.isEmpty()?normalize(node.getText()):description;
    }
    private void collect(AccessibilityNodeInfo node,List<AccessibilityNodeInfo> result,int depth){
        if(node==null||depth>50||result.size()>=12000)return;
        result.add(node);
        for(int i=0;i<node.getChildCount();i++)collect(node.getChild(i),result,depth+1);
    }
    private AccessibilityNodeInfo match(List<AccessibilityNodeInfo> nodes,String pattern){
        for(AccessibilityNodeInfo node:nodes)if(node.isVisibleToUser()&&!node.isPassword()&&node.isEnabled()&&label(node).matches(pattern))return node;
        return null;
    }
    private boolean click(AccessibilityNodeInfo node){
        for(int i=0;node!=null&&i<4;i++,node=node.getParent())if(node.isEnabled()&&node.isClickable())return node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        return false;
    }
    private List<AccessibilityNodeInfo> copyButtons(List<AccessibilityNodeInfo> nodes){
        List<AccessibilityNodeInfo> copies=new ArrayList<>();
        for(AccessibilityNodeInfo node:nodes)if(node.isEnabled()&&!node.isPassword()&&label(node).matches("(?:copiar|copy)(?: (?:respuesta|response|message))?"))copies.add(node);
        return copies;
    }
    private boolean officialChrome(List<AccessibilityNodeInfo> nodes,NativeChatGPT.Job job){
        if(nodes.isEmpty()||(job!=null&&job.windowId>=0&&nodes.get(0).getWindowId()!=job.windowId))return false;
        for(AccessibilityNodeInfo node:nodes){
            String id=node.getViewIdResourceName();
            if(!node.isVisibleToUser()||id==null||!id.endsWith("/url_bar"))continue;
            String address=node.getText()==null?"":node.getText().toString().trim();
            if(!address.startsWith("https://"))address="https://"+address;
            if(ChatGPTUiRules.officialAddress(address)){
                if(job!=null&&job.submitted&&job.conversation!=null&&!job.conversation.isEmpty()&&!job.conversation.equals(address)){
                    NativeChatGPT.fail(this,job,"Cambiaste de conversación. Revisá ChatGPT antes de reenviar.");return false;
                }
                if(job!=null&&job.windowId<0)job.windowId=node.getWindowId();
                if(job!=null&&address.matches("https://chatgpt\\.com/c/[A-Za-z0-9-]{16,80}"))job.conversation=address;
                return true;
            }
        }
        return false;
    }
    private AccessibilityNodeInfo composer(List<AccessibilityNodeInfo> nodes){
        for(AccessibilityNodeInfo node:nodes)if(node.isVisibleToUser()&&node.isEditable()&&!node.isPassword()){
            String hint=android.os.Build.VERSION.SDK_INT>=26?normalize(node.getHintText()):"";
            if(ChatGPTUiRules.composer(label(node),hint,false))return node;
        }
        return null;
    }
    private void inspect(){
        NativeChatGPT.Job job=NativeChatGPT.active;
        if(job==null&&!NativeChatGPT.opening)return;
        if(job!=null&&System.currentTimeMillis()-job.started>240000){NativeChatGPT.fail(this,job,"ChatGPT tardó demasiado. Revisá su ventana; la consulta no se reenvió.");return;}
        AccessibilityNodeInfo root=getRootInActiveWindow();if(root==null)return;
        String pkg=root.getPackageName()==null?"":root.getPackageName().toString();
        if(!pkg.equals("com.android.chrome")&&!pkg.equals("com.google.android.documentsui")&&!pkg.equals("com.android.documentsui"))return;
        List<AccessibilityNodeInfo> nodes=new ArrayList<>();collect(root,nodes,0);
        if(pkg.endsWith("documentsui")){
            if(job==null||!job.status.equals("running")||job.fileIndex>=job.files.size())return;
            if(job.phase.equals("upload-menu"))job.phase="picker";
            if(job.phase.equals("attached")){click(match(nodes,"(?:abrir|open|seleccionar|select)"));return;}
            if(!job.phase.equals("picker"))return;
            String filename=NativeChatGPT.normalizeFilename(job.files.get(job.fileIndex).name);
            for(AccessibilityNodeInfo node:nodes){
                if(node.isVisibleToUser()&&NativeChatGPT.normalizeFilename(node.getText()==null?"":node.getText().toString()).equals(filename)){
                    if(click(node)){job.phase="attached";job.stableAt=System.currentTimeMillis();}return;
                }
            }
            if(System.currentTimeMillis()-job.stableAt>2000){
                AccessibilityNodeInfo search=match(nodes,"(?:buscar|search)");
                if(search!=null&&click(search)){job.stableAt=System.currentTimeMillis();return;}
                for(AccessibilityNodeInfo node:nodes)if(node.isVisibleToUser()&&node.isEditable()&&!node.isPassword()){
                    Bundle args=new Bundle();args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,job.files.get(job.fileIndex).name);
                    node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args);job.stableAt=System.currentTimeMillis();return;
                }
            }
            return;
        }
        if(!officialChrome(nodes,job)){
            // A partial Chrome window can remain visible while the user writes
            // on the board. Inspect only the already identified job window.
            boolean found=false;
            if(job!=null&&job.windowId>=0)for(android.view.accessibility.AccessibilityWindowInfo window:getWindows()){
                if(window.getId()!=job.windowId||window.getType()!=android.view.accessibility.AccessibilityWindowInfo.TYPE_APPLICATION)continue;
                AccessibilityNodeInfo candidate=window.getRoot();if(candidate==null||!"com.android.chrome".contentEquals(candidate.getPackageName()==null?"":candidate.getPackageName()))continue;
                List<AccessibilityNodeInfo> visible=new ArrayList<>();collect(candidate,visible,0);
                if(officialChrome(visible,job)){nodes=visible;found=true;break;}
            }
            if(!found)return;
        }
        if(match(nodes,"(?:verify you are human|verifica que eres humano|verifica que sos humano|verificando que eres humano|just a moment).*" )!=null){
            NativeChatGPT.state="verification";NativeChatGPT.opening=false;
            if(job!=null)NativeChatGPT.fail(this,job,"Completá la verificación humana en Chrome. No se reenviará la consulta.");return;
        }
        if(match(nodes,"(?:log in|sign in|iniciar sesion|inicia sesion|ingresar)")!=null){NativeChatGPT.state="login";return;}
        AccessibilityNodeInfo editor=composer(nodes);
        if(editor==null&&job!=null&&job.phase.equals("drafted"))for(AccessibilityNodeInfo node:nodes)if(node.isVisibleToUser()&&node.isEditable()&&!node.isPassword()&&node.getText()!=null&&node.getText().toString().equals(job.prompt)){editor=node;break;}
        if(editor!=null&&!jobRunning(job)){NativeChatGPT.state="ready";NativeChatGPT.opening=false;return;}
        if(!jobRunning(job))return;
        if(job.copyRequested)return;
        if(job.submitted){
            if(match(nodes,"(?:stop|detener|stop generating|detener generacion|stop streaming|detener respuesta).*" )!=null){job.stableAt=0;return;}
            List<AccessibilityNodeInfo> copies=copyButtons(nodes);
            copies.removeIf(node->!node.isVisibleToUser()||job.previousCopyNodes.contains(node.hashCode()));
            if(copies.isEmpty()){job.stableAt=0;return;}
            if(job.stableAt==0){job.stableAt=System.currentTimeMillis();return;}
            if(System.currentTimeMillis()-job.stableAt<3000||System.currentTimeMillis()-job.sentAt<3500)return;
            job.copyRequested=true;
            job.clipboardBefore=Math.max(job.clipboardBefore,System.currentTimeMillis()-1);
            if(!click(copies.get(copies.size()-1))){NativeChatGPT.fail(this,job,"No se pudo copiar la respuesta de ChatGPT.");return;}
            handler.postDelayed(()->startActivity(new Intent(this,ChatGPTActivity.class).setAction(ChatGPTActivity.RETURN_TO_BOARD)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP)),800);
            return;
        }
        if(editor==null)return;
        if(job.phase.equals("attached")||job.phase.equals("picker")){
            String filename=job.files.get(job.fileIndex).name;
            boolean attached=false;for(AccessibilityNodeInfo node:nodes)if((node.getText()!=null&&node.getText().toString().contains(filename))||(node.getContentDescription()!=null&&node.getContentDescription().toString().contains(filename)))attached=true;
            if(!attached)return;
            job.fileIndex++;job.phase="composer";
        }
        if(job.fileIndex<job.files.size()){
            if(job.phase.equals("composer")){
                AccessibilityNodeInfo attach=match(nodes,"(?:adjuntar|add files|attach files|agregar archivos|anadir archivos|add photos.*|agregar fotos.*|anadir fotos.*)(?:.*)");
                if(attach!=null&&click(attach)){job.phase="upload-menu";job.stableAt=System.currentTimeMillis();}return;
            }
            if(job.phase.equals("upload-menu")){
                AccessibilityNodeInfo upload=match(nodes,"(?:upload.*|subir archivos|cargar archivos|agregar fotos.*archivos|anadir fotos.*archivos|archivos|files)(?:.*)");
                if(upload!=null&&click(upload)){job.phase="picker";job.stableAt=System.currentTimeMillis();}return;
            }
            return;
        }
        String draft=editor.getText()==null?"":editor.getText().toString();
        if(!draft.trim().isEmpty()&&!draft.equals(job.prompt)&&!normalize(draft).matches("(?:pregunta a chatgpt|preguntale a chatgpt|ask chatgpt|message chatgpt|pregunta lo que quieras|ask anything)")){
            NativeChatGPT.fail(this,job,"Hay un borrador en ChatGPT. Conservé ese texto; vacialo antes de enviar desde la pizarra.");return;
        }
        if(!draft.equals(job.prompt)){
            Bundle args=new Bundle();args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,job.prompt);
            if(!editor.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args))NativeChatGPT.fail(this,job,"Chrome no permitió escribir la consulta.");else job.phase="drafted";return;
        }
        AccessibilityNodeInfo send=match(nodes,"(?:send|enviar)(?: (?:message|prompt|mensaje|pregunta))?");
        if(send==null)return;
        for(AccessibilityNodeInfo copy:copyButtons(nodes))job.previousCopyNodes.add(copy.hashCode());
        job.submitted=true;job.sentAt=System.currentTimeMillis();job.stableAt=0;
        if(!click(send))NativeChatGPT.fail(this,job,"No se pudo pulsar Enviar. Revisá Chrome antes de reenviar.");
    }
    private boolean jobRunning(NativeChatGPT.Job job){return job!=null&&job.status.equals("running");}
}
