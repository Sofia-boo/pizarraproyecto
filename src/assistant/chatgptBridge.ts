export const CHATGPT_URL='https://chatgpt.com/'
export const ANDROID_APK='/downloads/pizarra-chatgpt.apk'
export const CHATGPT_ANDROID_INTENT='intent://chatgpt#Intent;scheme=pizarraestudio;package=com.sofic.pizarra;S.browser_fallback_url=https%3A%2F%2Fchatgpt.com%2F;end'
export function nativeAndroid(){
  if(!/Android/i.test(navigator.userAgent))return false
  if(new URLSearchParams(location.search).get('native')==='1')sessionStorage.setItem('pizarra-native-browser','1')
  return sessionStorage.getItem('pizarra-native-browser')==='1'
}
export function openOfficialChatGPT(){
  if(nativeAndroid()){location.assign(CHATGPT_ANDROID_INTENT);return true}
  const width=Math.min(520,screen.availWidth),height=Math.min(950,screen.availHeight)
  const popup=window.open(CHATGPT_URL,'_blank',`popup=yes,width=${width},height=${height},left=${Math.max(0,window.screenX+window.outerWidth-width)},top=${Math.max(0,window.screenY)}`)
  if(!popup)return false
  popup.opener=null
  return true
}
