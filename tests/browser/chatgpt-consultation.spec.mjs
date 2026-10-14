import {test,expect} from '@playwright/test'
const answer='## Solución\n**Resultado:** $\\frac{1}{2}$.\n\n$$\\frac{1}{2} \\cdot \\frac{1}{3} = \\frac{1}{6}$$'
async function open(page){
  await page.getByRole('button',{name:'IA: opciones de reconocimiento',exact:true}).click()
  await page.getByRole('menuitem',{name:/Consultar con ChatGPT/}).click()
  return page.getByRole('dialog',{name:'ChatGPT',exact:true})
}
async function board(page){return page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
  const all=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>resolve(r.result)})
  db.close();const saved=all.find(b=>b.id===localStorage.getItem('pizarra_activa'));return saved?.draft??saved?.content
})}
test('desktop and tablet consult inside the app, attach files automatically and insert formatted responses',async({page,context})=>{
  let submitted,polls=0
  const popups=[];page.on('popup',p=>popups.push(p))
  await page.setViewportSize({width:800,height:900})
  await context.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/chatgpt/status')return route.fulfill({json:{state:'ready'}})
    if(path==='/api/chatgpt/consult'){
      const req=route.request();submitted=await new Request(req.url(),{method:'POST',headers:req.headers(),body:req.postDataBuffer()}).formData()
      return route.fulfill({status:202,json:{id:'response-1',status:'running'}})
    }
    if(path==='/api/chatgpt/consult/response-1'){polls++;return route.fulfill({json:polls<2?{id:'response-1',status:'running'}:{id:'response-1',status:'complete',text:answer}})}
    return route.fulfill({status:503,body:'offline'})
  })
  await page.goto('/');await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect(page.locator('.library-open-button')).toContainText('privada')
  await page.mouse.move(200,300);await page.mouse.down();await page.mouse.move(350,380,{steps:5});await page.mouse.up()
  let dialog=await open(page)
  await expect(dialog.getByRole('button',{name:'Conectar mi ChatGPT en la PC'})).toHaveCount(0)
  await expect(dialog.locator('iframe,input[type=password]')).toHaveCount(0)
  await dialog.locator('input[type=file]').setInputFiles({name:'ejercicio.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=','base64')})
  await dialog.getByRole('textbox',{name:'Pregunta para ChatGPT',exact:true}).fill('Resolvé mi ejercicio paso a paso')
  await dialog.getByRole('button',{name:'Enviar',exact:true}).click()
  await expect(dialog.getByRole('heading',{name:'Solución',exact:true})).toBeVisible()
  await expect(dialog.locator('.katex')).toHaveCount(2)
  expect(submitted.get('prompt')).toBe('Resolvé mi ejercicio paso a paso')
  expect(submitted.getAll('files')[0].name).toBe('ejercicio.png')
  expect((await board(page)).strokes).toHaveLength(1)
  await dialog.getByRole('button',{name:'Insertar en pizarra',exact:true}).click()
  await expect(dialog.getByRole('status')).toHaveText('Respuesta agregada a la pizarra.')
  await expect.poll(async()=>(await board(page)).media.length).toBe(1)
  await dialog.getByRole('button',{name:'Texto editable',exact:true}).click()
  await expect.poll(async()=>(await board(page)).texts.length).toBe(1)
  expect((await board(page)).texts[0].text).toContain('Resultado: 1/2')
  await page.screenshot({path:'test-results/chatgpt-en-app-tablet.png'})
  await dialog.getByRole('button',{name:'Cerrar ChatGPT',exact:true}).click()
  await page.reload();dialog=await open(page)
  await expect(dialog.getByRole('heading',{name:'Solución',exact:true})).toBeVisible()
  await context.setOffline(true)
  await expect(dialog.getByRole('button',{name:'Enviar',exact:true})).toBeDisabled()
  await expect(dialog.getByRole('button',{name:'Insertar en pizarra',exact:true})).toBeEnabled()
  expect(popups).toHaveLength(0)
})
test('paste response inserts directly without an intermediate preview or insert step',async({page})=>{
  await page.addInitScript(text=>Object.defineProperty(navigator,'clipboard',{value:{readText:async()=>text}}),answer)
  await page.route('**/api/**',route=>route.fulfill({status:401,json:{detail:'login'}}))
  await page.goto('/');await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect(page.locator('.library-open-button')).toContainText('privada')
  const dialog=await open(page)
  await dialog.getByRole('button',{name:'Pegar respuesta en la pizarra',exact:true}).click()
  await expect(dialog.getByRole('status')).toHaveText('Respuesta agregada a la pizarra.')
  await expect.poll(async()=>(await board(page)).media.length).toBe(1)
  await expect(dialog.getByRole('textbox',{name:'Respuesta para pegar en la pizarra'})).toHaveCount(0)
})
