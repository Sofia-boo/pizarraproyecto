type InstallPrompt=Event&{prompt:()=>Promise<{outcome:string}>;userChoice:Promise<{outcome:string}>}
export type OfflineReadiness='preparing'|'ready'|'error'|'unsupported'
let readiness:OfflineReadiness=import.meta.env.PROD&&'serviceWorker' in navigator?'preparing':'unsupported'
let updateReady=false
let beforeUpdate:(()=>Promise<void>)|null=null
export function offlineReadiness(){return readiness}
export function offlineUpdateReady(){return updateReady}
export function beforeAppUpdate(save:()=>Promise<void>){beforeUpdate=save;return()=>{if(beforeUpdate===save)beforeUpdate=null}}
export async function applyAppUpdate(){
  if(!updateReady)return
  if(beforeUpdate)await beforeUpdate()
  window.location.reload()
}
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
  const currentScript=()=>{const source=document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;return source?new URL(source).pathname:''}
  const reportVersion=()=>navigator.serviceWorker.controller?.postMessage({type:'PIZARRA_CLIENT_VERSION',script:currentScript()})
  navigator.serviceWorker.addEventListener('message',event=>{
    if(event.data?.type!=='PIZARRA_VERSION'||!Array.isArray(event.data.scripts))return
    updateReady=Boolean(currentScript()&&!event.data.scripts.includes(currentScript()))
    publishReadiness('ready')
  })
  navigator.serviceWorker.addEventListener('controllerchange',reportVersion)
  void navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(registration=>{
    const refresh=()=>{
      if(registration.active?.state==='activated')publishReadiness('ready')
      else if(registration.installing?.state==='redundant')publishReadiness('error')
      else publishReadiness('preparing')
    }
    const watch=()=>{registration.installing?.addEventListener('statechange',refresh);refresh()}
    registration.addEventListener('updatefound',watch)
    watch()
    void navigator.serviceWorker.ready.then(()=>{publishReadiness('ready');reportVersion()})
    window.addEventListener('online',()=>{void registration.update().catch(()=>{})})
    let lastCheck=0
    window.addEventListener('focus',()=>{
      reportVersion()
      if(navigator.onLine&&Date.now()-lastCheck>30000){lastCheck=Date.now();void registration.update().catch(()=>{})}
    })
  }).catch(()=>publishReadiness('error'))
}
