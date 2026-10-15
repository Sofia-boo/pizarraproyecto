import {test,expect} from '@playwright/test'

async function open(page){
  await page.route('**/api/**',route=>route.fulfill({status:401,json:{}}))
  await page.goto('/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo',exact:true}).click()
  await expect(page.locator('.app>canvas').first()).toBeVisible()
}
async function content(page){return page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
  const value=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').get(localStorage.getItem('pizarra_activa'));r.onsuccess=()=>resolve(r.result)})
  db.close();return value?.content
})}
test('compact pen settings and selected text color persist and undo',async({page})=>{
  await open(page)
  await page.getByRole('button',{name:'Opciones del lápiz',exact:true}).click()
  const settings=page.getByRole('group',{name:'Configuración del lápiz'})
  expect((await settings.boundingBox()).height).toBeLessThan(65)
  await page.getByRole('button',{name:'Opciones de texto',exact:true}).click()
  await page.mouse.click(150,350)
  await page.locator('.text-editor').fill('Texto de prueba')
  await page.locator('.text-editor').press('Control+Enter')
  await expect.poll(async()=>(await content(page))?.texts.length).toBe(1)
  const original=(await content(page)).texts[0].color
  await page.getByRole('button',{name:'Seleccionar área',exact:true}).click()
  await page.mouse.click(170,355)
  await page.getByRole('button',{name:'Opciones de texto',exact:true}).click()
  await page.getByRole('group',{name:'Configuración de texto'}).getByRole('button',{name:'Elegir color #ef4444',exact:true}).click()
  await expect.poll(async()=>(await content(page)).texts[0].color).toBe('#ef4444')
  await page.getByRole('button',{name:'Deshacer',exact:true}).click()
  await expect.poll(async()=>(await content(page)).texts[0].color).toBe(original)
  await page.getByRole('button',{name:'Rehacer',exact:true}).click()
  await expect.poll(async()=>(await content(page)).texts[0].color).toBe('#ef4444')
  await page.reload()
  await expect.poll(async()=>(await content(page)).texts[0].color).toBe('#ef4444')
})
test('Gemini sends attachments in app, renders math, inserts editable and deletes chat',async({page})=>{
  await page.setViewportSize({width:1280,height:800})
  await open(page)
  await page.route('**/api/study-ai/status',route=>route.fulfill({json:{configured:true}}))
  let sent=''
  await page.route('**/api/study-ai/consult',async route=>{sent=route.request().postData();await route.fulfill({json:{text:'Resultado: \\(\\frac{1}{2}\\) y \\(\\begin{pmatrix}1\\\\2\\end{pmatrix}\\)',truncated:false}})})
  await page.getByRole('button',{name:'IA: opciones de reconocimiento'}).click()
  await page.getByRole('menuitem',{name:'Consultar con Gemini'}).click()
  const dialog=page.getByRole('dialog',{name:'Gemini',exact:true})
  await dialog.locator('input[type=file]').setInputFiles({name:'ejercicio.png',mimeType:'image/png',buffer:Buffer.from('test-image')})
  await page.getByRole('textbox',{name:'Consulta para Gemini'}).fill('Resolvé este ejercicio')
  await dialog.getByRole('button',{name:'Enviar',exact:true}).click()
  await expect(dialog.locator('.assistant .katex')).toHaveCount(2)
  expect(sent).toContain('ejercicio.png');expect(sent).toContain('Resolvé este ejercicio')
  await dialog.getByRole('button',{name:'Insertar editable',exact:true}).click()
  await expect.poll(async()=>((await content(page))?.shapes??[]).length).toBeGreaterThan(0)
  await dialog.getByRole('button',{name:'Eliminar chat',exact:true}).click()
  await dialog.getByRole('button',{name:'Sí, eliminar',exact:true}).click()
  await expect(dialog.locator('.chatgpt-message')).toHaveCount(0)
  await dialog.getByRole('button',{name:'Cerrar asistente'}).click()
  await expect.poll(async()=>((await content(page))?.shapes??[]).length).toBeGreaterThan(0)
})

test('selected handwriting can change color from its context menu',async({page})=>{
  await open(page)
  await page.getByRole('button',{name:'Opciones del lápiz',exact:true}).click()
  await page.mouse.move(180,380);await page.mouse.down();await page.mouse.move(320,380,{steps:10});await page.mouse.up()
  await expect.poll(async()=>(await content(page))?.strokes.length).toBe(1)
  await page.getByRole('button',{name:'Seleccionar área',exact:true}).click()
  await page.mouse.click(230,380,{button:'right'})
  await page.getByRole('group',{name:'Color del texto seleccionado'}).getByRole('button',{name:'Elegir color #2563eb',exact:true}).click()
  await expect.poll(async()=>(await content(page)).strokes[0].color).toBe('#2563eb')
})

test('handwriting selection is sent as an image and transcription is inserted automatically',async({page})=>{
  await open(page)
  await page.route('**/api/study-ai/status',route=>route.fulfill({json:{configured:true}}))
  let body=''
  await page.route('**/api/study-ai/consult',async route=>{body=route.request().postData();await route.fulfill({json:{text:'Hay un teorema',truncated:false}})})
  await page.getByRole('button',{name:'Opciones del lápiz',exact:true}).click()
  await page.mouse.move(180,380);await page.mouse.down();await page.mouse.move(320,380,{steps:10});await page.mouse.up()
  await page.getByRole('button',{name:'Seleccionar área',exact:true}).click()
  await page.mouse.click(230,380)
  await page.getByRole('button',{name:'IA: opciones de reconocimiento'}).click()
  await page.getByRole('menuitem',{name:'Transcribir manuscrito con Gemini',exact:true}).click()
  await expect.poll(async()=>(await content(page))?.texts[0]?.text).toBe('Hay un teorema')
  expect(body).toContain('seleccion-de-la-pizarra.png')
  await expect(page.getByRole('dialog',{name:'Gemini'}).getByRole('status')).toContainText('Transcripción insertada')
})

test('failed HTML consultation keeps its prompt and attaches a complete reply as an inactive HTML widget',async({page})=>{
  await open(page)
  await page.route('**/api/study-ai/status',route=>route.fulfill({json:{configured:true}}))
  let calls=0
  const html='<!doctype html><html><body><button id="move" onclick="this.textContent=\'Moviendo\'">Mover</button></body></html>'
  await page.route('**/api/study-ai/consult',route=>{
    calls++
    return route.fulfill(calls===1?{status:503,json:{detail:'Gemini está saturado (503). Tu consulta se conserva.'}}:{json:{text:'```html\n'+html+'\n```',truncated:false}})
  })
  await page.getByRole('button',{name:'IA: opciones de reconocimiento'}).click()
  await page.getByRole('menuitem',{name:'Consultar con Gemini'}).click()
  const dialog=page.getByRole('dialog',{name:'Gemini',exact:true}),question=dialog.getByRole('textbox',{name:'Consulta para Gemini'})
  await question.fill('Generá un HTML interactivo de velocidad tiempo y distancia')
  await dialog.getByRole('button',{name:'Enviar',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('503')
  await expect(question).toHaveValue('Generá un HTML interactivo de velocidad tiempo y distancia')
  await expect(dialog.locator('.chatgpt-message')).toHaveCount(0)
  await dialog.getByRole('button',{name:'Enviar',exact:true}).click()
  await dialog.getByRole('button',{name:'Insertar HTML interactivo',exact:true}).click()
  await expect.poll(async()=>(await content(page)).shapes.find(shape=>shape.visualType==='html')?.html.source).toBe(html)
  await expect(page.locator('.board-html-widget iframe')).toHaveCount(0)
  await dialog.getByRole('button',{name:'Cerrar asistente'}).click()
  await page.getByRole('button',{name:'Activar HTML interactivo-gemini.html',exact:true}).click()
  const frame=page.frameLocator('.board-html-widget iframe')
  await frame.getByRole('button',{name:'Mover',exact:true}).click()
  await expect(frame.getByRole('button',{name:'Moviendo',exact:true})).toBeVisible()
})
