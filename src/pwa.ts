type InstallPrompt=Event&{prompt:()=>Promise<{outcome:string}>;userChoice:Promise<{outcome:string}>}
export type OfflineReadiness='preparing'|'ready'|'error'|'unsupported'
let readiness:OfflineReadiness=import.meta.env.PROD&&'serviceWorker' in navigator?'preparing':'unsupported'
let updateReady=false
export function offlineReadiness(){return readiness}
export function offlineUpdateReady(){return updateReady}
function publishReadiness(value:OfflineReadiness){readiness=value;window.dispatchEvent(new Event('pizarra-offline-ready'))}
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
  void navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(registration=>{
    const refresh=()=>{
      updateReady=Boolean(registration.waiting&&registration.active)
      if(registration.active?.state==='activated')publishReadiness('ready')
      else if(registration.installing?.state==='redundant')publishReadiness('error')
      else publishReadiness('preparing')
    }
    const watch=()=>{registration.installing?.addEventListener('statechange',refresh);refresh()}
    registration.addEventListener('updatefound',watch)
    watch()
    void navigator.serviceWorker.ready.then(()=>publishReadiness('ready'))
    window.addEventListener('online',()=>{void registration.update().catch(()=>{})})
  }).catch(()=>publishReadiness('error'))
}
