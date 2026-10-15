import {test,expect} from '@playwright/test'

async function openBusyPrivate(page){
  await page.route('**/api/**',route=>route.fulfill({status:401,json:{}}))
  await page.goto('/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo',exact:true}).click()
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect.poll(()=>page.evaluate(()=>Boolean(localStorage.getItem('pizarra_activa')))).toBe(true)
  await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    const id=localStorage.getItem('pizarra_activa')
    const tx=db.transaction('boards','readwrite'),store=tx.objectStore('boards')
    const board=await new Promise(resolve=>{const r=store.get(id);r.onsuccess=()=>resolve(r.result)})
    board.content.strokes=Array.from({length:534},(_,index)=>({id:`old-${index}`,color:'#999999',width:2,
      points:Array.from({length:60},(_,i)=>({x:80+(index%25)*25+i/3,y:180+Math.floor(index/25)*10+(i%2)}))}))
    store.put(board)
    await new Promise(resolve=>{tx.oncomplete=resolve});db.close()
  })
  await page.reload()
  await expect(page.locator('.library-open-button')).toContainText('privada')
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  await page.evaluate(()=>{
    window.fullInkPaints=0
    const ctx=document.querySelector('.app>canvas').getContext('2d'),clear=ctx.clearRect.bind(ctx)
    ctx.clearRect=(...args)=>{window.fullInkPaints++;return clear(...args)}
  })
}

async function inkAt(page,x,y){
  return page.locator('.board-foreground-canvas').evaluate((canvas,{x,y})=>{
    const pixel=canvas.getContext('2d').getImageData(Math.round(x*devicePixelRatio),Math.round(y*devicePixelRatio),1,1).data
    return pixel[3]>0
  },{x,y})
}

async function storedStrokes(page){
  return page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    const row=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').get(localStorage.getItem('pizarra_activa'));r.onsuccess=()=>resolve(r.result)})
    db.close();return row?.content.strokes??[]
  })
}

test('offline ink grows under a held pen without repainting the entire board on every movement',async({page,context})=>{
  await openBusyPrivate(page)
  await context.setOffline(true)
  const cdp=await context.newCDPSession(page)
  const pen=(type,x,y,buttons=1)=>cdp.send('Input.dispatchMouseEvent',{
    type,x,y,pointerType:'pen',button:type==='mouseMoved'?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1,
  })
  await pen('mousePressed',220,550)
  await pen('mouseMoved',260,550)
  await expect.poll(()=>inkAt(page,240,550)).toBe(true)
  expect(await inkAt(page,300,550)).toBe(false)
  await pen('mouseMoved',320,550)
  await expect.poll(()=>inkAt(page,300,550)).toBe(true)
  expect(await inkAt(page,240,550)).toBe(true)
  expect(await page.evaluate(()=>window.fullInkPaints)).toBeLessThanOrEqual(1)
  expect((await storedStrokes(page)).length).toBe(534)
  await pen('mouseReleased',320,550,0)
  await expect.poll(async()=>(await storedStrokes(page)).length).toBe(535)
  expect((await storedStrokes(page)).at(-1).points.at(-1)).toEqual({x:320,y:550})
})

test('a small pen movement is visible offline before lifting without becoming a long-press menu',async({page,context})=>{
  await openBusyPrivate(page)
  await context.setOffline(true)
  const cdp=await context.newCDPSession(page)
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:220,y:550,pointerType:'pen',button:'left',buttons:1,clickCount:1})
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:223,y:550,pointerType:'pen',button:'none',buttons:1})
  await expect.poll(()=>inkAt(page,222,550),{timeout:1500}).toBe(true)
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:223,y:550,pointerType:'pen',button:'left',buttons:0,clickCount:1})
  await expect(page.getByRole('menu',{name:'Acciones sobre elementos'})).toHaveCount(0)
  await expect.poll(async()=>(await storedStrokes(page)).length).toBe(535)
  expect((await storedStrokes(page)).at(-1).points.at(-1)).toEqual({x:223,y:550})
})

test('long press cancels a tiny ink preview without saving a ghost stroke',async({page,context})=>{
  await openBusyPrivate(page)
  const cdp=await context.newCDPSession(page)
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:220,y:550,pointerType:'pen',button:'left',buttons:1,clickCount:1})
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:223,y:550,pointerType:'pen',button:'none',buttons:1})
  await expect.poll(()=>inkAt(page,222,550)).toBe(true)
  await expect(page.getByRole('menu',{name:'Acciones sobre elementos'})).toBeVisible({timeout:4000})
  await expect.poll(()=>inkAt(page,222,550)).toBe(false)
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:223,y:550,pointerType:'pen',button:'left',buttons:0,clickCount:1})
  expect((await storedStrokes(page)).length).toBe(534)
})

test('online shared ink is visible locally before its first save',async({page,context})=>{
  let version=0,writes=0
  let content={strokes:[],texts:[],media:[],shapes:[],tables:[],graphs:[],videos:[],camera:{x:0,y:0,zoom:1}}
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/auth/me')return route.fulfill({json:{id:'ink-writer',display_name:'Writer',color:'#2563eb',emoji:'A'}})
    if(path==='/api/library')return route.fulfill({json:{folders:[],boards:[{id:'ink-shared',name:'Compartida',version,role:'editor'}]}})
    if(path.endsWith('/live-ticket'))return route.fulfill({json:{url:new URL('/live/ink-preview',route.request().url()).href.replace(/^http/,'ws')}})
    if(path==='/api/boards/ink-shared'){
      if(route.request().method()==='PUT'){writes++;content=route.request().postDataJSON().content;version++;return route.fulfill({json:{version}})}
      return route.fulfill({json:{id:'ink-shared',name:'Compartida',version,content}})
    }
    return route.fulfill({status:404,json:{}})
  })
  await page.routeWebSocket('**/live/ink-preview',ws=>ws.send(JSON.stringify({type:'board_version',board_id:'ink-shared',version})))
  await page.goto('/')
  await expect(page.locator('.library-open-button')).toContainText('Compartida')
  const cdp=await context.newCDPSession(page)
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:220,y:550,pointerType:'pen',button:'left',buttons:1,clickCount:1})
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:320,y:550,pointerType:'pen',button:'none',buttons:1})
  await expect.poll(()=>inkAt(page,280,550)).toBe(true)
  expect(writes).toBe(0)
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:320,y:550,pointerType:'pen',button:'left',buttons:0,clickCount:1})
  await expect.poll(()=>writes).toBe(1)
  expect(content.strokes[0].points.at(-1)).toEqual({x:320,y:550})
})
