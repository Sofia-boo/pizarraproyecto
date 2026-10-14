package com.sofic.pizarra;

import java.text.Normalizer;
import java.util.Locale;

final class ChatGPTUiRules {
    static String normalize(CharSequence value){return Normalizer.normalize(value==null?"":value.toString(),Normalizer.Form.NFD).replaceAll("\\p{M}","").trim().toLowerCase(Locale.ROOT);}
    static boolean officialAddress(String value){
        String address=value.trim();if(!address.startsWith("https://"))address="https://"+address;
        return address.equals("https://chatgpt.com")||address.equals("https://chatgpt.com/")||address.matches("https://chatgpt\\.com/c/[A-Za-z0-9-]{16,80}");
    }
    static boolean composer(CharSequence label,CharSequence hint,boolean password){
        if(password)return false;
        return (normalize(label)+" "+normalize(hint)).matches(".*(?:pregunta.*chatgpt|preguntale.*chatgpt|ask chatgpt|message chatgpt|mensaje.*chatgpt|pregunta lo que quieras|ask anything).*" );
    }
    static boolean freshClipboard(long before,long after){return after>0&&after>before;}
}
