import { test, expect } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { createServer } from 'node:net'

// Real API/WebSockets and a disposable database. Never touch datos/ or port 8765.
let backend,storage,api,backendLogs=''
test.beforeAll(async()=>{
  storage=await mkdtemp(resolve(tmpdir(),'pizarra-phase1-'))
  const server=createServer()
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const port=server.address().port
  await new Promise(resolve=>server.close(resolve))
  api=`http://127.0.0.1:${port}`
  const serve="import sys, uvicorn; from web_host import app; uvicorn.run(app, host='127.0.0.1', port=int(sys.argv[1]), workers=1)"
  const python=process.env.PIZARRA_TEST_PYTHON??resolve(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python')
  backend=spawn(python,['-c',serve,String(port)],{
    cwd:process.cwd(),windowsHide:true,env:{...process.env,PIZARRA_DATA_DIR:storage,
      PIZARRA_FRONTEND_DIR:resolve(process.env.PIZARRA_TEST_PREVIEW==='1'?'dist-fase1':'dist'),
      PIZARRA_PUBLIC_ORIGINS:'http://127.0.0.1:4173',PIZARRA_WS_ORIGIN:api},
  })
  backend.stderr.on('data',data=>{backendLogs+=data.toString()})
  backend.stdout.on('data',()=>{})
  await expect.poll(async()=>{
    if(backend.exitCode!==null)throw new Error(backendLogs)
    try{return (await fetch(`${api}/healthz`)).status}catch{return 0}
  },{timeout:25000}).toBe(200)
})
test.afterAll(async()=>{
  if(backend && backend.exitCode===null) {
    if(process.platform==='win32')spawnSync('taskkill',['/pid',String(backend.pid),'/T','/F'],{windowsHide:true})
    else backend.kill()
    await new Promise(resolve=>backend.exitCode!==null?resolve():backend.once('exit',resolve))
  }
  // Check the exact temporary directory before recursively removing test data.
  if(storage && dirname(resolve(storage))===resolve(tmpdir()) && storage.split(/[\\/]/).at(-1).startsWith('pizarra-phase1-'))
    await rm(storage,{recursive:true,force:true,maxRetries:6,retryDelay:200})
})

async function signedIn(context,name) {
  const result=await context.request.post(`${api}/api/auth/guest`,{data:{name,password:'phase-one-password'}})
  expect(result.status()).toBe(200)
  return result.json()
}
async function cachedShapes(page) {
  return page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    return new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>{
      const active=localStorage.getItem('pizarra_activa'),board=r.result.find(b=>b.id===active)
      db.close();resolve((board?.draft??board?.content)?.shapes??[])
    }})
  })
}
async function drag(page,x,y,dx,dy) {
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:10});await page.mouse.up()
}
async function note(page,text) {
  await page.getByRole('button',{name:'Agregar nota adhesiva',exact:true}).click()
  await page.getByRole('textbox',{name:'Texto de la nota',exact:true}).fill(text)
  await page.getByRole('button',{name:'Aplicar',exact:true}).click()
}

test('private notes and academic templates support transform, group, layers, undo and reload',async({page})=>{
  test.setTimeout(60000)
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'offline'}))
  await page.goto('/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await note(page,'Idea de álgebra\nRepasar antes del parcial')
  await expect.poll(async()=>(await cachedShapes(page)).length).toBe(1)
  let shape=(await cachedShapes(page))[0]
  await page.getByRole('button',{name:'Editar nota',exact:true}).click()
  await page.getByRole('button',{name:'Color de nota 2',exact:true}).click()
  await page.getByRole('button',{name:'Aplicar',exact:true}).click()
  await expect.poll(async()=>(await cachedShapes(page))[0]?.note?.background).toBe('#ffd5df')
  await drag(page,shape.x+100,shape.y+70,-160,10)
  await expect.poll(async()=>(await cachedShapes(page))[0]?.x).toBe(shape.x-160)
  shape=(await cachedShapes(page))[0]
  await drag(page,shape.x+shape.width,shape.y+shape.height,70,50)
  await expect.poll(async()=>(await cachedShapes(page))[0]?.width).toBeGreaterThan(230)
  shape=(await cachedShapes(page))[0]
  await drag(page,shape.x+shape.width/2,shape.y-34,60,30)
  await expect.poll(async()=>Math.abs((await cachedShapes(page))[0]?.rotation??0)).toBeGreaterThan(.2)
  await page.keyboard.press('Control+c');await page.keyboard.press('Control+v')
  await expect.poll(async()=>(await cachedShapes(page)).length).toBe(2)
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await cachedShapes(page)).length).toBe(1)
  await page.keyboard.press('Control+y')
  await expect.poll(async()=>(await cachedShapes(page)).length).toBe(2)
  await page.keyboard.press('Control+a');await page.keyboard.press('Control+g')
  await expect.poll(async()=>{
    const shapes=await cachedShapes(page)
    return shapes.length===2 && shapes.every(s=>s.groupId && s.groupId===shapes[0].groupId)
  }).toBe(true)
  const group=(await cachedShapes(page))[0].groupId
  expect(group).toBeTruthy()
  await page.mouse.click(shape.x+shape.width/2,shape.y+shape.height/2,{button:'right'})
  await page.getByRole('menuitem',{name:'Traer al frente',exact:true}).click()
  await expect.poll(async()=>(await cachedShapes(page)).every(s=>typeof s.zIndex==='number')).toBe(true)
  await page.mouse.click(shape.x+shape.width/2,shape.y+shape.height/2,{button:'right'})
  await page.getByRole('menuitem',{name:'Desagrupar',exact:true}).click()
  await expect.poll(async()=>(await cachedShapes(page)).every(s=>!s.groupId)).toBe(true)
  await page.keyboard.press('Control+a');await page.keyboard.press('Delete')
  await expect.poll(async()=>(await cachedShapes(page)).length).toBe(0)
  await page.getByRole('button',{name:'Elementos académicos',exact:true}).click()
  await page.getByRole('button',{name:/Árbol binario/}).click()
  await expect.poll(async()=>(await cachedShapes(page)).length).toBe(13)
  await page.keyboard.press('Control+c');await page.keyboard.press('Control+v')
  await expect.poll(async()=>(await cachedShapes(page)).length).toBe(26)
  let shapes=await cachedShapes(page),ids=new Set(shapes.map(s=>s.id))
  expect(ids.size).toBe(26)
  expect(shapes.filter(s=>s.connector).every(s=>ids.has(s.connector.from.object.id)&&ids.has(s.connector.to.object.id))).toBe(true)
  await page.reload()
  await expect.poll(async()=>(await cachedShapes(page)).length).toBe(26)
  await page.keyboard.press('Control+a');await page.keyboard.press('Delete')
  await expect.poll(async()=>(await cachedShapes(page)).length).toBe(0)
  await page.getByRole('button',{name:'Elementos académicos',exact:true}).click()
  await page.getByRole('button',{name:/Puerta XOR/}).click()
  await expect.poll(async()=>(await cachedShapes(page))[0]?.symbol).toBe('xor')
  await page.getByRole('button',{name:'Editar elemento',exact:true}).click()
  await page.getByRole('textbox',{name:'Texto del elemento académico'}).fill('XOR')
  await page.getByRole('button',{name:'Aplicar',exact:true}).click()
  await page.getByRole('button',{name:'Cambiar apariencia'}).click()
  await page.getByRole('menuitemradio',{name:/Nocturno/}).click()
  await page.screenshot({path:'test-results/fase1-oscuro.png'})
  await page.setViewportSize({width:820,height:1180})
  await page.getByRole('button',{name:'Elementos académicos',exact:true}).click()
  await expect(page.getByRole('button',{name:'Editar elemento',exact:true})).toHaveCount(0)
  await expect(page.getByRole('searchbox',{name:'Buscar elemento académico',exact:true})).toBeVisible()
  await page.screenshot({path:'test-results/fase1-tablet.png'})
  await page.setViewportSize({width:390,height:844})
  const library=page.locator('.academic-library'),box=await library.boundingBox()
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x+box.width).toBeLessThanOrEqual(390)
  await page.screenshot({path:'test-results/fase1-movil.png'})
  await note(page,'Nota desde pantalla pequeña')
  await page.getByRole('button',{name:'Editar nota',exact:true}).click()
  const editor=await page.locator('.visual-inspector').boundingBox()
  expect(editor.x).toBeGreaterThanOrEqual(0)
  expect(editor.y+editor.height).toBeLessThan(844)
  await page.screenshot({path:'test-results/fase1-nota-movil.png'})
  await page.getByRole('button',{name:'Cancelar',exact:true}).click()
})

test('real backend synchronizes notes and connectors across contributors, including text conflicts and offline edits',async({browser})=>{
  test.setTimeout(90000)
  const contexts=await Promise.all([browser.newContext({viewport:{width:1366,height:900}}),browser.newContext({viewport:{width:1366,height:900}})])
  const [userA,userB]=await Promise.all(contexts.map((c,i)=>signedIn(c,`Visual browser ${i}`)))
  const owner=contexts[0].request
  const board=(await (await owner.post(`${api}/api/boards`,{data:{name:'Fase 1 compartida'}})).json()).id
  const token=(await (await owner.post(`${api}/api/share/boards/${board}`,{data:{role:'editor'}})).json()).token
  expect((await contexts[1].request.post(`${api}/api/share/join`,{data:{token}})).status()).toBe(200)
  const [a,b]=await Promise.all(contexts.map(c=>c.newPage()))
  await Promise.all([a.goto(api),b.goto(api)])
  await expect(a.getByRole('button',{name:`Seguir a ${userB.display_name}`})).toBeVisible()
  async function remote() {return (await (await owner.get(`${api}/api/boards/${board}`)).json()).content.shapes??[]}
  await note(a,'Original')
  await expect.poll(async()=>(await remote()).length).toBe(1)
  await expect.poll(async()=>(await cachedShapes(b)).length).toBe(1)
  await drag(a,683,450,-333,0)
  await expect.poll(async()=>(await remote())[0]?.x).toBe(235)
  await expect.poll(async()=>(await cachedShapes(b))[0]?.x).toBe(235)
  await Promise.all([a.keyboard.press('v'),b.keyboard.press('v')])
  await Promise.all([a.mouse.dblclick(350,420),b.mouse.dblclick(350,420)])
  await a.getByRole('textbox',{name:'Texto de la nota',exact:true}).fill('A estudia matrices')
  await b.getByRole('textbox',{name:'Texto de la nota',exact:true}).fill('B estudia vectores')
  await Promise.all([a.getByRole('button',{name:'Aplicar',exact:true}).click(),b.getByRole('button',{name:'Aplicar',exact:true}).click()])
  await expect.poll(async()=>{
    const n=(await remote())[0]?.note
    return n?[n.text,...(n.alternatives??[])].sort():[]
  },{timeout:15000}).toEqual(['A estudia matrices','B estudia vectores'])
  await note(b,'Destino')
  await drag(b,683,450,167,0)
  await expect.poll(async()=>(await remote()).find(s=>s.note?.text==='Destino')?.x).toBe(735)
  await expect.poll(async()=>(await cachedShapes(a)).length).toBe(2)
  await a.getByRole('button',{name:'Conectar objetos',exact:true}).click()
  await drag(a,350,450,500,0)
  await expect.poll(async()=>(await remote()).filter(s=>s.connector).length).toBe(1)
  await a.getByRole('button',{name:'Editar conector',exact:true}).click()
  await a.getByRole('combobox',{name:'Recorrido del conector'}).selectOption('curve')
  await a.getByRole('combobox',{name:'Terminación inicial'}).selectOption('diamond')
  await a.getByRole('combobox',{name:'Terminación final'}).selectOption('circle')
  await a.getByRole('combobox',{name:'Estilo del conector'}).selectOption('dash')
  await a.getByRole('textbox',{name:'Texto de la conexión'}).fill('depende de')
  await a.getByRole('button',{name:'Aplicar',exact:true}).click()
  await expect.poll(async()=>(await remote()).find(s=>s.connector)?.connector.label).toBe('depende de')
  await expect.poll(async()=>(await cachedShapes(b)).find(s=>s.connector)?.connector.label).toBe('depende de')
  await b.keyboard.press('v');await b.mouse.click(850,400);await drag(b,850,400,80,-70)
  await expect.poll(async()=>(await remote()).find(s=>s.note?.text==='Destino')?.x).toBe(815)
  await expect.poll(async()=>(await remote()).find(s=>s.connector)?.connector.end.x).toBeGreaterThan(735)
  await b.keyboard.press('Control+a');await b.keyboard.press('Control+c');await b.keyboard.press('Control+v')
  await expect.poll(async()=>(await remote()).length).toBe(6)
  const duplicate=await remote(),ids=new Set(duplicate.map(s=>s.id))
  expect(ids.size).toBe(6)
  const edges=duplicate.filter(s=>s.connector)
  expect(edges[0].connector.from.object.id).not.toBe(edges[1].connector.from.object.id)
  expect(edges.every(e=>ids.has(e.connector.from.object.id)&&ids.has(e.connector.to.object.id))).toBe(true)
  await expect.poll(async()=>(await cachedShapes(a)).length).toBe(6)
  // Offline changes stay in B's replica, then reconcile against a new server edit.
  await b.route('**/api/**',route=>route.abort('failed'))
  await b.keyboard.press('Control+a');await b.keyboard.press('Delete')
  await expect.poll(async()=>(await cachedShapes(b)).length).toBe(0)
  await note(a,'A sigue conectada')
  await expect.poll(async()=>(await remote()).length).toBe(7)
  await b.unroute('**/api/**')
  await b.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await expect.poll(async()=>(await remote()).map(s=>s.note?.text),{timeout:20000}).toEqual(['A sigue conectada'])
  await expect.poll(async()=>(await cachedShapes(b)).map(s=>s.note?.text)).toEqual(['A sigue conectada'])
  // Structured matrices reuse the same real HTTP version/WS notification flow.
  await a.getByRole('button',{name:'Elementos académicos',exact:true}).click()
  await a.getByRole('button',{name:/^Matriz/}).click()
  await expect.poll(async()=>(await cachedShapes(b)).find(s=>s.symbol==='matrix')?.matrix).toEqual([['1','0'],['0','1']])
  await a.getByRole('button',{name:'Editar elemento',exact:true}).click()
  await b.keyboard.press('v');await b.mouse.dblclick(683,450)
  await a.getByRole('textbox',{name:'Matriz del lienzo: fila 1, columna 1',exact:true}).fill('2')
  await b.getByRole('textbox',{name:'Matriz del lienzo: fila 2, columna 2',exact:true}).fill('3')
  await Promise.all([a.getByRole('button',{name:'Aplicar',exact:true}).click(),b.getByRole('button',{name:'Aplicar',exact:true}).click()])
  await expect.poll(async()=>(await remote()).find(s=>s.symbol==='matrix')?.matrix).toEqual([['2','0'],['0','3']])
  await expect.poll(async()=>(await cachedShapes(b)).find(s=>s.symbol==='matrix')?.matrix).toEqual([['2','0'],['0','3']])
  await a.screenshot({path:'test-results/fase1-colaboracion.png'})
  expect(userA.id).not.toBe(userB.id)
  await Promise.all(contexts.map(c=>c.close()))
})
