package com.sofic.pizarra;

import org.junit.Test;
import static org.junit.Assert.*;

public class ChatGPTUiRulesTest {
    @Test public void limitsControlToTheOfficialChatAndConversationPaths(){
        assertTrue(ChatGPTUiRules.officialAddress("chatgpt.com"));
        assertTrue(ChatGPTUiRules.officialAddress("https://chatgpt.com/c/12345678-abcd-1234-abcd-123456789012"));
        for(String url:new String[]{"https://chatgpt.com.evil.example/","https://evil.example/chatgpt.com","https://chatgpt.com/auth/login","http://chatgpt.com/","https://chatgpt.com:8443/","https://chatgpt.com/@evil","auth.openai.com","pizarraproyecto.vercel.app"})assertFalse(url,ChatGPTUiRules.officialAddress(url));
    }
    @Test public void recognizesSpanishAndEnglishComposersButNeverPasswordFields(){
        assertTrue(ChatGPTUiRules.composer("Pregúntale a ChatGPT","",false));
        assertTrue(ChatGPTUiRules.composer("","Ask anything",false));
        assertTrue(ChatGPTUiRules.composer("Message ChatGPT","",false));
        assertFalse(ChatGPTUiRules.composer("Pregúntale a ChatGPT","",true));
        assertFalse(ChatGPTUiRules.composer("Contraseña","",false));
        assertFalse(ChatGPTUiRules.composer("Buscar en la pizarra","",false));
    }
    @Test public void rejectsOldClipboardContent(){
        assertFalse(ChatGPTUiRules.freshClipboard(1000,1000));
        assertFalse(ChatGPTUiRules.freshClipboard(1000,999));
        assertFalse(ChatGPTUiRules.freshClipboard(0,0));
        assertTrue(ChatGPTUiRules.freshClipboard(1000,1001));
    }
}
