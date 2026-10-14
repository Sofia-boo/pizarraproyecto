import { test, expect } from '@playwright/test'

test('two contributors edit shared content, navigate, follow cameras and retain cursors over widgets',async({browser})=>{
  const contexts=await Promise.all([browser.newContext(),browser.newContext()])
  const pages=await Promise.all(contexts.map(c=>c.newPage()))
  const users=[{id:'a',name:'Ana',display_name:'Ana',color:'#2563eb',emoji:'A'},
    {id:'b',name:'Beto',display_name:'Beto',color:'#ef4444',emoji:'B'}]
  let version=0
  let content={strokes:[],texts:[],media:[],tables:[],graphs:[],videos:[],
    shapes:[{id:'shape-a',kind:'rectangle',x:850,y:350,width:100,height:100,color:'#2563eb',strokeWidth:3}],
    camera:{x:0,y:0,zoom:1}}
  let conflicts=0
  const sockets=new Map()
  const views=new Map()
  const cursors=[]
  function broadcast(value,exclude) {
    for(const [id,socket] of sockets) if(id!==exclude) socket.send(JSON.stringify({board_id:'shared',...value}))
  }
  for(let i=0;i<pages.length;i++) {
    const page=pages[i], user=users[i]
    await page.route('**/api/**',async route=>{
      const path=new URL(route.request().url()).pathname
      const respond=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
      if(path==='/api/auth/me')return respond(user)
      if(path==='/api/library')return respond({folders:[],boards:[{id:'shared',name:'Compartida',version,role:'editor'}]})
      if(path==='/api/boards/shared/live-ticket')return respond({url:`ws://127.0.0.1:4173/live/${user.id}`})
      if(path==='/api/boards/shared') {
        if(route.request().method()==='PUT') {
          const body=route.request().postDataJSON()
          if(body.version!==version){conflicts++;return respond({detail:'Modificada en otra pestaña'},409)}
          content=body.content;version++
          await respond({version})
          broadcast({type:'board_version',version})
          return
        }
        return respond({id:'shared',name:'Compartida',content,version})
      }
      return respond({detail:'Not found'},404)
    })
    await page.routeWebSocket('**/live/*',ws=>{
      sockets.set(user.id,ws)
      ws.send(JSON.stringify({type:'board_version',board_id:'shared',version}))
      for(const [id,socket] of sockets)socket.send(JSON.stringify({type:'presence',board_id:'shared',you:id,
        users:users.filter(u=>sockets.has(u.id)).map(u=>({...u,view:views.get(u.id)}))}))
      ws.onMessage(raw=>{
        const msg=JSON.parse(raw)
        if(msg.type==='camera_move')views.set(user.id,{center:msg.center,zoom:msg.zoom})
        if(msg.type==='cursor_move')cursors.push({user:user.id,point:msg.point})
        broadcast({...msg,user_id:user.id,client_id:user.id,name:user.name,color:user.color,emoji:user.emoji},user.id)
      })
    })
  }
  const [a,b]=pages
  await Promise.all(pages.map(p=>p.goto('http://127.0.0.1:4173')))
  await expect(b.getByRole('button',{name:'Seguir a Ana'})).toBeVisible()
  async function draw(page,x,y) {
    await page.mouse.move(x,y);await page.mouse.down()
    await page.mouse.move(x+100,y+50,{steps:10});await page.mouse.up()
  }
  await Promise.all([draw(a,450,350),draw(b,650,450)])
  await expect.poll(()=>content.strokes.length).toBe(2)
  await expect.poll(()=>conflicts).toBeGreaterThan(0)
  // The server accepts the merged save before its HTTP response reaches B.
  // Wait for the committed scene in B, rather than erasing a live ink preview.
  await expect.poll(()=>b.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    return new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').get('b:shared');r.onsuccess=()=>{db.close();resolve(r.result.content.strokes.length)}})
  })).toBe(2)
  // B can erase the stroke committed by A, including after a simultaneous save.
  await b.keyboard.press('e')
  await b.mouse.click(500,375)
  await expect.poll(()=>content.strokes.length).toBe(1)
  expect(content.strokes[0].points[0].x).toBe(650)
  await expect.poll(async()=>a.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    return new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').get('a:shared');r.onsuccess=()=>{db.close();resolve(r.result.content.strokes.length)}})
  })).toBe(1)
  await b.getByRole('button',{name:'Seleccionar área',exact:true}).click()
  await b.mouse.click(900,400)
  await b.mouse.move(900,400);await b.mouse.down();await b.mouse.move(980,420,{steps:8});await b.mouse.up()
  await expect.poll(()=>content.shapes[0]?.x).toBe(930)
  await b.keyboard.press('Delete')
  await expect.poll(()=>content.shapes.length).toBe(0)

  const zoom=b.locator('.zoom-controls span')
  const originalZoom=await zoom.textContent()
  await b.mouse.move(400,600);await b.mouse.wheel(0,120)
  await expect(zoom).toHaveText(originalZoom)
  await b.keyboard.down('Control');await b.mouse.wheel(0,-120);await b.keyboard.up('Control')
  await expect(zoom).not.toHaveText(originalZoom)
  await a.getByRole('button',{name:'Seguir a Beto'}).click()
  await expect(a.getByRole('button',{name:'Dejar de seguir'})).toBeVisible()
  const camera=p=>p.locator('.board-graph-layer').evaluate(el=>el.style.transform)
  await expect.poll(async()=>await camera(a)).toBe(await camera(b))
  await b.mouse.wheel(0,160)
  await expect.poll(async()=>await camera(a)).toBe(await camera(b))
  await a.mouse.move(400,600);await a.mouse.wheel(0,80)
  await expect(a.getByRole('button',{name:'Dejar de seguir'})).toHaveCount(0)

  await b.getByRole('button',{name:'Opciones del lápiz'}).click()
  const menu=b.getByRole('group',{name:'Configuración del lápiz'})
  const box=await menu.boundingBox(),toolbar=await b.locator('.toolbar').boundingBox()
  expect(box.width).toBeGreaterThan(box.height*2)
  expect(Math.abs(box.width-toolbar.width)).toBeLessThan(6)
  expect(await menu.locator('.tool-color-dot').count()).toBe(6)
  await b.screenshot({path:'test-results/lapiz-compacto.png'})
  await b.getByRole('button',{name:'Opciones del lápiz'}).click()
  await b.evaluate(()=>{
    const layer=document.querySelector('.board-graph-layer')
    const matrix=new DOMMatrix(getComputedStyle(document.querySelector('.board-scene')).transform)
    const widget=document.createElement('button');widget.textContent='Widget de prueba'
    widget.style.cssText=`position:absolute;left:${(500-matrix.e)/matrix.a}px;top:${(300-matrix.f)/matrix.d}px;width:100px;height:60px;z-index:8;pointer-events:auto`
    widget.onpointermove=e=>e.stopPropagation()
    layer.append(widget)
  })
  await b.getByText('Widget de prueba').hover()
  await expect.poll(()=>cursors.filter(c=>c.user==='b').length).toBeGreaterThan(0)
  const pixels=()=>a.locator('.board-cursor-canvas').evaluate(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((n,i)=>i%4===3&&n>0))
  await expect.poll(pixels).toBe(true)
  await expect(a.locator('.board-cursor-canvas')).toHaveCSS('pointer-events','none')
  await b.evaluate(()=>{
    const widget=[...document.querySelectorAll('button')].find(el=>el.textContent==='Widget de prueba')
    const frame=document.createElement('iframe')
    frame.title='Reproductor externo de prueba'
    frame.srcdoc='<button style="width:100%;height:100%">Reproductor</button>'
    frame.style.cssText='width:100%;height:100%;border:0'
    widget.replaceChildren(frame)
  })
  await b.frameLocator('iframe[title="Reproductor externo de prueba"]').getByRole('button').hover()
  await new Promise(resolve=>setTimeout(resolve,7100))
  expect(await pixels()).toBe(true)
  await expect(a.locator('.status')).toHaveCount(0)
  await Promise.all(contexts.map(c=>c.close()))
})
