import { test, expect } from '@playwright/test'
async function openLocal(page) {
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'offline'}))
  await page.goto('/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect(page.locator('.library-open-button')).toContainText('privada')
}
async function board(page) {
  return page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    return new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').get(localStorage.getItem('pizarra_activa'));r.onsuccess=()=>{db.close();resolve(r.result?.content)}})
  })
}
async function insert(page,name) {
  await page.getByRole('button',{name:'Elementos académicos',exact:true}).click()
  await page.getByRole('button',{name,exact:false}).click()
}
test('multiple A4 pages print as two clipped white PDF pages with ink and objects, independently of board theme',async({page})=>{
  await openLocal(page)
  await insert(page,'Agregar hoja A4')
  await expect.poll(async()=>(await board(page))?.shapes?.length).toBe(1)
  await insert(page,'Agregar hoja A4')
  await expect.poll(async()=>(await board(page))?.shapes?.length).toBe(2)
  const pages=(await board(page)).shapes
  expect(pages.every(p=>Math.abs(p.width/p.height-210/297)<.001)).toBe(true)
  expect(pages[1].x).toBeGreaterThan(pages[0].x+pages[0].width)
  await page.getByRole('button',{name:'Opciones del lápiz',exact:true}).click()
  await page.keyboard.press('Escape')
  await page.mouse.move(580,360);await page.mouse.down();await page.mouse.move(720,430,{steps:12});await page.mouse.up()
  await page.getByRole('button',{name:'Agregar nota adhesiva',exact:true}).click()
  await page.getByRole('textbox',{name:'Texto de la nota',exact:true}).fill('Apunte que se imprime')
  await page.getByRole('button',{name:'Aplicar',exact:true}).click()
  await expect.poll(async()=>(await board(page)).shapes.length).toBe(3)
  await page.getByRole('button',{name:'Cambiar apariencia',exact:true}).click()
  await page.getByRole('menuitemradio',{name:/Nocturno/}).click()
  await page.getByRole('button',{name:'Seleccionar área',exact:true}).click()
  const content=await board(page),note=content.shapes.find(s=>s.note),cam=content.camera
  await page.mouse.move((note.x-10)*cam.zoom+cam.x,(note.y-10)*cam.zoom+cam.y)
  await page.mouse.down();await page.mouse.move((note.x+note.width+10)*cam.zoom+cam.x,(note.y+note.height+10)*cam.zoom+cam.y,{steps:8});await page.mouse.up()
  await page.keyboard.press('Delete')
  await expect.poll(async()=>(await board(page)).shapes.filter(s=>s.note).length).toBe(0)
  expect((await board(page)).shapes.filter(s=>s.visualType==='page')).toHaveLength(2)
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await board(page)).shapes.filter(s=>s.note).length).toBe(1)
  await page.keyboard.press('Control+a')
  await page.getByRole('button',{name:'Imprimir hojas A4 seleccionadas',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Imprimir hojas A4',exact:true})
  await expect(dialog.getByRole('button',{name:'Imprimir / Guardar PDF',exact:true})).toBeEnabled()
  await expect(dialog.locator('.a4-print-page')).toHaveCount(2)
  const pixels=await dialog.locator('img').evaluateAll(async imgs=>Promise.all(imgs.map(async img=>{
    await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data
    let dark=0;for(let i=0;i<p.length;i+=4)if(p[i]<100&&p[i+1]<100&&p[i+2]<100)dark++
    return {corner:[...p.slice(0,4)],dark}
  })))
  expect(pixels.every(p=>p.corner.join(',')==='255,255,255,255')).toBe(true)
  expect(pixels[0].dark).toBe(0);expect(pixels[1].dark).toBeGreaterThan(200)
  await page.emulateMedia({media:'print'})
  await expect(page.getByRole('toolbar')).not.toBeVisible()
  const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true,path:'test-results/hojas-a4.pdf'})
  expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)??[])).toHaveLength(2)
  await page.emulateMedia({media:'screen'})
  await page.screenshot({path:'test-results/hojas-a4.png'})
  await page.getByRole('button',{name:'Cerrar impresión',exact:true}).click()
  await page.reload()
  await expect.poll(async()=>(await board(page))?.shapes?.filter(s=>s.visualType==='page').length).toBe(2)
})
test('A4 printing loads images, spreadsheet formulas and graphs even outside the current viewport',async({page})=>{
  test.setTimeout(60000)
  await openLocal(page)
  await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    const tx=db.transaction(['boards','assets'],'readwrite'),store=tx.objectStore('boards')
    const current=await new Promise(resolve=>{const r=store.get(localStorage.getItem('pizarra_activa'));r.onsuccess=()=>resolve(r.result)})
    const canvas=document.createElement('canvas');canvas.width=canvas.height=100;const ctx=canvas.getContext('2d');ctx.fillStyle='#2563eb';ctx.fillRect(0,0,100,100)
    const image=await new Promise(resolve=>canvas.toBlob(resolve))
    // toBlob is async: use a fresh transaction to store the fixture.
    const fixture=db.transaction(['boards','assets'],'readwrite')
    fixture.objectStore('assets').put(image,'device:print-image')
    current.content={...current.content,shapes:[{id:'print-page',kind:'rectangle',visualType:'page',color:'#94a3b8',strokeWidth:1,x:2000,y:100,width:595,height:595*297/210}],
      media:[{id:'print-media',assetId:'print-image',kind:'image',name:'Azul',x:2020,y:120,width:100,height:100}],
      tables:[{id:'print-table',name:'Resultados',x:2200,y:120,cellWidth:100,cellHeight:35,cells:[[{input:'2'},{input:'3'}],[{input:'=A1+B1'},{input:'total'}]]}],
      graphs:[{id:'print-graph',x:2020,y:350,width:520,height:340,formulas:[{id:'f',expr:'y=x^2',color:'#ef4444',enabled:true}]}]}
    fixture.objectStore('boards').put(current)
    await new Promise(resolve=>{fixture.oncomplete=resolve});db.close()
  })
  await page.reload()
  await expect(page.locator('.library-open-button')).toContainText('privada')
  await page.getByRole('button',{name:'Elementos académicos',exact:true}).click()
  await page.getByRole('button',{name:'Imprimir todas las hojas A4',exact:true}).click()
  await expect(page.getByRole('button',{name:'Imprimir / Guardar PDF',exact:true})).toBeEnabled({timeout:30000})
  const result=await page.locator('.a4-print-page img').evaluate(async img=>{
    await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data
    let blue=0,red=0;for(let i=0;i<p.length;i+=4){if(p[i+2]>180&&p[i]<80)blue++;if(p[i]>170&&p[i+1]<110&&p[i+2]<110)red++}
    return {blue,red}
  })
  expect(result.blue).toBeGreaterThan(1000);expect(result.red).toBeGreaterThan(100)
  await page.screenshot({path:'test-results/a4-con-imagen-tabla-grafico.png'})
})
test('Cartesian grid grows with its object and persists after reload',async({page})=>{
  await openLocal(page)
  await page.getByRole('button',{name:'Formas',exact:true}).click()
  await page.getByRole('menuitem',{name:'Ejes cartesianos X e Y cuadriculados',exact:true}).click()
  await expect.poll(async()=>(await board(page))?.shapes?.[0]?.symbol).toBe('cartesian')
  const before=(await board(page)).shapes[0]
  await page.mouse.move(before.x+before.width,before.y+before.height)
  await page.mouse.down();await page.mouse.move(before.x+before.width+130,before.y+before.height+130,{steps:8});await page.mouse.up()
  await expect.poll(async()=>(await board(page)).shapes[0].width).toBeGreaterThan(before.width+100)
  await page.screenshot({path:'test-results/ejes-cartesianos.png'})
  await page.reload()
  expect((await board(page)).shapes[0].width).toBeGreaterThan(before.width+100)
})
test('C++ workspace keeps a black editor and console, runs asynchronously and saves output and errors',async({page})=>{
  await openLocal(page)
  let submitted
  await page.route('**/api/code/run',async route=>{submitted=route.request().postDataJSON();await route.fulfill({json:{token:'test-job-token-1234567890'}})})
  let polls=0
  await page.route('**/api/code/results/*',route=>route.fulfill({json:++polls===1?{status:{id:2,description:'Processing'}}:{stdout:'Hola 42\n',stderr:'',compile_output:'',message:'',status:{id:3,description:'Accepted'},time:'0.01',memory:1024,exit_code:0}}))
  await insert(page,'Código C++ y consola')
  const editor=page.getByRole('complementary',{name:'Código C++ y consola',exact:true})
  await expect(editor).toBeVisible()
  const source='#include <iostream>\nint main(){ int n; std::cin >> n; std::cout << "Hola " << n; }'
  await page.getByRole('textbox',{name:'Código C++',exact:true}).fill(source)
  await page.getByRole('textbox',{name:'Entrada del programa',exact:true}).fill('42')
  expect(await editor.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(8, 8, 8)')
  expect(await editor.locator('.cpp-editor pre span').count()).toBeGreaterThan(5)
  await page.getByRole('button',{name:'Compilar y ejecutar',exact:true}).click()
  await expect(page.getByLabel('Consola C++',{exact:true})).toContainText('Hola 42')
  expect(submitted).toEqual({source,stdin:'42'})
  await page.getByRole('button',{name:'Guardar código y cerrar',exact:true}).click()
  await expect.poll(async()=>(await board(page)).shapes[0].code.output).toBe('Hola 42\n')
  await page.getByRole('button',{name:'Cambiar apariencia',exact:true}).click()
  await page.getByRole('menuitemradio',{name:/Nocturno/}).click()
  await page.getByRole('button',{name:'Editar código C++',exact:true}).click()
  expect(await editor.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(8, 8, 8)')
  await page.route('**/api/code/run',route=>route.fulfill({status:503,json:{detail:'Judge0 requiere completar la instalación.'}}))
  await page.getByRole('button',{name:'Compilar y ejecutar',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('Judge0 requiere completar')
  await expect(page.getByLabel('Consola C++',{exact:true})).toContainText('Hola 42')
  await page.screenshot({path:'test-results/editor-cpp.png'})
  await page.getByRole('button',{name:'Guardar código y cerrar',exact:true}).click()
  await page.reload()
  await expect.poll(async()=>(await board(page))?.shapes?.[0]?.code.source).toBe(source)
})
