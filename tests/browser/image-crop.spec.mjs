import {test,expect} from '@playwright/test'

async function board(page){return page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
  const all=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>resolve(r.result)})
  db.close();const saved=all.find(b=>b.id===localStorage.getItem('pizarra_activa'));return saved?.draft??saved?.content
})}
async function openLocal(page){
  await page.route('**/api/**',r=>r.fulfill({status:503,body:'offline'}))
  await page.goto('/');await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect.poll(async()=>(await board(page))?.camera).toBeDefined()
}
async function chat(page){
  await page.getByRole('button',{name:'IA: opciones de reconocimiento',exact:true}).click()
  await page.getByRole('menuitem',{name:/Consultar con ChatGPT/}).click()
  return page.getByRole('dialog',{name:'ChatGPT',exact:true})
}
async function region(page,from,to,touch=false){
  const box=await page.locator('.image-crop-surface').boundingBox()
  const a={x:box.x+from.x*box.width,y:box.y+from.y*box.height},b={x:box.x+to.x*box.width,y:box.y+to.y*box.height}
  if(touch){
    const cdp=await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,id:1}]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...b,id:1}]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  }else{await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await page.mouse.up()}
}
async function pixels(page,id){return page.evaluate(async id=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
  const blob=await new Promise(resolve=>{const r=db.transaction('assets').objectStore('assets').get('device:'+id);r.onsuccess=()=>resolve(r.result)})
  db.close();const image=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0)
  return {width:image.width,height:image.height,pixel:Array.from(ctx.getImageData(Math.floor(image.width/2),Math.floor(image.height/2),1,1).data)}
},id)}

test('a formatted ChatGPT answer can be cropped, undone, redone and reopened without losing the source',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{readText:async()=> '## Resultado\n$\\frac{1}{2}$\n\nExplicación de la respuesta.'}}))
  await openLocal(page);const dialog=await chat(page)
  await dialog.getByRole('button',{name:'Pegar respuesta en la pizarra',exact:true}).click()
  await dialog.getByRole('button',{name:'Cerrar ChatGPT',exact:true}).click()
  await expect.poll(async()=>(await board(page))?.media?.length).toBe(1)
  const original=(await board(page)).media[0]
  const camera=(await board(page)).camera
  await page.mouse.click((original.x+original.width/4)*camera.zoom+camera.x,(original.y+original.height/2)*camera.zoom+camera.y,{button:'right'})
  await page.getByRole('menuitem',{name:'Recortar imagen',exact:true}).click()
  const crop=page.getByRole('dialog',{name:'Recortar imagen',exact:true})
  await expect(crop.getByRole('button',{name:'Aplicar recorte',exact:true})).toBeDisabled()
  await expect(crop.getByRole('img')).toHaveJSProperty('complete',true)
  await region(page,{x:.1,y:.1},{x:.8,y:.8})
  await crop.getByRole('button',{name:'Aplicar recorte',exact:true}).click()
  await expect(crop).toHaveCount(0)
  const cropped=(await board(page)).media[0]
  expect(cropped.id).toBe(original.id);expect(cropped.assetId).not.toBe(original.assetId)
  expect(cropped.width).toBeLessThan(original.width);expect(cropped.x).toBeGreaterThan(original.x)
  const source=await pixels(page,original.assetId),output=await pixels(page,cropped.assetId)
  expect(output.width).toBeLessThan(source.width);expect(output.height).toBeLessThan(source.height)
  await page.getByRole('button',{name:'Deshacer',exact:true}).click()
  await expect.poll(async()=>(await board(page))?.media?.[0]?.assetId).toBe(original.assetId)
  await page.getByRole('button',{name:'Rehacer',exact:true}).click()
  await expect.poll(async()=>(await board(page))?.media?.[0]?.assetId).toBe(cropped.assetId)
  await page.reload();await expect.poll(async()=>(await board(page))?.media?.[0]?.assetId).toBe(cropped.assetId)
})

test('cropping exports only the kept pixels, supports keyboard handles and cancellation preserves the original',async({page})=>{
  await openLocal(page)
  const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=200;const x=c.getContext('2d');x.fillStyle='red';x.fillRect(0,0,200,200);x.fillStyle='blue';x.fillRect(200,0,200,200);return c.toDataURL().split(',')[1]}),'base64')
  await page.locator('input[type=file][accept*="image/svg+xml"]').setInputFiles({name:'dos-colores.png',mimeType:'image/png',buffer:png})
  await expect.poll(async()=>(await board(page))?.media?.length).toBe(1)
  const original=(await board(page)).media[0]
  await page.getByRole('button',{name:'Recortar imagen',exact:true}).click()
  let crop=page.getByRole('dialog',{name:'Recortar imagen',exact:true})
  await expect(crop.getByRole('button',{name:'Ajustar esquina superior derecha'})).toBeVisible()
  const handle=crop.getByRole('button',{name:'Ajustar esquina superior derecha'});await handle.focus()
  for(let i=0;i<20;i++)await handle.press('Shift+ArrowLeft')
  await crop.getByRole('button',{name:'Aplicar recorte',exact:true}).click()
  await expect(crop).toHaveCount(0)
  const cropped=(await board(page)).media[0],output=await pixels(page,cropped.assetId)
  expect(output).toEqual({width:200,height:200,pixel:[255,0,0,255]})
  expect(cropped.x).toBe(original.x);expect(cropped.y).toBe(original.y);expect(cropped.width).toBe(200)
  await page.getByRole('button',{name:'Recortar imagen',exact:true}).click();crop=page.getByRole('dialog',{name:'Recortar imagen',exact:true})
  await region(page,{x:.1,y:.1},{x:.8,y:.8});await crop.getByRole('button',{name:'Cancelar',exact:true}).click()
  expect((await board(page)).media[0]).toEqual(cropped)
})

test('a copied ChatGPT response can be pasted as editable text and preserves that choice when clipboard access is denied',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{readText:async()=>{throw new DOMException('denied','NotAllowedError')}}}))
  await openLocal(page);const dialog=await chat(page)
  await dialog.getByRole('button',{name:'Pegar como texto editable',exact:true}).click()
  await dialog.getByRole('textbox',{name:'Respuesta para pegar en la pizarra'}).fill('## Solución\n**Resultado:** $\\frac{1}{2}$')
  await dialog.getByRole('button',{name:'Insertar',exact:true}).click()
  await expect.poll(async()=>(await board(page))?.texts?.[0]?.text).toBe('Solución\nResultado: 1/2')
  expect((await board(page)).media??[]).toHaveLength(0)
})

test.describe('tablet',()=>{
  test.use({viewport:{width:800,height:1280},hasTouch:true,isMobile:true})
  test('finger selection and touch apply crop the answer while retaining the board',async({page})=>{
    await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{readText:async()=> '## Respuesta\nTexto largo de prueba para recortar con el dedo.\n$\\frac{1}{2}$'}}))
    await openLocal(page);const dialog=await chat(page)
    await dialog.getByRole('button',{name:'Pegar respuesta en la pizarra',exact:true}).tap();await dialog.getByRole('button',{name:'Cerrar ChatGPT',exact:true}).tap()
    const original=(await board(page)).media[0]
    await page.getByRole('button',{name:'Recortar imagen',exact:true}).tap()
    const crop=page.getByRole('dialog',{name:'Recortar imagen',exact:true})
    await expect(crop.getByRole('button',{name:'Ajustar esquina superior derecha'})).toBeVisible()
    await region(page,{x:.1,y:.1},{x:.75,y:.8},true)
    await crop.getByRole('button',{name:'Aplicar recorte',exact:true}).tap()
    await expect(crop).toHaveCount(0)
    const saved=await board(page);expect(saved.media).toHaveLength(1);expect(saved.media[0].assetId).not.toBe(original.assetId)
    expect(saved.media[0].width).toBeLessThan(original.width)
    await page.screenshot({path:'test-results/recorte-respuesta-tablet.png'})
  })
})
