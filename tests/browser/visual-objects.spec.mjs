import { test, expect } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
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

test('four digit join switches boards, keeps pending work and follows a different viewport',async({browser})=>{
  const contexts=await Promise.all([browser.newContext({viewport:{width:1600,height:900}}),browser.newContext({viewport:{width:800,height:1100}})])
  try{
    const profiles=await Promise.all(contexts.map((c,i)=>signedIn(c,`Code browser ${i}`)))
    const board=(await (await contexts[0].request.post(`${api}/api/boards`,{data:{name:'Código compartido'}})).json()).id
    const pages=await Promise.all(contexts.map(c=>c.newPage()))
    await Promise.all(pages.map(p=>p.goto(api)))
    for(const page of pages)await expect(page.locator('.toolbar')).toBeVisible()
    await pages[0].getByRole('button',{name:/Abrir perfil/}).click()
    await pages[0].getByRole('button',{name:'Compartir pizarra actual'}).click()
    const code=pages[0].getByLabel('Código para compartir')
    await expect(code).toHaveText(/^\d{4}$/)
    const value=await code.innerText()
    await pages[0].getByRole('button',{name:'Cerrar',exact:true}).click()
    await pages[1].getByRole('button',{name:/Abrir perfil/}).click()
    await pages[1].getByRole('button',{name:'Ingresar a la pizarra',exact:true}).click()
    await pages[1].getByLabel('Código de 4 dígitos').fill(value)
    await pages[1].getByRole('button',{name:'Ingresar',exact:true}).click()
    await expect(pages[1].locator('.library-open-button')).toContainText('Código compartido')
    expect(await pages[1].evaluate(()=>localStorage.getItem('pizarra_activa'))).toBe(board)
    const library=await (await contexts[1].request.get(`${api}/api/library`)).json()
    expect(library.folders.find(f=>f.id===library.boards.find(b=>b.id===board).folder_id).name).toBe('Pizarra compartida')
    await pages[1].getByRole('button',{name:`Seguir a ${profiles[0].display_name}`,exact:true}).click()
    await expect(pages[1].getByRole('button',{name:`Seguir a ${profiles[0].display_name}`,exact:true})).toHaveAttribute('aria-pressed','true')
    await pages[0].mouse.move(600,500);await pages[0].mouse.wheel(0,500)
    await expect.poll(()=>pages[1].locator('.zoom-controls').innerText().catch(()=>pages[1].locator('body').innerText())).toContain('50%')
    await pages[1].mouse.move(400,600);await pages[1].mouse.wheel(0,120)
    await expect(pages[1].getByRole('button',{name:`Seguir a ${profiles[0].display_name}`,exact:true})).toHaveAttribute('aria-pressed','false')
  }finally{await Promise.all(contexts.map(c=>c.close()))}
})

test('ChatGPT receives only the marked PDF region as an attachment without the full document',async({browser})=>{
  const context=await browser.newContext()
  try{
    await signedIn(context,'Assistant materials')
    const board=(await (await context.request.post(`${api}/api/boards`,{data:{name:'Materiales de estudio'}})).json()).id
    const page=await context.newPage()
    let uploaded
    await page.route('**/api/chatgpt/**',async route=>{
      if(route.request().method()==='POST'){
        const r=route.request();uploaded=await new Request(r.url(),{method:'POST',headers:r.headers(),body:r.postDataBuffer()}).formData()
        return route.fulfill({status:202,json:{id:'crop-result',status:'running'}})
      }
      return route.fulfill({json:route.request().url().endsWith('/status')?{state:'ready'}:{id:'crop-result',status:'complete',text:'Resultado'}})
    })
    const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=500;c.height=400;const ctx=c.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,250,400);ctx.fillStyle='blue';ctx.fillRect(250,0,250,400);return c.toDataURL().split(',')[1]}),'base64')
    expect((await context.request.put(`${api}/api/assets/study-page`,{data:png,headers:{'Content-Type':'image/png'}})).status()).toBe(200)
    expect((await context.request.put(`${api}/api/boards/${board}`,{data:{version:0,content:{camera:{x:0,y:0,zoom:.5},media:[{id:'pdf-page',assetId:'study-page',kind:'pdf-page',name:'Bases.pdf',pageNumber:3,pageText:'La tercera forma normal elimina dependencias transitivas.',x:100,y:200,width:500,height:400,rotation:Math.PI/12}]}}})).status()).toBe(200)
    await page.goto(api)
    await page.getByRole('button',{name:'IA: opciones de reconocimiento',exact:true}).click()
    await page.getByRole('menuitem',{name:/Consultar con ChatGPT/}).click()
    const dialog=page.getByRole('dialog',{name:'ChatGPT',exact:true})
    await dialog.getByRole('button',{name:'Con PC',exact:true}).click()
    await dialog.getByRole('button',{name:'Adjuntar ▾',exact:true}).click()
    await dialog.getByRole('menuitem',{name:'Selección de la pizarra',exact:true}).click()
    await expect(page.locator('.chatgpt-selection-instruction')).toBeVisible()
    await page.mouse.move(100,200);await page.mouse.down();await page.mouse.move(160,240,{steps:8});await page.mouse.up()
    await expect(dialog.locator('.chatgpt-files')).toContainText('recorte-de-la-pizarra.png')
    await dialog.getByRole('textbox',{name:'Pregunta para ChatGPT',exact:true}).fill('Explicá solamente el recorte')
    await dialog.getByRole('button',{name:'Enviar',exact:true}).click()
    await expect.poll(()=>Boolean(uploaded)).toBe(true)
    const bytes=Buffer.from(await uploaded.get('files').arrayBuffer())
    const crop=await page.evaluate(async data=>{
      const image=await createImageBitmap(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'}))
      const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0)
      return {width:c.width,height:c.height,pixel:Array.from(ctx.getImageData(c.width/2,c.height/2,1,1).data)}
    },bytes.toString('base64'))
    expect(crop.width).toBe(240);expect(crop.height).toBe(160);expect(crop.pixel[0]).toBeGreaterThan(245);expect(crop.pixel[2]).toBeLessThan(10)
    expect(uploaded.getAll('files')).toHaveLength(1)
    expect(uploaded.get('prompt')).toBe('Explicá solamente el recorte')
    expect(bytes.readUInt32BE(16)).toBe(240);expect(bytes.readUInt32BE(20)).toBe(160)
    expect(((await (await context.request.get(`${api}/api/boards/${board}`)).json()).content.media??[]).length).toBe(1)
  }finally{await context.close()}
})

test('all shared object types appear live and either contributor can delete them',async({browser})=>{
  test.setTimeout(60000)
  const contexts=await Promise.all([browser.newContext(),browser.newContext()])
  let releaseVerification=()=>{}
  try {
    await Promise.all(contexts.map((c,i)=>signedIn(c,`Multimedia contributor ${i}`)))
    const owner=contexts[0].request,contributor=contexts[1].request
    const board=(await (await owner.post(`${api}/api/boards`,{data:{name:'Multimedia regression'}})).json()).id
    const token=(await (await owner.post(`${api}/api/share/boards/${board}`,{data:{role:'editor'}})).json()).token
    expect((await contributor.post(`${api}/api/share/join`,{data:{token}})).status()).toBe(200)
    const pages=await Promise.all(contexts.map(c=>c.newPage()))
    await Promise.all(pages.map(p=>p.goto(api)))
    await expect(pages[0].locator('.toolbar')).toBeVisible()
    await expect(pages[1].locator('.toolbar')).toBeVisible()
    await expect(pages[0].getByTitle('Conectado',{exact:true})).toBeVisible()
    await note(pages[0],'Nota en edición')
    await expect.poll(async()=>(await cachedShapes(pages[1]))[0]?.note?.text).toBe('Nota en edición')
    await pages[0].getByRole('button',{name:'Editar nota',exact:true}).click()
    await pages[0].getByRole('textbox',{name:'Texto de la nota',exact:true}).fill('Borrador sin terminar')
    let waitingForSnapshot=false
    const verification=new Promise(resolve=>{releaseVerification=resolve})
    await pages[0].route(`**/api/boards/${board}`,async route=>{
      if(route.request().method()==='GET'){
        waitingForSnapshot=true
        await verification
        return route.abort('failed')
      }
      return route.continue()
    })
    await pages[0].evaluate(()=>window.dispatchEvent(new Event('focus')))
    await expect.poll(()=>waitingForSnapshot).toBe(true)
    const asset='multimedia-png'
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0N8AAAAASUVORK5CYII=','base64')
    expect((await contributor.put(`${api}/api/assets/${asset}`,{data:png,headers:{'Content-Type':'image/png'}})).status()).toBe(200)
    const previous=await (await owner.get(`${api}/api/boards/${board}`)).json()
    const content={camera:{x:0,y:0,zoom:1},strokes:[{id:'ink-b',points:[{x:60,y:350},{x:150,y:360}],width:3,color:'#000'}],
      texts:[{id:'text-b',x:40,y:390,text:'Texto compartido',fontSize:20,color:'#000'}],shapes:previous.content.shapes,
      media:[{id:'image-b',assetId:asset,x:40,y:440,width:60,height:60,name:'Imagen compartida',kind:'image'}],
      tables:[{id:'table-b',name:'Tabla compartida',x:210,y:330,cells:[[{input:'Compartida'},{input:'2'}]],cellWidth:90,cellHeight:30}],
      graphs:[{id:'graph-b',x:450,y:330,width:300,height:240,formulas:[{id:'f',expr:'x^2',enabled:true,color:'#6366f1'}]}],
      videos:[{id:'video-b',x:800,y:330,width:320,height:180,videoId:'dQw4w9WgXcQ',url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ',start:0}]}
    expect((await contributor.put(`${api}/api/boards/${board}`,{data:{version:previous.version,content}})).status()).toBe(200)
    expect((await owner.get(`${api}/api/assets/${asset}`)).status()).toBe(200)
    for(const page of pages) {
      await expect.poll(()=>page.evaluate(async()=>{
        const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
        const boards=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>resolve(r.result)})
        db.close();const c=boards.find(b=>b.id===localStorage.getItem('pizarra_activa'))?.content
        return ['strokes','texts','media','tables','graphs','videos'].map(key=>c?.[key]?.length??0)
      }),{timeout:20000}).toEqual([1,1,1,1,1,1])
      await expect(page.locator('[data-table-id="table-b"]')).toBeVisible()
      await expect(page.locator('.board-live-graph')).toBeVisible()
    }
    await expect(pages[0].getByRole('textbox',{name:'Texto de la nota',exact:true})).toHaveValue('Borrador sin terminar')
    releaseVerification()
    await pages[0].getByRole('button',{name:'Cancelar',exact:true}).click()
    await pages[0].keyboard.press('v')
    await pages[0].keyboard.press('Control+a')
    await pages[0].keyboard.press('Delete')
    await expect.poll(async()=>{
      const c=(await (await owner.get(`${api}/api/boards/${board}`)).json()).content
      return ['strokes','texts','media','tables','graphs','videos'].map(key=>c[key]?.length??0)
    }).toEqual([0,0,0,0,0,0])
    await expect(pages[1].locator('[data-table-id="table-b"]')).toHaveCount(0)
    await expect(pages[1].locator('.board-live-graph')).toHaveCount(0)
  } finally {releaseVerification();await Promise.all(contexts.map(c=>c.close()))}
})

test('an older tab preserves notes added in another tab of the same account',async({browser})=>{
  const context=await browser.newContext()
  try {
    await signedIn(context,'Two tabs contributor')
    const owner=context.request
    const board=(await (await owner.post(`${api}/api/boards`,{data:{name:'Same account tabs'}})).json()).id
    const [a,b]=await Promise.all([context.newPage(),context.newPage()])
    await a.addInitScript(()=>{
      const Native=window.WebSocket;window.testSockets=[]
      window.WebSocket=class extends Native{constructor(...args){super(...args);window.testSockets.push(this)}}
    })
    await Promise.all([a.goto(api),b.goto(api)])
    await expect(a.locator('.toolbar')).toBeVisible()
    await expect(b.locator('.toolbar')).toBeVisible()
    await expect.poll(()=>a.evaluate(()=>window.testSockets.some(s=>s.readyState===1))).toBe(true)
    await a.route('**/live-ticket',route=>route.abort('failed'))
    await a.route('**/api/library',route=>route.fulfill({json:{folders:[],boards:[{id:board,name:'Same account tabs',version:0,role:'owner'}]}}))
    let saving=false
    await a.route(`**/api/boards/${board}`,route=>{
      if(route.request().method()==='PUT')saving=true
      return route.request().method()==='GET'&&!saving?route.abort('failed'):route.continue()
    })
    await a.evaluate(()=>window.testSockets.forEach(s=>s.close()))
    await note(b,'Aporte desde la otra pestaña')
    await expect.poll(async()=>(await cachedShapes(b)).map(s=>s.note?.text)).toEqual(['Aporte desde la otra pestaña'])
    await note(a,'Aporte desde la pestaña anterior')
    const expected=['Aporte desde la otra pestaña','Aporte desde la pestaña anterior']
    await expect.poll(async()=>((await (await owner.get(`${api}/api/boards/${board}`)).json()).content.shapes??[]).map(s=>s.note?.text)).toEqual(expected)
    await expect.poll(async()=>(await cachedShapes(b)).map(s=>s.note?.text)).toEqual(expected)
  } finally {await context.close()}
})

test('rechecks scene contents at the same version and keeps an unfinished editor draft',async({browser})=>{
  test.setTimeout(45000)
  const contexts=await Promise.all([browser.newContext(),browser.newContext()])
  try {
    await Promise.all(contexts.map((c,i)=>signedIn(c,`Scene recovery ${i}`)))
    const owner=contexts[0].request
    const board=(await (await owner.post(`${api}/api/boards`,{data:{name:'Scene recovery'}})).json()).id
    const token=(await (await owner.post(`${api}/api/share/boards/${board}`,{data:{role:'editor'}})).json()).token
    await contexts[1].request.post(`${api}/api/share/join`,{data:{token}})
    const a=await contexts[0].newPage();await a.goto(api)
    await expect(a.getByTitle('Conectado',{exact:true})).toBeVisible()
    await note(a,'Nota existente')
    await expect.poll(async()=>((await (await owner.get(`${api}/api/boards/${board}`)).json()).content.shapes??[])[0]?.note?.text).toBe('Nota existente')
    const saved=await (await owner.get(`${api}/api/boards/${board}`)).json()
    const extra={...saved.content.shapes[0],id:'missing-note',x:200,y:200,note:{...saved.content.shapes[0].note,text:'Tarjeta que faltaba'}}
    const complete={...saved.content,shapes:[...saved.content.shapes,extra],graphs:[{id:'recovered-graph',x:800,y:300,width:300,height:240,formulas:[{id:'f',expr:'x^2',enabled:true,color:'#6366f1'}]}]}
    expect((await owner.put(`${api}/api/boards/${board}`,{data:{version:saved.version,content:complete}})).status()).toBe(200)
    const b=await contexts[1].newPage()
    const diagnostics=[]
    b.on('console',msg=>{if(msg.type()==='warning'||msg.type()==='error')diagnostics.push(msg.text())})
    b.on('request',request=>{if(request.url().includes('/api/'))diagnostics.push(request.method()+' '+new URL(request.url()).pathname)})
    // Emulate an older client which marked an incomplete scene with the correct
    // revision. No new save or version notification is sent after B opens it.
    await b.route(`**/api/boards/${board}`,async route=>{
      if(route.request().method()!=='GET')return route.continue()
      const response=await route.fetch(),data=await response.json()
      await route.fulfill({json:{...data,content:saved.content}})
    })
    await b.goto(api)
    await expect(b.locator('.toolbar')).toBeVisible()
    await expect.poll(async()=>(await cachedShapes(b)).length).toBe(1)
    await b.keyboard.press('v');await b.mouse.dblclick(683,450)
    await b.getByRole('textbox',{name:'Texto de la nota',exact:true}).fill('Borrador que no debe perderse')
    await b.unroute(`**/api/boards/${board}`)
    try {
      await expect.poll(async()=>(await cachedShapes(b)).map(s=>s.note?.text),{timeout:22000}).toEqual(['Nota existente','Tarjeta que faltaba'])
    } catch(error) {
      const actual=await (await owner.get(`${api}/api/boards/${board}`)).json()
      throw new Error(String(error)+'\n'+JSON.stringify({version:actual.version,shapes:actual.content.shapes.map(s=>s.note?.text),diagnostics}))
    }
    await expect(b.locator('.board-live-graph')).toBeVisible()
    await expect(b.getByRole('textbox',{name:'Texto de la nota',exact:true})).toHaveValue('Borrador que no debe perderse')
    expect((await (await owner.get(`${api}/api/boards/${board}`)).json()).version).toBe(saved.version+1)
  } finally {await Promise.all(contexts.map(c=>c.close()))}
})

test('PDF pages reach the other contributor before the remaining uploads finish',async({browser})=>{
  const contexts=await Promise.all([browser.newContext(),browser.newContext()])
  let release
  try {
    await Promise.all(contexts.map((c,i)=>signedIn(c,`PDF progressive ${i}`)))
    const owner=contexts[0].request
    const board=(await (await owner.post(`${api}/api/boards`,{data:{name:'PDF progresivo'}})).json()).id
    const token=(await (await owner.post(`${api}/api/share/boards/${board}`,{data:{role:'editor'}})).json()).token
    await contexts[1].request.post(`${api}/api/share/join`,{data:{token}})
    const [a,b]=await Promise.all(contexts.map(c=>c.newPage()))
    await Promise.all([a.goto(api),b.goto(api)])
    await expect(a.getByRole('button',{name:'Seguir a PDF progressive 1'})).toBeVisible()
    let uploads=0
    const second=new Promise(resolve=>{release=resolve})
    await b.route('**/api/assets/*',async route=>{
      if(route.request().method()==='PUT' && ++uploads===2)await second
      await route.continue()
    })
    // Small, valid two-page PDF, generated in memory without real user files.
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>']
    for(let i=0;i<2;i++){
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << >> /Contents ${4+i*2} 0 R >>`)
      const ink='0 0 1 rg 20 20 100 100 re f\n'
      objects.push(`<< /Length ${ink.length} >>\nstream\n${ink}endstream`)
    }
    let pdf='%PDF-1.4\n',offsets=[0]
    objects.forEach((object,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${object}\nendobj\n`})
    const xref=pdf.length
    pdf+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
    await b.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({name:'two-pages.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdf)})
    await expect.poll(()=>uploads).toBe(2)
    const media=()=>a.evaluate(async()=>{
      const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
      const boards=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>resolve(r.result)})
      db.close();return boards.find(b=>b.id===localStorage.getItem('pizarra_activa'))?.content?.media??[]
    })
    await expect.poll(async()=>(await media()).map(m=>m.pageNumber),{timeout:5000}).toEqual([1])
    release()
    await expect.poll(async()=>(await media()).map(m=>m.pageNumber)).toEqual([1,2])
    expect(uploads).toBe(2)
  } finally {release?.();await Promise.all(contexts.map(c=>c.close()))}
})
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
  await expect(page.getByRole('button',{name:/Puerta XOR/})).toHaveCount(0)
  // Removed templates remain editable in boards saved before the menu change.
  await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('boards','readwrite'),store=tx.objectStore('boards'),request=store.get(localStorage.getItem('pizarra_activa'))
      request.onsuccess=()=>{const value=request.result;value.content.shapes=[{id:'legacy-xor',kind:'rectangle',visualType:'symbol',symbol:'xor',x:200,y:200,width:140,height:90,color:'#334155',strokeWidth:2,label:'XOR'}];store.put(value)}
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)
    });db.close()
  })
  await page.reload()
  await page.getByRole('button',{name:'Seleccionar área',exact:true}).click()
  await page.keyboard.press('Control+a')
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
  // Expression-created trees use the existing API and preserve their anchors in B's copy.
  await a.getByRole('button',{name:'Elementos académicos',exact:true}).click()
  await a.getByRole('button',{name:'Árbol desde expresión…',exact:true}).click()
  await a.getByRole('textbox',{name:'Expresión del árbol binario'}).fill('(R L (D E F G))')
  await a.getByRole('button',{name:'Crear árbol visual',exact:true}).click()
  await expect.poll(async()=>(await cachedShapes(b)).filter(s=>['R','L','D','E','F','G'].includes(s.label)).length).toBe(6)
  await a.getByRole('button',{name:'Expresión del árbol',exact:true}).click()
  await expect(a.getByRole('textbox',{name:'Expresión del árbol binario'})).toHaveValue('(R L (D E F G))')
  await a.getByRole('button',{name:'Cancelar',exact:true}).click()
  // Observe actual frames on B, including the end of A's recovered pen stroke.
  const observer=await contexts[1].newCDPSession(b),frames=[]
  await observer.send('Network.enable')
  observer.on('Network.webSocketFrameReceived',event=>{
    try{const frame=JSON.parse(event.response.payloadData);if(frame.type?.startsWith('stroke_'))frames.push(frame)}catch{/* non-JSON frame */}
  })
  await a.keyboard.press('p')
  await a.evaluate(()=>document.addEventListener('pointerdown',e=>{window.lastPenId=e.pointerId},{once:true}))
  const stylus=await contexts[0].newCDPSession(a)
  const pen=(type,x,buttons)=>stylus.send('Input.dispatchMouseEvent',{type,x,y:650,buttons,pointerType:'pen',
    button:type==='mouseMoved'?'none':'left',clickCount:type==='mouseMoved'?0:1})
  await pen('mousePressed',120,1);await pen('mouseMoved',140,1)
  await a.evaluate(()=>document.querySelector('canvas').dispatchEvent(new PointerEvent('pointercancel',{
    bubbles:true,pointerId:window.lastPenId,pointerType:'pen',clientX:140,clientY:650})))
  await pen('mouseReleased',140,0);await pen('mousePressed',143,1)
  await pen('mouseMoved',165,1);await pen('mouseReleased',165,0)
  await expect.poll(()=>frames.filter(f=>f.type==='stroke_end').length).toBe(1)
  expect(frames.filter(f=>f.type==='stroke_start')).toHaveLength(1)
  expect(frames.filter(f=>f.type==='stroke_cancel')).toHaveLength(0)
  const remoteStrokes=async()=>(await (await owner.get(`${api}/api/boards/${board}`)).json()).content.strokes??[]
  await expect.poll(async()=>(await remoteStrokes()).length).toBe(1)
  expect((await remoteStrokes())[0].points.map(p=>p.x)).toEqual([120,140,143,165])
  // A's personal card becomes a shared native note that B can edit and flip.
  await a.getByRole('button',{name:'Tarjetas de estudio',exact:true}).click()
  await a.getByRole('button',{name:'Nueva tarjeta',exact:true}).click()
  await a.getByRole('textbox',{name:'Pregunta de la tarjeta',exact:true}).fill('¿Qué representa I?')
  await a.getByRole('textbox',{name:'Respuesta de la tarjeta',exact:true}).fill('La matriz identidad.')
  await a.getByRole('button',{name:'Guardar tarjeta',exact:true}).click()
  await a.getByRole('button',{name:'Poner todas en pizarra',exact:true}).click()
  await expect.poll(async()=>(await cachedShapes(b)).find(s=>s.note?.study)?.note.study.question).toBe('¿Qué representa I?')
  await b.getByRole('button',{name:'Seleccionar área',exact:true}).click()
  await b.mouse.dblclick(683,450)
  await b.getByRole('textbox',{name:'Respuesta de la tarjeta adhesiva',exact:true}).fill('I × A = A, matriz identidad.')
  await b.getByRole('combobox',{name:'Cara visible de la tarjeta',exact:true}).selectOption('answer')
  await b.getByRole('button',{name:'Aplicar',exact:true}).click()
  await expect.poll(async()=>(await remote()).find(s=>s.note?.study)?.note.study).toMatchObject({face:'answer',answer:'I × A = A, matriz identidad.'})
  await expect.poll(async()=>(await cachedShapes(a)).find(s=>s.note?.study)?.note.study.answer).toBe('I × A = A, matriz identidad.')
  await a.getByRole('button',{name:'Tarjetas de estudio',exact:true}).click()
  await a.getByRole('button',{name:'Mis tarjetas',exact:true}).click()
  await a.getByRole('button',{name:'Editar tarjeta',exact:true}).click()
  await expect(a.getByRole('textbox',{name:'Respuesta de la tarjeta',exact:true})).toHaveValue('La matriz identidad.')
  await a.getByRole('button',{name:'Cerrar tarjetas',exact:true}).click()
  await a.screenshot({path:'test-results/fase1-colaboracion.png'})
  expect(userA.id).not.toBe(userB.id)
  await Promise.all(contexts.map(c=>c.close()))
})
