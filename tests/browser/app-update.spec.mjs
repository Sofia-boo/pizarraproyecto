import {test,expect} from '@playwright/test'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {resolve,extname,sep} from 'node:path'

const root=resolve(process.env.PIZARRA_TEST_PREVIEW==='1'?'dist-fase1':'dist')
let server,site,generation='legacy',index,worker,mainScript
const legacyHTML='<script type="module" src="/assets/legacy.js"></script><p>Asistente de estudio local</p>'
const legacyWorker=`const CACHE='pizarra-app-legacy';self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(async c=>{await c.put('/index.html',new Response(${JSON.stringify(legacyHTML)},{headers:{'Content-Type':'text/html'}}));await c.put('/assets/legacy.js',new Response('window.legacy=true',{headers:{'Content-Type':'application/javascript'}}));await self.skipWaiting()})));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.mode==='navigate')e.respondWith(caches.open(CACHE).then(c=>c.match('/index.html')));else if(u.pathname==='/assets/legacy.js')e.respondWith(caches.open(CACHE).then(c=>c.match(u.pathname)))})`
test.beforeAll(async()=>{
  index=await readFile(resolve(root,'index.html'),'utf8');worker=await readFile(resolve(root,'sw.js'),'utf8')
  mainScript=index.match(/\/assets\/index-[^" ]+\.js/)[0]
  server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname
    res.setHeader('Cache-Control','no-store')
    if(path.startsWith('/api/')){res.writeHead(401,{'Content-Type':'application/json'});res.end('{}');return}
    if(path==='/sw.js'){res.setHeader('Content-Type','application/javascript');res.end(generation==='legacy'?legacyWorker:generation==='next'?worker.replace(mainScript,'/assets/index-next.js').replace(/pizarra-app-[a-f0-9]+/,'pizarra-app-next'):worker);return}
    if(path==='/assets/legacy.js'){res.setHeader('Content-Type','application/javascript');res.end('window.legacy=true');return}
    if(path==='/'||path==='/index.html'){res.setHeader('Content-Type','text/html');res.end(generation==='legacy'?legacyHTML:generation==='next'?index.replace(mainScript,'/assets/index-next.js'):index);return}
    const file=resolve(root,'.'+(path==='/assets/index-next.js'?mainScript:path))
    if(!file.startsWith(root+sep)){res.writeHead(404);res.end();return}
    try{
      const bytes=await readFile(file)
      res.setHeader('Content-Type',({'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[extname(file)]??'application/octet-stream');res.end(bytes)
    }catch{res.writeHead(404);res.end()}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));site=`http://127.0.0.1:${server.address().port}`
})
test.afterAll(async()=>{await new Promise(resolve=>server.close(resolve))})
async function saved(page){return page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
  const records=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>resolve(r.result)})
  db.close();return records.find(b=>b.id===localStorage.getItem('pizarra_activa'))
})}
test('old offline shell upgrades with another old tab open, preserving boards and local learning',async({page,context})=>{
  test.setTimeout(60000);generation='legacy'
  await page.goto(site)
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready})
  await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true)
  await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{
      const r=indexedDB.open('pizarra-dispositivo',1)
      r.onupgradeneeded=()=>{const db=r.result;db.createObjectStore('boards',{keyPath:'key'});db.createObjectStore('folders',{keyPath:'id'});db.createObjectStore('assets');db.createObjectStore('meta');db.createObjectStore('history',{keyPath:'id'})}
      r.onsuccess=()=>resolve(r.result)
    })
    await new Promise(resolve=>{
      const tx=db.transaction(['boards','meta'],'readwrite')
      tx.objectStore('boards').put({key:'local:upgrade',id:'local:upgrade',name:'Ejercicio conservado',folder_id:null,version:0,storage:'private',updated_at:new Date().toISOString(),content:{strokes:[{id:'stroke-kept',points:[{x:100,y:300},{x:200,y:350}],color:'#000000',width:3}],texts:[],media:[],shapes:[],graphs:[],tables:[],camera:{x:0,y:0,zoom:1}}})
      tx.objectStore('meta').put('palabra aprendida','ocr-learning-sentinel');tx.oncomplete=resolve
    });db.close();localStorage.setItem('pizarra_activa','local:upgrade');localStorage.setItem('pizarra-modo-local-preferido','1')
  })
  const oldTab=await context.newPage();await oldTab.goto(site);await expect(oldTab.getByText('Asistente de estudio local')).toBeVisible()
  generation='current'
  await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update()})
  await expect.poll(()=>page.evaluate(async()=>{
    const r=await navigator.serviceWorker.getRegistration();return !r.installing&&!r.waiting&&(await caches.keys()).some(key=>key!=='pizarra-app-legacy')
  })).toBe(true)
  await expect(page.getByText('Asistente de estudio local')).toBeVisible()
  await page.reload();await expect(page.locator('.library-open-button')).toContainText('Ejercicio conservado')
  expect((await saved(page)).content.strokes[0].id).toBe('stroke-kept')
  await page.getByRole('button',{name:'IA: opciones de reconocimiento',exact:true}).click()
  await expect(page.getByRole('menuitem',{name:/Consultar con ChatGPT/})).toBeVisible()
  await context.setOffline(true)
  expect(await oldTab.evaluate(()=>fetch('/assets/legacy.js').then(r=>r.text()))).toContain('window.legacy')
  expect(await page.evaluate(()=>caches.has('pizarra-app-legacy'))).toBe(true)
  await oldTab.close();await page.reload()
  await expect(page.locator('.library-open-button')).toContainText('Ejercicio conservado')
  await expect.poll(()=>page.evaluate(()=>caches.has('pizarra-app-legacy'))).toBe(false)
  expect((await saved(page)).content.strokes).toHaveLength(1)
  expect(await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    const value=await new Promise(resolve=>{const r=db.transaction('meta').objectStore('meta').get('ocr-learning-sentinel');r.onsuccess=()=>resolve(r.result)});db.close();return value
  })).toBe('palabra aprendida')
})
test('update button saves a fresh stroke before reloading into the downloaded version',async({page})=>{
  test.setTimeout(60000);generation='current'
  await page.goto(site);await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect(page.locator('.library-open-button')).toContainText('privada')
  await page.evaluate(()=>navigator.serviceWorker.ready)
  await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true)
  const id=await page.evaluate(()=>localStorage.getItem('pizarra_activa'))
  generation='next';await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update()})
  const update=page.getByRole('button',{name:'Actualizar app',exact:true});await expect(update).toBeVisible()
  await page.mouse.move(200,300);await page.mouse.down();await page.mouse.move(350,350,{steps:3});await page.mouse.up()
  await Promise.all([page.waitForEvent('load'),update.click()])
  await expect(page.locator('script[type="module"]')).toHaveAttribute('src','/assets/index-next.js')
  await expect(page.locator('.library-open-button')).toContainText('privada')
  expect(await page.evaluate(()=>localStorage.getItem('pizarra_activa'))).toBe(id)
  await expect.poll(async()=>(await saved(page)).content.strokes.length).toBe(1)
  await expect(update).toHaveCount(0)
})
