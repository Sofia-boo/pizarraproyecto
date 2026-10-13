import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

export function offlineApp():Plugin {
  return {name:'pizarra-offline-app',enforce:'post',apply:'build',generateBundle(_options,bundle){
    const files=['/','/index.html','/manifest.webmanifest','/favicon.svg','/icons/pizarra-192.png','/icons/pizarra-512.png','/icons/pizarra-maskable.png',
      ...Object.keys(bundle).filter(name=>name.startsWith('assets/')).map(name=>'/'+name)]
    const hash=createHash('sha256').update(JSON.stringify(files))
    for(const name of ['manifest.webmanifest','favicon.svg','icons/pizarra-192.png','icons/pizarra-512.png','icons/pizarra-maskable.png'])hash.update(readFileSync(new URL('../public/'+name,import.meta.url)))
    const revision=hash.digest('hex').slice(0,16)
    this.emitFile({type:'asset',fileName:'sw.js',source:`
const CACHE='pizarra-app-${revision}';
const FILES=${JSON.stringify(files)};
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));
});
self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('pizarra-app-')&&key!==CACHE).map(key=>caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/recognize/'))return;
  if(request.mode==='navigate'){
    // Keep the shell and its assets from the same installed version. A new
    // deployment must finish downloading before it replaces this worker.
    event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match('/index.html'))||fetch(request)));
  }else if(FILES.includes(url.pathname)){
    event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.pathname))||fetch(request)));
  }
});
`})
  }}
}
