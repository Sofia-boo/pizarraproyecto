import {test,expect} from '@playwright/test'
import {htmlFixture} from './html-live-fixture.mjs'

test.use({serviceWorkers:'block'})
const source='<!doctype html><html><body><input aria-label="Nombre"><button onclick="this.textContent=++window.count">Sumar</button><div style="height:1800px">Contenido desplazable</div><script>window.count=0;parent.postMessage({fixtureExecution:true},"*")</script></body></html>'
async function localHtml(page){
  await page.addInitScript(()=>{window.executions=0;addEventListener('message',event=>{if(event.data?.fixtureExecution)window.executions++})})
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'isolated fixture'}))
  await page.goto('/');await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect.poll(()=>page.evaluate(async()=>{
    const id=localStorage.getItem('pizarra_activa');if(!id)return
    const db=await new Promise(resolve=>{const request=indexedDB.open('pizarra-dispositivo',1);request.onsuccess=()=>resolve(request.result)})
    const row=await new Promise(resolve=>{const request=db.transaction('boards').objectStore('boards').get(id);request.onsuccess=()=>resolve(request.result)})
    db.close();return row?.content?.camera
  })).toBeDefined()
  await page.locator('input[accept="text/html,.html,.htm"]').setInputFiles({name:'zoom.html',mimeType:'text/html',buffer:Buffer.from(source)})
  await expect(page.locator('.board-html-widget')).toBeVisible()
}
const camera=page=>page.locator('.board-scene').evaluate(element=>{const m=new DOMMatrix(getComputedStyle(element).transform);return {x:m.e,y:m.f,zoom:m.a}})
const viewport=page=>page.evaluate(()=>({dpr:devicePixelRatio,width:innerWidth,height:innerHeight,scale:visualViewport.scale,scrollX,scrollY,appX:document.querySelector('.app').scrollLeft,appY:document.querySelector('.app').scrollTop}))
async function ctrlWheel(page,point,deltaY){
  const session=await page.context().newCDPSession(page)
  await session.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:point.x,y:point.y,deltaX:0,deltaY,modifiers:2})
  await session.detach()
}
async function checkZoom(page,point,deltaY){
  const before=await camera(page),chrome=await viewport(page)
  const canvas=await page.locator('.app>canvas').first().boundingBox()
  const world={x:(point.x-canvas.x-before.x)/before.zoom,y:(point.y-canvas.y-before.y)/before.zoom}
  await ctrlWheel(page,point,deltaY)
  await expect.poll(async()=>(await camera(page)).zoom).toBeCloseTo(before.zoom*Math.exp(-deltaY*.004),4)
  const after=await camera(page)
  // Native wheel coordinates are quantized by Chromium; require subpixel drift.
  expect(Math.abs(world.x*after.zoom+after.x+canvas.x-point.x)).toBeLessThan(.75)
  expect(Math.abs(world.y*after.zoom+after.y+canvas.y-point.y)).toBeLessThan(.75)
  expect(await viewport(page)).toEqual(chrome)
}

test('Ctrl-wheel over inactive HTML and its header zooms the board around the pointer',async({page})=>{
  await localHtml(page)
  const box=await page.getByRole('button',{name:'Activar HTML zoom.html',exact:true}).boundingBox()
  await checkZoom(page,{x:box.x+80,y:box.y+100},-60)
  const header=await page.getByLabel('Mover HTML zoom.html').boundingBox()
  await checkZoom(page,{x:header.x+80,y:header.y+18},60)
  await expect(page.locator('.toolbar')).toBeVisible()
})

test('focused HTML forwards zoom, releases modifiers and keeps its own normal scroll',async({page})=>{
  await localHtml(page);await page.getByRole('button',{name:'Activar HTML zoom.html',exact:true}).click()
  const frame=page.frameLocator('.board-html-widget iframe'),input=frame.getByLabel('Nombre')
  await input.fill('Conservar ejercicio')
  const box=await input.boundingBox(),point={x:box.x+box.width/2,y:box.y+box.height/2}
  await checkZoom(page,point,-60)
  await expect(input).toHaveValue('Conservar ejercicio')
  expect(await page.evaluate(()=>window.executions)).toBe(1)
  await page.keyboard.down('Control')
  await expect(page.locator('.app')).toHaveAttribute('data-control-navigation','true')
  await page.keyboard.up('Control')
  await expect(page.locator('.app')).toHaveAttribute('data-control-navigation','false')
  const before=await camera(page),body=await page.locator('.board-html-widget iframe').boundingBox()
  await page.mouse.move(body.x+100,body.y+140);await page.mouse.wheel(0,120)
  await expect.poll(()=>frame.locator('body').evaluate(()=>scrollY)).toBeGreaterThan(0)
  expect(await camera(page)).toEqual(before)
  expect((await viewport(page)).appY).toBe(0)
  await expect(page.locator('.toolbar')).toBeVisible()
})

test('HTML iframe zoom stays anchored after scaling and rotation',async({page})=>{
  await localHtml(page)
  await expect.poll(()=>page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const request=indexedDB.open('pizarra-dispositivo',1);request.onsuccess=()=>resolve(request.result)})
    const row=await new Promise(resolve=>{const request=db.transaction('boards').objectStore('boards').get(localStorage.getItem('pizarra_activa'));request.onsuccess=()=>resolve(request.result)})
    db.close();return row.content.shapes.length
  })).toBe(1)
  await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const request=indexedDB.open('pizarra-dispositivo',1);request.onsuccess=()=>resolve(request.result)})
    await new Promise(resolve=>{const tx=db.transaction('boards','readwrite'),store=tx.objectStore('boards'),request=store.get(localStorage.getItem('pizarra_activa'));request.onsuccess=()=>{const row=request.result;row.content.camera={x:100,y:130,zoom:.65};Object.assign(row.content.shapes[0],{x:200,y:180,rotation:Math.PI/6});store.put(row)};tx.oncomplete=resolve});db.close()
  })
  await page.reload();await page.getByRole('button',{name:'Activar HTML zoom.html',exact:true}).click()
  const input=page.frameLocator('.board-html-widget iframe').getByLabel('Nombre')
  await input.fill('Rotado');const box=await input.boundingBox()
  const point={x:box.x+box.width/2,y:box.y+box.height/2}
  await checkZoom(page,point,-40);await checkZoom(page,point,40)
  await expect(input).toHaveValue('Rotado')
})

test('zoom over a shared HTML mirror changes only the local board camera',async({browser})=>{
  const contexts=await Promise.all([browser.newContext(),browser.newContext()]),pages=await Promise.all(contexts.map(context=>context.newPage()))
  try{
    await htmlFixture(pages);await Promise.all(pages.map(page=>page.goto('/')))
    const [owner,peer]=pages
    await owner.getByRole('button',{name:'Activar HTML compartido.html',exact:true}).click()
    await peer.getByRole('button',{name:'Seleccionar área',exact:true}).click()
    const input=peer.frameLocator('.board-html-widget iframe').getByLabel('Nombre',{exact:true})
    await input.fill('Compartido');await expect(owner.frameLocator('.board-html-widget iframe').locator('#result')).toHaveText('Compartido')
    const before=await camera(owner),box=await input.boundingBox()
    await checkZoom(peer,{x:box.x+box.width/2,y:box.y+box.height/2},-50)
    expect(await camera(owner)).toEqual(before)
    expect(await peer.evaluate(()=>window.executions)).toBe(0)
    await expect(input).toHaveValue('Compartido')
  }finally{await Promise.all(contexts.map(context=>context.close()))}
})
