import {test,expect} from '@playwright/test'

async function openLocal(page){
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'offline'}))
  await page.route('**/*youtube*',route=>route.abort())
  await page.goto('/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect.poll(async()=>(await content(page))?.camera).toBeDefined()
}
async function content(page){return page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
  const value=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>resolve(r.result.find(v=>v.id===localStorage.getItem('pizarra_activa')))})
  db.close();return value?.content
})}
async function seed(page,content){
  await page.evaluate(async content=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('boards','readwrite'),s=tx.objectStore('boards'),r=s.get(localStorage.getItem('pizarra_activa'))
      r.onsuccess=()=>{const value=r.result;value.content={strokes:[],texts:[],shapes:[],media:[],tables:[],graphs:[],videos:[],camera:{x:0,y:0,zoom:1},...content};delete value.draft;s.put(value)}
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)
    });db.close()
  },content)
  await page.reload();await expect(page.locator('canvas').first()).toBeVisible()
}
async function layer(page,x,y,name){
  await page.mouse.click(x,y,{button:'right'})
  await page.getByRole('menuitem',{name,exact:true}).click()
}
async function pixel(page,x,y){
  const png=await page.screenshot()
  return page.evaluate(async({data,x,y})=>{
    const img=new Image();img.src='data:image/png;base64,'+data;await img.decode()
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return [...ctx.getImageData(x,y,1,1).data].slice(0,3)
  },{data:png.toString('base64'),x,y})
}

test('A4 borders select the page while clicks and partial rectangles inside select its text and ink',async({page})=>{
  await openLocal(page)
  await seed(page,{shapes:[{id:'paper',kind:'rectangle',visualType:'page',x:150,y:180,width:594,height:700,color:'#64748b',strokeWidth:1}],
    texts:[{id:'inside-text',x:250,y:300,text:'Apunte dentro de A4',fontSize:28,color:'#202020'}],
    strokes:[{id:'inside-ink',points:[{x:250,y:420},{x:400,y:440}],width:4,color:'#202020'}]})
  await page.keyboard.press('v')
  await page.mouse.click(150,250)
  await expect(page.getByRole('button',{name:'Imprimir hojas A4 seleccionadas',exact:true})).toBeVisible()
  await page.mouse.click(290,315)
  await page.keyboard.press('Delete')
  await expect.poll(async()=>(await content(page)).texts.length).toBe(0)
  expect((await content(page)).shapes).toHaveLength(1)
  await page.mouse.move(230,400);await page.mouse.down();await page.mouse.move(420,460,{steps:8});await page.mouse.up()
  await page.keyboard.press('Delete')
  await expect.poll(async()=>(await content(page)).strokes.length).toBe(0)
  expect((await content(page)).shapes).toHaveLength(1)
  await page.mouse.move(150,250);await page.mouse.down();await page.mouse.move(200,270,{steps:8});await page.mouse.up()
  await expect.poll(async()=>(await content(page)).shapes[0].x).toBe(200)
})

test('Ctrl and middle-button drag pan in every tool without drawing, editing or changing tools',async({page})=>{
  await openLocal(page)
  let x=0,y=0
  for(const key of ['p','t','e','h','v','c']){
    await page.keyboard.press(key)
    const tool=await page.locator('.app').getAttribute('data-tool')
    for(const button of ['left','middle']){
      if(button==='left')await page.keyboard.down('Control')
      await page.mouse.move(350,350);await page.mouse.down({button})
      if(button==='left')await page.keyboard.up('Control') // Modifier release must not switch to drawing halfway.
      await page.mouse.move(390,380,{steps:8});await page.mouse.up({button})
      x+=40;y+=30
      await expect.poll(async()=>(await content(page)).camera).toMatchObject({x,y,zoom:1})
      await expect(page.locator('.app')).toHaveAttribute('data-tool',tool)
    }
  }
  const saved=await content(page)
  for(const kind of ['strokes','texts','shapes'])expect(saved[kind]).toHaveLength(0)
  await page.keyboard.press('p');await page.mouse.move(350,350);await page.mouse.down();await page.mouse.move(380,390,{steps:5});await page.mouse.up()
  await expect.poll(async()=>(await content(page)).strokes.length).toBe(1)
})

test('canvas images, A4 sheets, graphs, spreadsheets and videos obey one visible and persistent stacking order',async({page})=>{
  await openLocal(page)
  await page.locator('input[type="file"][accept*="image/svg+xml"]').setInputFiles({name:'red.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><path fill="#ff0000" d="M0 0H600V300H0Z"/></svg>')})
  await expect.poll(async()=>(await content(page)).media.length).toBe(1)
  const image=(await content(page)).media[0]
  await seed(page,{media:[{...image,x:200,y:300,width:600,height:300}],
    shapes:[{id:'paper',kind:'rectangle',visualType:'page',x:170,y:240,width:700,height:650,color:'#64748b',strokeWidth:1}],
    tables:[{id:'table',name:'Tabla verde',x:400,y:350,cells:Array.from({length:4},()=>[{input:'A',backgroundColor:'#00ff00'},{input:'B',backgroundColor:'#00ff00'}]),cellWidth:180,cellHeight:35}],
    graphs:[{id:'graph',x:500,y:350,width:300,height:240,formulas:[{id:'f',expr:'x^2',enabled:true,color:'#6366f1'}]}],
    videos:[{id:'video',videoId:'dQw4w9WgXcQ',x:550,y:400,width:320,height:220}]})
  await expect(page.locator('.board-live-graph')).toBeVisible()
  await expect(page.locator('[data-table-id="table"]')).toBeVisible()
  await expect.poll(()=>pixel(page,250,550)).toEqual([255,0,0]) // Imported pictures stay above A4 paper.
  await page.keyboard.press('v')
  await layer(page,250,550,'Traer al frente')
  await expect.poll(()=>pixel(page,610,450)).toEqual([255,0,0])
  await page.mouse.click(750,365) // A covered graph button must not receive clicks through the image.
  await expect(page.locator('.board-live-graph-editor')).toHaveCount(0)
  await layer(page,250,550,'Llevar al fondo')
  await expect.poll(()=>pixel(page,610,450)).not.toEqual([255,0,0])
  await page.mouse.click(100,650) // Clear the image selection before selecting another object.
  await layer(page,450,420,'Traer al frente')
  await expect.poll(()=>pixel(page,610,450)).toEqual([0,255,0])
  await page.mouse.click(100,650)
  await layer(page,750,570,'Traer al frente')
  await expect.poll(()=>pixel(page,610,450)).not.toEqual([0,255,0])
  await page.mouse.click(100,650)
  await layer(page,860,540,'Traer al frente')
  await expect.poll(async()=>(await content(page)).videos[0].zIndex).toBeGreaterThan(200000)
  const frontVideo=await pixel(page,610,410)
  expect(frontVideo).not.toEqual([0,255,0])
  await page.reload();await page.keyboard.press('v')
  await expect.poll(()=>pixel(page,610,410)).toEqual(frontVideo)
  await page.mouse.click(100,650)
  await layer(page,860,540,'Llevar al fondo')
  await expect.poll(()=>pixel(page,610,410)).not.toEqual(frontVideo)
  await page.mouse.move(610,450);await page.mouse.down({button:'middle'});await page.mouse.move(650,480,{steps:6});await page.mouse.up({button:'middle'})
  await expect.poll(async()=>(await content(page)).camera).toMatchObject({x:40,y:30,zoom:1})
  await page.mouse.click(100,650)
  await layer(page,900,570,'Traer al frente')
  await page.keyboard.press('h');await page.keyboard.down('Control')
  await expect(page.locator('.board-video-player iframe')).toHaveCSS('pointer-events','none')
  await page.mouse.move(640,560);await page.mouse.down();await page.keyboard.up('Control')
  await page.mouse.move(680,590,{steps:6});await page.mouse.up()
  await expect.poll(async()=>(await content(page)).camera).toMatchObject({x:80,y:60,zoom:1})
  expect((await content(page)).videos[0].x).toBe(550)
  await page.keyboard.press('v');await page.mouse.click(530,510)
  await expect(page.locator('.sheet-inline-anchor')).toBeVisible()
  await layer(page,530,420,'Llevar al fondo')
  await expect(page.locator('.sheet-inline-anchor')).toHaveCount(0)
  await expect.poll(async()=>(await content(page)).tables[0].zIndex).toBeLessThan(-400000)
  await page.screenshot({path:'test-results/orden-capas-multimedia.png'})
})
