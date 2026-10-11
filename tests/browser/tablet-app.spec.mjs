import {test,expect} from '@playwright/test'

async function openLocal(page){
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'offline'}))
  await page.goto('/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect.poll(async()=>(await board(page))?.camera).toBeDefined()
}
async function board(page){
  return page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
    return new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>{db.close();resolve(r.result.find(b=>b.id===localStorage.getItem('pizarra_activa'))?.content)}})
  })
}
async function pen(context,page){
  const cdp=await context.newCDPSession(page)
  return (type,x,y,buttons=1)=>cdp.send('Input.dispatchMouseEvent',{type,x,y,pointerType:'pen',button:type==='mouseMoved'?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1})
}

test('install button offers tablet instructions and invokes native installation when available',async({page})=>{
  await page.route('**/api/**',r=>r.fulfill({status:401,body:'{}'}))
  await page.goto('/')
  const button=page.getByRole('button',{name:'Descargar app para tablet'})
  await button.click()
  await expect(page.getByRole('status')).toContainText('Android:')
  await expect(page.getByRole('status')).toContainText('iPad:')
  await page.evaluate(()=>{
    const event=new Event('beforeinstallprompt',{cancelable:true})
    event.prompt=async()=>{window.installCalled=true}
    event.userChoice=Promise.resolve({outcome:'accepted'})
    window.dispatchEvent(event)
  })
  await button.click()
  expect(await page.evaluate(()=>window.installCalled)).toBe(true)
  await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')))
  await expect(button).toHaveCount(0)
  await expect(page.getByText('App instalada en este dispositivo.')).toBeVisible()
})

test('app opens a saved private board in a fresh window with internet completely disabled',async({page,context})=>{
  await openLocal(page)
  await page.evaluate(async()=>{await navigator.serviceWorker.ready})
  const manifest=await(await page.request.get('/manifest.webmanifest')).json()
  expect(manifest.display).toBe('standalone')
  await page.mouse.move(200,300);await page.mouse.down();await page.mouse.move(310,370,{steps:8});await page.mouse.up()
  await expect.poll(async()=>(await board(page))?.strokes.length).toBe(1)
  const id=await page.evaluate(()=>localStorage.getItem('pizarra_activa'))
  await context.setOffline(true)
  const fresh=await context.newPage()
  await fresh.goto('/',{waitUntil:'domcontentloaded'})
  await expect(fresh.locator('canvas').first()).toBeVisible()
  expect(await fresh.evaluate(()=>localStorage.getItem('pizarra_activa'))).toBe(id)
  expect((await board(fresh)).strokes).toHaveLength(1)
  await fresh.getByRole('button',{name:'Elementos académicos',exact:true}).click()
  await expect(fresh.getByRole('button',{name:/Agregar hoja A4/})).toBeVisible()
  await expect(fresh.getByRole('button',{name:/Grafo dirigido|Grafo no dirigido|Puerta AND|Pseudocódigo/})).toHaveCount(0)
  const cached=await fresh.evaluate(async()=>{const cache=await caches.open((await caches.keys()).find(k=>k.startsWith('pizarra-app-')));return(await cache.keys()).map(r=>new URL(r.url).pathname)})
  expect(cached.some(path=>path.startsWith('/api/'))).toBe(false)
  expect(cached.some(path=>path.includes('plotly'))).toBe(true)
  await fresh.screenshot({path:'test-results/tablet-app-offline.png'})
})

test('holding the pen for three seconds opens actions without drawing; movement and a tap still draw',async({page,context})=>{
  await openLocal(page)
  const input=await pen(context,page)
  await input('mousePressed',250,350)
  await page.waitForTimeout(1200)
  await expect(page.getByRole('menu',{name:'Acciones sobre elementos'})).toHaveCount(0)
  await expect(page.getByRole('menu',{name:'Acciones sobre elementos'})).toBeVisible({timeout:3000})
  await input('mouseReleased',250,350,0)
  expect((await board(page))?.strokes??[]).toHaveLength(0)
  await page.keyboard.press('Escape')
  // Dismiss with a normal mouse click in case Escape belongs to another tool.
  if(await page.locator('.board-context-dismiss').count())await page.locator('.board-context-dismiss').click({position:{x:20,y:150}})
  await input('mousePressed',260,400)
  await input('mouseMoved',320,430)
  await input('mouseReleased',320,430,0)
  await expect.poll(async()=>(await board(page))?.strokes.length).toBe(1)
  await page.waitForTimeout(1000)
  await input('mousePressed',400,450)
  await input('mouseReleased',400,450,0)
  await expect.poll(async()=>(await board(page))?.strokes.length).toBe(2)
  await expect(page.getByRole('menu',{name:'Acciones sobre elementos'})).toHaveCount(0)
})

test('one finger pans and two fingers pinch on tablet',async({page,context})=>{
  await openLocal(page)
  const cdp=await context.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:220,y:350}]})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:300,y:430}]})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  await expect.poll(async()=>(await board(page))?.camera.x).toBe(80)
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:220,y:350},{id:2,x:320,y:350}]})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:170,y:350},{id:2,x:370,y:350}]})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  await expect.poll(async()=>(await board(page))?.camera.zoom).toBe(2)
  expect((await board(page)).strokes).toHaveLength(0)
})
