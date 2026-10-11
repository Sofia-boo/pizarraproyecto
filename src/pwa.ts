type InstallPrompt=Event&{prompt:()=>Promise<{outcome:string}>;userChoice:Promise<{outcome:string}>}
let prompt:InstallPrompt|null=null
let installed=matchMedia('(display-mode: standalone)').matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone)
export function installState(){return installed?'installed':prompt?'available':'manual'}
function notify(){window.dispatchEvent(new Event('pizarra-install-state'))}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event as InstallPrompt;notify()})
window.addEventListener('appinstalled',()=>{installed=true;prompt=null;notify();void navigator.storage?.persist?.().catch(()=>false)})
export async function installTablet(){
  if(!prompt)return false
  const current=prompt;prompt=null;notify()
  try {await current.prompt();const choice=await current.userChoice;if(choice.outcome==='accepted')void navigator.storage?.persist?.().catch(()=>false);return choice.outcome==='accepted'}
  catch{return false}
}
if(import.meta.env.PROD&&'serviceWorker' in navigator){
  void navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{/* La página sigue funcionando si el dispositivo rechaza el guardado sin conexión. */})
}
