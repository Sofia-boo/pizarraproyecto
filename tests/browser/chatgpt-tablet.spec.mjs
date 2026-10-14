import {test,expect} from '@playwright/test'

test.use({viewport:{width:800,height:1280},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (Linux; Android 14; Lenovo Tab M11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'})

async function open(page){
  await page.getByRole('button',{name:'IA: opciones de reconocimiento',exact:true}).tap()
  await page.getByRole('menuitem',{name:/Consultar con ChatGPT/}).tap()
  const dialog=page.getByRole('dialog',{name:'ChatGPT',exact:true})
  await dialog.getByRole('button',{name:'Con PC',exact:true}).tap()
  return dialog
}

async function prepare(page){
  let requests=0
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/chatgpt/status')return route.fulfill({json:{state:'ready'}})
    if(path==='/api/chatgpt/consult'){requests++;return route.fulfill({status:202,json:{id:'tablet-response',status:'running'}})}
    if(path==='/api/chatgpt/consult/tablet-response')return route.fulfill({json:{id:'tablet-response',status:'complete',text:'## Solución\nResultado: $\\frac{1}{2}$'}})
    return route.fulfill({status:503,body:'offline'})
  })
  await page.goto('/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).tap()
  await expect(page.locator('.library-open-button')).toContainText('privada')
  return()=>requests
}

test('tablet touch opens the attachment menu, uploads a photo, asks and inserts a formatted answer',async({page})=>{
  const requests=await prepare(page)
  const dialog=await open(page)
  await dialog.getByRole('button',{name:'Adjuntar ▾',exact:true}).tap()
  const item=dialog.getByRole('menuitem',{name:'Archivo o imagen…',exact:true})
  await expect(item).toBeVisible()
  expect(await item.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})).toBe(true)
  const chooser=page.waitForEvent('filechooser')
  await item.tap()
  await(await chooser).setFiles({name:'foto-ejercicio.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=','base64')})
  await dialog.getByRole('textbox',{name:'Pregunta para ChatGPT',exact:true}).fill('Resolver el ejercicio de la foto')
  await dialog.getByRole('button',{name:'Enviar',exact:true}).tap()
  await expect(dialog.locator('.katex')).toHaveCount(1)
  await dialog.getByRole('button',{name:'Insertar en pizarra',exact:true}).tap()
  await expect(dialog.getByRole('status')).toHaveText('Respuesta agregada a la pizarra.')
  expect(requests()).toBe(1)
})

test('tablet chat stays inside the visible area when the on-screen keyboard opens',async({page})=>{
  await page.setViewportSize({width:1280,height:800})
  // Chrome on Android normally shrinks the visual viewport, not the layout
  // viewport. Model that behavior rather than merely shrinking the window.
  await page.addInitScript(()=>{
    const viewport=Object.assign(new EventTarget(),{width:innerWidth,height:innerHeight,offsetLeft:0,offsetTop:0})
    Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport})
  })
  await prepare(page)
  const dialog=await open(page)
  await dialog.getByRole('textbox',{name:'Pregunta para ChatGPT',exact:true}).fill('Pregunta con el teclado abierto')
  await page.evaluate(()=>{visualViewport.height=360;visualViewport.offsetTop=40;visualViewport.dispatchEvent(new Event('resize'))})
  await expect.poll(async()=>{const r=await dialog.boundingBox();return r.y>=40&&r.y+r.height<=400}).toBe(true)
  const send=dialog.getByRole('button',{name:'Enviar',exact:true})
  await send.scrollIntoViewIfNeeded()
  const box=await send.boundingBox()
  expect(box.y).toBeGreaterThanOrEqual(40);expect(box.y+box.height).toBeLessThanOrEqual(400)
  expect(box.height).toBeGreaterThanOrEqual(44)
  await send.tap()
  await expect(dialog.locator('.katex')).toHaveCount(1)
})

test('a finger can mark a board region and the crop returns attached to the tablet question',async({page,context})=>{
  await prepare(page)
  await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    const id=localStorage.getItem('pizarra_activa')
    const board=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').get(id);r.onsuccess=()=>resolve(r.result)})
    const content={...(board.draft??board.content??{}),camera:{x:0,y:0,zoom:1},strokes:[{points:[{x:150,y:350},{x:230,y:390}],width:3,color:'#000000'}]}
    await new Promise(resolve=>{const transaction=db.transaction('boards','readwrite');transaction.objectStore('boards').put({...board,content,draft:content});transaction.oncomplete=resolve})
    db.close()
  })
  await page.reload();await expect(page.locator('.library-open-button')).toContainText('privada')
  let dialog=await open(page)
  await dialog.getByRole('textbox',{name:'Pregunta para ChatGPT',exact:true}).fill('Explicá estos trazos')
  await dialog.getByRole('button',{name:'Adjuntar ▾',exact:true}).tap()
  await dialog.getByRole('menuitem',{name:'Selección de la pizarra',exact:true}).tap()
  await expect(page.locator('.ocr-selection-instruction')).toBeVisible()
  const touch=await context.newCDPSession(page)
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:100,y:300,id:1}]})
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:260,y:450,id:1}]})
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  dialog=page.getByRole('dialog',{name:'ChatGPT',exact:true})
  await dialog.getByRole('button',{name:'Con PC',exact:true}).tap()
  await expect(dialog.getByRole('button',{name:'Quitar recorte-de-la-pizarra.png',exact:true})).toBeVisible()
  await expect(dialog.getByRole('textbox',{name:'Pregunta para ChatGPT',exact:true})).toHaveValue('Explicá estos trazos')
  await expect(dialog.getByText('Tu cuenta · conectado desde la PC',{exact:true})).toBeVisible()
  let submitted,requests=0
  await page.route('**/api/chatgpt/consult',async route=>{
    requests++
    const req=route.request();submitted=await new Request(req.url(),{method:'POST',headers:req.headers(),body:req.postDataBuffer()}).formData()
    return route.fulfill({status:202,json:{id:'tablet-response',status:'running'}})
  })
  const send=dialog.getByRole('button',{name:'Enviar',exact:true})
  await expect(send).toBeEnabled()
  const position=await send.boundingBox()
  await touch.send('Input.synthesizeTapGesture',{x:position.x+position.width/2,y:position.y+position.height/2,duration:100,gestureSourceType:'touch'})
  await expect(dialog.locator('.katex')).toHaveCount(1)
  expect(submitted.get('prompt')).toBe('Explicá estos trazos')
  expect(submitted.getAll('files')).toHaveLength(1)
  expect(submitted.get('files').name).toBe('recorte-de-la-pizarra.png')
  expect(submitted.get('files').size).toBeGreaterThan(100)
  expect(requests).toBe(1)
})
