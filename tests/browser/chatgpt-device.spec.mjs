import {test,expect} from '@playwright/test'

test.use({viewport:{width:800,height:1280},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (Linux; Android 14; Lenovo Tab M11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'})
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=','base64')

async function open(page){
  await page.getByRole('button',{name:'IA: opciones de reconocimiento',exact:true}).tap()
  await page.getByRole('menuitem',{name:/Consultar con ChatGPT/}).tap()
  return page.getByRole('dialog',{name:'ChatGPT',exact:true})
}
async function prepare(page){
  const pcRequests=[]
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/chatgpt/'))pcRequests.push(r.url())})
  await page.route('**/api/**',r=>r.fulfill({status:503,body:'PC apagada'}))
  await page.goto('/');await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).tap()
  await expect(page.locator('.library-open-button')).toContainText('privada')
  await expect.poll(()=>page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    const all=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>resolve(r.result)})
    db.close();const saved=all.find(b=>b.id===localStorage.getItem('pizarra_activa'));return (saved?.draft??saved?.content)?.camera
  })).toBeDefined()
  return pcRequests
}

test('default tablet mode opens and reopens official ChatGPT with the PC unavailable and inserts pasted mathematics',async({page,context})=>{
  const popups=[];page.on('popup',popup=>popups.push(popup))
  await page.addInitScript(()=>{
    window.copied=''
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text},readText:async()=> '## Solución\nResultado: $\\frac{1}{2}$'}})
  })
  await context.route('https://chatgpt.com/**',r=>r.fulfill({contentType:'text/html',body:'<h1>ChatGPT oficial simulado</h1>'}))
  const requests=await prepare(page)
  let dialog=await open(page)
  await expect(dialog.getByText('Tu cuenta personal · navegador de este dispositivo',{exact:true})).toBeVisible()
  await expect(dialog.getByRole('button',{name:'Conectar mi ChatGPT en la PC'})).toHaveCount(0)
  await dialog.getByRole('textbox',{name:'Pregunta para ChatGPT',exact:true}).fill('Resolver mi ejercicio')
  await dialog.locator('input[type=file]').setInputFiles({name:'ejercicio.png',mimeType:'image/png',buffer:png})
  const download=page.waitForEvent('download')
  await dialog.getByRole('button',{name:'Descargar ejercicio.png',exact:true}).tap()
  expect((await download).suggestedFilename()).toBe('ejercicio.png')
  await dialog.getByRole('button',{name:'Copiar pregunta',exact:true}).tap()
  expect(await page.evaluate(()=>window.copied)).toBe('Resolver mi ejercicio')
  for(const name of ['Abrir ChatGPT en este dispositivo','Volver a abrir ChatGPT']){
    const opened=page.waitForEvent('popup');await dialog.getByRole('button',{name,exact:true}).tap()
    const popup=await opened;await popup.waitForURL('https://chatgpt.com/')
    expect(await popup.evaluate(()=>window.opener)).toBeNull()
    await popup.close()
  }
  expect(popups).toHaveLength(2)
  await dialog.getByRole('button',{name:'Pegar respuesta en la pizarra',exact:true}).tap()
  await expect(dialog.getByRole('status')).toHaveText('Respuesta agregada a la pizarra.')
  await dialog.getByRole('button',{name:'Cerrar ChatGPT',exact:true}).tap()
  await page.reload();dialog=await open(page)
  await expect(dialog.getByRole('textbox',{name:'Pregunta para ChatGPT',exact:true})).toHaveValue('Resolver mi ejercicio')
  await expect(dialog.getByRole('button',{name:'Descargar ejercicio.png',exact:true})).toBeVisible()
  expect(requests).toEqual([])
  await page.screenshot({path:'test-results/chatgpt-sin-pc-tablet.png'})
})

test('sharing sends only the chosen local file and question to the device share sheet',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'canShare',{value:()=>true})
    window.shareCalls=0
    Object.defineProperty(navigator,'share',{value:async data=>{window.shareCalls++;window.shared={text:data.text,files:await Promise.all((data.files??[]).map(async f=>({name:f.name,type:f.type,size:f.size})))}}})
  })
  const requests=await prepare(page),dialog=await open(page)
  await dialog.getByRole('textbox',{name:'Pregunta para ChatGPT',exact:true}).fill('Explicar la foto')
  await dialog.locator('input[type=file]').setInputFiles({name:'foto.png',mimeType:'image/png',buffer:png})
  await dialog.getByRole('button',{name:'Compartir consulta…',exact:true}).tap()
  await expect.poll(()=>page.evaluate(()=>window.shared)).toEqual({text:'Explicar la foto',files:[{name:'foto.png',type:'image/png',size:png.length}]})
  expect(await page.evaluate(()=>window.shareCalls)).toBe(1)
  expect(requests).toEqual([])
})

test('tablet can download a finger-selected crop and open official ChatGPT without the PC',async({page,context})=>{
  await context.route('https://chatgpt.com/**',r=>r.fulfill({contentType:'text/html',body:'<h1>ChatGPT simulado</h1>'}))
  const requests=await prepare(page)
  await page.mouse.move(150,350);await page.mouse.down();await page.mouse.move(230,390,{steps:5});await page.mouse.up()
  let dialog=await open(page)
  await dialog.getByRole('textbox',{name:'Pregunta para ChatGPT',exact:true}).fill('Explicar el recorte')
  await dialog.getByRole('button',{name:'Adjuntar ▾',exact:true}).tap()
  await dialog.getByRole('menuitem',{name:'Selección de la pizarra',exact:true}).tap()
  await expect(page.locator('.chatgpt-selection-instruction')).toBeVisible()
  const touch=await context.newCDPSession(page)
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:100,y:300,id:1}]})
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:260,y:450,id:1}]})
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  dialog=page.getByRole('dialog',{name:'ChatGPT',exact:true})
  await expect(dialog.getByRole('textbox',{name:'Pregunta para ChatGPT',exact:true})).toHaveValue('Explicar el recorte')
  const download=page.waitForEvent('download')
  await dialog.getByRole('button',{name:'Descargar recorte-de-la-pizarra.png',exact:true}).tap()
  expect((await download).suggestedFilename()).toBe('recorte-de-la-pizarra.png')
  const opening=page.waitForEvent('popup');await dialog.getByRole('button',{name:'Abrir ChatGPT en este dispositivo',exact:true}).tap()
  const popup=await opening;await popup.waitForURL('https://chatgpt.com/');await popup.close()
  expect(requests).toEqual([])
})

test('independent mode keeps copy and open controls visible above the Android keyboard',async({page})=>{
  await page.setViewportSize({width:1280,height:800})
  await page.addInitScript(()=>{
    const viewport=Object.assign(new EventTarget(),{width:innerWidth,height:innerHeight,offsetLeft:0,offsetTop:0})
    Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport})
  })
  const requests=await prepare(page),dialog=await open(page)
  await dialog.getByRole('textbox',{name:'Pregunta para ChatGPT',exact:true}).fill('Conservar el espacio al escribir')
  await page.evaluate(()=>{visualViewport.height=360;visualViewport.offsetTop=40;visualViewport.dispatchEvent(new Event('resize'))})
  for(const name of ['Copiar pregunta','Abrir ChatGPT en este dispositivo']){
    const button=dialog.getByRole('button',{name,exact:true})
    await button.scrollIntoViewIfNeeded()
    const box=await button.boundingBox()
    expect(box.y).toBeGreaterThanOrEqual(40);expect(box.y+box.height).toBeLessThanOrEqual(400)
  }
  expect(requests).toEqual([])
})

test('blocked popups keep the draft and provide a direct official link',async({page})=>{
  await page.addInitScript(()=>{window.open=()=>null})
  const requests=await prepare(page),dialog=await open(page)
  await dialog.getByRole('textbox',{name:'Pregunta para ChatGPT',exact:true}).fill('No perder este ejercicio')
  await dialog.getByRole('button',{name:'Abrir ChatGPT en este dispositivo',exact:true}).tap()
  await expect(dialog.getByRole('alert')).toContainText('bloqueó la ventana')
  await expect(dialog.getByRole('link',{name:'Abrir directamente',exact:true})).toHaveAttribute('href','https://chatgpt.com/')
  await expect(dialog.getByRole('textbox',{name:'Pregunta para ChatGPT',exact:true})).toHaveValue('No perder este ejercicio')
  expect(requests).toEqual([])
})
