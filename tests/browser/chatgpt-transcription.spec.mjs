import {test,expect} from '@playwright/test'

async function content(page){return page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
  const all=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>resolve(r.result)})
  db.close();const board=all.find(b=>b.id===localStorage.getItem('pizarra_activa'));return board?.draft??board?.content
})}
async function prepare(page,pc=false){
  await page.addInitScript(pc=>{if(pc)sessionStorage.setItem('chatgpt-mode:device','pc')},pc)
  await page.goto('/');await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect.poll(async()=>(await content(page))?.camera).toBeDefined()
  await page.keyboard.press('p');await page.mouse.move(200,350);await page.mouse.down();await page.mouse.move(300,400,{steps:10});await page.mouse.up()
  await expect.poll(async()=>(await content(page))?.strokes?.length).toBe(1)
  await page.getByRole('button',{name:'Seleccionar área',exact:true}).click();await page.keyboard.press('Control+a')
}
async function transcribe(page){
  await page.getByRole('button',{name:'IA: opciones de reconocimiento',exact:true}).click()
  await page.getByRole('menuitem',{name:'Transcribir manuscrito con ChatGPT',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'ChatGPT',exact:true})
  await expect(dialog.getByRole('button',{name:'Con PC',exact:true})).toHaveCount(0)
  return dialog
}

test('automatic transcription sends the selected ink once and inserts editable text on completion',async({page})=>{
  let sends=0
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname
    if(path.endsWith('/chatgpt/status'))return route.fulfill({json:{state:'ready'}})
    if(path.endsWith('/chatgpt/consult')){
      sends++
      const form=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData()
      expect(form.get('prompt')).toContain('en español')
      expect(form.getAll('files')).toHaveLength(1)
      return route.fulfill({status:202,json:{id:'transcription-job',status:'running'}})
    }
    if(path.endsWith('/chatgpt/consult/transcription-job'))return route.fulfill({json:{id:'transcription-job',status:'complete',text:'Mi manuscrito con espacios'}})
    return route.fulfill({status:503,body:'isolated fixture'})
  })
  await prepare(page)
  const dialog=await transcribe(page)
  await dialog.getByRole('button',{name:'Conectar ChatGPT',exact:true}).click()
  await expect.poll(async()=>(await content(page))?.texts?.[0]?.text).toBe('Mi manuscrito con espacios')
  const saved=await content(page)
  expect(saved.strokes).toHaveLength(1);expect(saved.texts).toHaveLength(1);expect(sends).toBe(1)
  await dialog.getByRole('button',{name:'Cerrar ChatGPT',exact:true}).click()
  await page.reload()
  expect((await content(page)).texts).toHaveLength(1);expect(sends).toBe(1)
})

test('without a PC the menu has no OCR and pasting a transcription creates editable text without duplicate ink changes',async({page})=>{
  const requests=[];page.on('request',r=>{if(/\/(api\/(ocr|chatgpt)|recognize)\//.test(new URL(r.url()).pathname))requests.push(r.url())})
  await page.route('**/api/**',r=>r.fulfill({status:503,body:'PC apagada'}))
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text},readText:async()=> 'Apuntes en español\n$\\frac{1}{2}$'}}))
  await prepare(page)
  await page.getByRole('button',{name:'IA: opciones de reconocimiento',exact:true}).click()
  const menu=page.getByRole('menu',{name:'Reconocimiento con IA',exact:true})
  await expect(menu.getByRole('menuitem')).toHaveCount(2);await expect(menu).not.toContainText(/Datalab|Enseñar|local|Escanear/)
  await page.getByRole('menuitem',{name:'Transcribir manuscrito con ChatGPT',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'ChatGPT',exact:true})
  await expect(dialog.getByRole('textbox',{name:'Pregunta para ChatGPT',exact:true})).toHaveValue(/Transcribí únicamente.*en español/)
  const download=page.waitForEvent('download');await dialog.getByRole('button',{name:/Descargar seleccion-de-la-pizarra/}).click();expect((await download).suggestedFilename()).toBe('seleccion-de-la-pizarra.png')
  await dialog.getByRole('button',{name:'Copiar pregunta',exact:true}).click();expect(await page.evaluate(()=>window.copied)).toContain('Conservá palabras, espacios')
  await dialog.getByRole('button',{name:'Pegar transcripción',exact:true}).click()
  await expect.poll(async()=>(await content(page))?.texts?.[0]?.text).toBe('Apuntes en español\n1/2')
  await dialog.getByRole('button',{name:'Pegar transcripción',exact:true}).click()
  const saved=await content(page);expect(saved.texts).toHaveLength(1);expect(saved.strokes).toHaveLength(1);expect(requests).toEqual([])
})

test.describe('tablet transcription',()=>{
  test.use({viewport:{width:800,height:1280},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (Linux; Android 14; Lenovo Tab M11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'})
  test('finger selection shares a crop and Spanish instruction, then pastes editable text with no PC requests',async({page,context})=>{
    const requests=[];page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/chatgpt/'))requests.push(r.url())})
    await page.route('**/api/**',r=>r.fulfill({status:503,body:'PC apagada'}))
    await page.addInitScript(()=>{
      Object.defineProperty(navigator,'canShare',{value:()=>true})
      Object.defineProperty(navigator,'share',{value:async data=>{window.shared={text:data.text,files:data.files.map(f=>({name:f.name,type:f.type,size:f.size}))}}})
      Object.defineProperty(navigator,'clipboard',{value:{readText:async()=> 'Texto de mi manuscrito'}})
    })
    await page.goto('/');await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).tap()
    await expect.poll(async()=>(await content(page))?.camera).toBeDefined()
    await page.mouse.move(200,350);await page.mouse.down();await page.mouse.move(300,400,{steps:8});await page.mouse.up()
    await expect.poll(async()=>(await content(page))?.strokes?.length).toBe(1)
    await page.getByRole('button',{name:'IA: opciones de reconocimiento',exact:true}).tap()
    await page.getByRole('menuitem',{name:'Transcribir manuscrito con ChatGPT',exact:true}).tap()
    await expect(page.locator('.chatgpt-selection-instruction')).toBeVisible()
    const touch=await context.newCDPSession(page)
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:100,y:300,id:1}]})
    await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:340,y:450,id:1}]})
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    const dialog=page.getByRole('dialog',{name:'ChatGPT',exact:true})
    await expect(dialog.getByRole('textbox',{name:'Pregunta para ChatGPT',exact:true})).toHaveValue(/Transcribí únicamente/)
    await dialog.getByRole('button',{name:'Compartir consulta…',exact:true}).tap()
    const shared=await page.evaluate(()=>window.shared)
    expect(shared.text).toContain('en español');expect(shared.files).toHaveLength(1);expect(shared.files[0].name).toBe('recorte-de-la-pizarra.png');expect(shared.files[0].size).toBeGreaterThan(100)
    await dialog.getByRole('button',{name:'Pegar transcripción',exact:true}).tap()
    await expect.poll(async()=>(await content(page))?.texts?.[0]?.text).toBe('Texto de mi manuscrito')
    expect((await content(page)).strokes).toHaveLength(1);expect(requests).toEqual([])
  })
})
