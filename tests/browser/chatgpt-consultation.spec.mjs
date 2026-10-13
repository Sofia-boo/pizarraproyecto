import {test,expect} from '@playwright/test'

async function open(page){
  await page.getByRole('button',{name:'IA: opciones de reconocimiento',exact:true}).click()
  await page.getByRole('menuitem',{name:/Consultar con ChatGPT/}).click()
  return page.getByRole('dialog',{name:'Consultar con ChatGPT',exact:true})
}
async function board(page){return page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const request=indexedDB.open('pizarra-dispositivo',1);request.onsuccess=()=>resolve(request.result)})
  const result=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>resolve(r.result)})
  db.close();const saved=result.find(b=>b.id===localStorage.getItem('pizarra_activa'));return saved?.draft??saved?.content
})}
test('official browser window returns to the saved board and pasted mathematics keeps its format',async({page,context})=>{
  test.setTimeout(60000)
  await page.setViewportSize({width:800,height:900})
  await context.route('**/api/**',r=>r.fulfill({status:503,body:'offline'}))
  await context.route('https://chatgpt.com/**',r=>r.fulfill({contentType:'text/html',body:'<title>Interfaz oficial simulada</title><p>ChatGPT</p>'}))
  const external=[]
  context.on('request',r=>{if(/api\.openai\.com|huggingface\.co/.test(r.url()))external.push(r.url())})
  await page.goto('/');await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect(page.locator('.library-open-button')).toContainText('privada')
  await page.mouse.move(200,300);await page.mouse.down();await page.mouse.move(350,380,{steps:5});await page.mouse.up()
  const id=await page.evaluate(()=>localStorage.getItem('pizarra_activa'))
  let dialog=await open(page)
  const launch=dialog.getByRole('button',{name:'Consultar con ChatGPT ↗',exact:true})
  await expect(launch).toBeEnabled()
  const saved=await board(page);expect(saved.strokes).toHaveLength(1)
  const opened=page.waitForEvent('popup');await launch.click();const popup=await opened
  await expect(popup).toHaveURL('https://chatgpt.com/')
  expect(await popup.evaluate(()=>window.opener)).toBeNull()
  await popup.close()
  expect(await page.evaluate(()=>localStorage.getItem('pizarra_activa'))).toBe(id)
  expect((await board(page)).strokes).toEqual(saved.strokes)
  const answer='## Solución\n**Resultado:** $\\frac{1}{2}$.\n\n$$\\frac{1}{2} \\cdot \\frac{1}{3} = \\frac{1}{6}$$'
  await dialog.getByRole('textbox',{name:'Respuesta de ChatGPT',exact:true}).fill(answer)
  await expect(dialog.getByRole('heading',{name:'Solución',exact:true})).toBeVisible()
  await expect(dialog.locator('.katex')).toHaveCount(2)
  await dialog.getByRole('button',{name:'Insertar en pizarra con formato',exact:true}).click()
  await expect(dialog.getByRole('status')).toHaveText('Respuesta agregada a la pizarra.')
  await expect.poll(async()=>(await board(page)).media.length).toBe(1)
  expect((await board(page)).media[0].name).toBe('respuesta-chatgpt.png')
  await dialog.getByRole('button',{name:'Insertar como texto',exact:true}).click()
  await expect.poll(async()=>(await board(page)).texts.length).toBe(1)
  const text=(await board(page)).texts.at(-1).text
  expect(text).toContain('Solución');expect(text).toContain('Resultado: 1/2');expect(text).not.toContain('\\frac');expect(text).not.toContain('##')
  await page.screenshot({path:'test-results/chatgpt-panel-tablet.png'})
  await dialog.getByRole('button',{name:'Cerrar consulta con ChatGPT',exact:true}).click()
  await page.reload();dialog=await open(page)
  await expect(dialog.getByRole('textbox',{name:'Respuesta de ChatGPT',exact:true})).toHaveValue(answer)
  await context.setOffline(true)
  await expect(dialog.getByRole('button',{name:'Consultar con ChatGPT ↗',exact:true})).toBeDisabled()
  await expect(dialog.getByRole('button',{name:'Insertar como texto',exact:true})).toBeEnabled()
  expect(external).toEqual([])
})

test('Android native mode provides the Custom Tabs handoff without a ChatGPT login form',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'userAgent',{get:()=> 'Mozilla/5.0 (Linux; Android 14; Lenovo TB330FU) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'}))
  await page.route('**/api/**',r=>r.fulfill({status:503,body:'offline'}))
  await page.goto('/?app=1&native=1');await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  const dialog=await open(page)
  await expect(dialog.getByRole('button',{name:'Consultar con ChatGPT ↗',exact:true})).toBeEnabled()
  await expect(dialog.locator('input[type=password],iframe')).toHaveCount(0)
  await expect(dialog.getByRole('link',{name:/Instalar app Android/})).toHaveCount(0)
  expect(await page.evaluate(()=>sessionStorage.getItem('pizarra-native-browser'))).toBe('1')
})
