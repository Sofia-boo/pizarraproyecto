import {test,expect} from '@playwright/test'

test('live ink remains visible across unrelated commits and becomes the matching saved stroke exactly once',async({page})=>{
  await page.clock.install()
  let version=0,socket
  let content={strokes:[],texts:[],media:[],shapes:[],tables:[],graphs:[],videos:[],camera:{x:0,y:0,zoom:1}}
  const sent=[]
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/auth/me')return route.fulfill({json:{id:'watcher',name:'Observador',display_name:'Observador',color:'#2563eb',emoji:'A'}})
    if(path==='/api/library')return route.fulfill({json:{folders:[],boards:[{id:'shared',name:'Compartida',version,role:'editor'}]}})
    if(path==='/api/boards/shared/live-ticket')return route.fulfill({json:{url:new URL('/live/ink',route.request().url()).href.replace(/^http/,'ws')}})
    if(path==='/api/boards/shared'){
      if(route.request().method()==='PUT'){
        content=route.request().postDataJSON().content;version++
        return route.fulfill({json:{version,content}})
      }
      return route.fulfill({json:{id:'shared',name:'Compartida',version,content}})
    }
    return route.fulfill({status:404,json:{detail:'fixture'}})
  })
  await page.routeWebSocket('**/live/ink',ws=>{
    socket=ws;ws.onMessage(raw=>sent.push(JSON.parse(raw)))
    ws.send(JSON.stringify({type:'board_version',board_id:'shared',version}))
  })
  await page.goto('/')
  await expect.poll(()=>Boolean(socket)).toBe(true)
  const remote={id:'remote-ink-123456789',points:[{x:450,y:400},{x:600,y:400}],width:4,color:'#000000'}
  function broadcast(message){socket.send(JSON.stringify({board_id:'shared',client_id:'other-device',...message}))}
  broadcast({type:'stroke_start',stroke_id:remote.id,point:remote.points[0],width:remote.width,color:remote.color})
  broadcast({type:'stroke_points',stroke_id:remote.id,points:[remote.points[1]]})
  broadcast({type:'stroke_end',stroke_id:remote.id})
  const inkVisible=()=>page.evaluate(()=>Array.from(document.querySelectorAll('.app canvas:not(.board-cursor-canvas)')).some(canvas=>{
    const dpr=devicePixelRatio,pixel=canvas.getContext('2d').getImageData(520*dpr,400*dpr,1,1).data
    return pixel[3]>0&&pixel[0]<100&&pixel[1]<100&&pixel[2]<100
  }))
  async function cachedVersion(){return page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const request=indexedDB.open('pizarra-dispositivo',1);request.onsuccess=()=>resolve(request.result)})
    const row=await new Promise(resolve=>{const request=db.transaction('boards').objectStore('boards').get('watcher:shared');request.onsuccess=()=>resolve(request.result)})
    db.close();return row?.version
  })}
  await expect.poll(inkVisible).toBe(true)
  // A slow upload/save must not erase completed ink after the old 20s timeout.
  await page.clock.fastForward(26000)
  await expect.poll(inkVisible).toBe(true)
  await page.evaluate(()=>{
    window.inkFrames=[]
    function sample(){
      window.inkFrames.push(Array.from(document.querySelectorAll('.app canvas:not(.board-cursor-canvas)')).some(canvas=>{
        const pixel=canvas.getContext('2d').getImageData(520*devicePixelRatio,400*devicePixelRatio,1,1).data
        return pixel[3]>0&&pixel[0]<100&&pixel[1]<100&&pixel[2]<100
      }))
      window.inkSample=requestAnimationFrame(sample)
    }
    window.inkSample=requestAnimationFrame(sample)
  })
  // Our own canonical save must not discard someone else's pending preview.
  await page.mouse.move(100,600);await page.mouse.down();await page.mouse.move(200,600,{steps:5});await page.mouse.up()
  await expect.poll(cachedVersion).toBe(1)
  expect(sent.find(message=>message.type==='stroke_start').stroke_id).toBe(content.strokes[0].id)
  await expect.poll(inkVisible).toBe(true)
  content={...content,shapes:[{id:'unrelated-shape',kind:'rectangle',x:800,y:600,width:100,height:100,color:'#000000',strokeWidth:2}]};version++
  broadcast({type:'board_version',version})
  await expect.poll(cachedVersion).toBe(2)
  await expect.poll(inkVisible).toBe(true)
  content={...content,strokes:[...content.strokes,remote]};version++
  broadcast({type:'board_version',version})
  await expect.poll(cachedVersion).toBe(3)
  await expect.poll(inkVisible).toBe(true)
  expect(await page.evaluate(()=>{cancelAnimationFrame(window.inkSample);return window.inkFrames.every(Boolean)})).toBe(true)
  expect(await page.locator('.board-foreground-canvas').evaluate(canvas=>canvas.getContext('2d').getImageData(520*devicePixelRatio,400*devicePixelRatio,1,1).data[3])).toBe(0)
  // Erasing the committed stroke must not resurrect an abandoned preview.
  content={...content,strokes:content.strokes.filter(stroke=>stroke.id!==remote.id)};version++
  broadcast({type:'board_version',version})
  await expect.poll(cachedVersion).toBe(4)
  await expect.poll(inkVisible).toBe(false)
})

test('ink survives socket interruptions and reconciles a deletion missed during reconnect',async({page})=>{
  await page.clock.install()
  let version=0,socket,connections=0
  const content={strokes:[],texts:[],media:[],shapes:[],tables:[],graphs:[],videos:[],camera:{x:0,y:0,zoom:1}}
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/auth/me')return route.fulfill({json:{id:'reader',name:'Reader',display_name:'Reader',color:'#2563eb',emoji:'A'}})
    if(path==='/api/library')return route.fulfill({json:{folders:[],boards:[{id:'shared',name:'Compartida',version,role:'editor'}]}})
    if(path.endsWith('/live-ticket'))return route.fulfill({json:{url:new URL('/live/reconnect',route.request().url()).href.replace(/^http/,'ws')}})
    if(path==='/api/boards/shared')return route.fulfill({json:{id:'shared',name:'Compartida',version,content}})
    return route.fulfill({status:404,json:{detail:'fixture'}})
  })
  await page.routeWebSocket('**/live/reconnect',ws=>{
    socket=ws;connections++
    ws.send(JSON.stringify({type:'board_version',board_id:'shared',version}))
  })
  await page.goto('/');await expect.poll(()=>connections).toBe(1)
  const send=message=>socket.send(JSON.stringify({board_id:'shared',client_id:'author',...message}))
  const inkVisible=()=>page.evaluate(()=>Array.from(document.querySelectorAll('.app canvas:not(.board-cursor-canvas)')).some(canvas=>{
    const pixel=canvas.getContext('2d').getImageData(520*devicePixelRatio,400*devicePixelRatio,1,1).data
    return pixel[3]>0&&pixel[0]<100&&pixel[1]<100&&pixel[2]<100
  }))
  const start=()=>send({type:'stroke_start',stroke_id:'interrupted-ink',point:{x:450,y:400},color:'#000000',width:4})
  start();send({type:'stroke_points',stroke_id:'interrupted-ink',points:[{x:600,y:400}]})
  await expect.poll(inkVisible).toBe(true)
  // The receiver loses its socket before the writer's stroke_end arrives.
  socket.close()
  await expect(page.locator('.live-presence-state')).toHaveAttribute('title','Reconectando')
  await page.clock.fastForward(45000)
  await expect.poll(()=>connections).toBeGreaterThan(1)
  await expect.poll(inkVisible).toBe(true)
  // A sender's network interruption also differs from explicit cancellation.
  send({type:'stroke_interrupted',stroke_id:'interrupted-ink'})
  await page.clock.fastForward(60000)
  await expect.poll(inkVisible).toBe(true)
  // The writer saved and then erased it while this peer missed both versions.
  version=2
  send({type:'ink_settled',version,saved:[],removed:['interrupted-ink']})
  await expect.poll(inkVisible).toBe(false)
  // A late packet from its former connection cannot resurrect erased ink.
  start();send({type:'stroke_points',stroke_id:'interrupted-ink',points:[{x:600,y:400}]})
  await page.clock.runFor(100)
  expect(await inkVisible()).toBe(false)
})

test('a save acknowledgement never retires ink before its canonical scene is displayed',async({page})=>{
  await page.addInitScript(()=>{
    const held=new WeakSet(),put=IDBObjectStore.prototype.put,listen=IDBRequest.prototype.addEventListener
    IDBObjectStore.prototype.put=function(value,...args){
      const request=put.call(this,value,...args)
      if(value?.key==='race:shared'&&value.version===1&&!value.draft){held.add(request);window.canonicalPutHeld=true}
      return request
    }
    IDBRequest.prototype.addEventListener=function(type,listener,options){
      if(type==='success'&&held.has(this)){
        const original=listener
        listener=function(event){setTimeout(()=>{window.canonicalPutReleased=true;if(typeof original==='function')original.call(this,event);else original.handleEvent(event)},1500)}
      }
      return listen.call(this,type,listener,options)
    }
  })
  let version=0,socket
  let content={strokes:[],texts:[],media:[],shapes:[],tables:[],graphs:[],videos:[],camera:{x:0,y:0,zoom:1}}
  const remote={id:'canonical-race',points:[{x:450,y:400},{x:600,y:400}],width:4,color:'#000000'}
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/auth/me')return route.fulfill({json:{id:'race',name:'Race',display_name:'Race',color:'#2563eb',emoji:'A'}})
    if(path==='/api/library')return route.fulfill({json:{folders:[],boards:[{id:'shared',name:'Compartida',version,role:'editor'}]}})
    if(path.endsWith('/live-ticket'))return route.fulfill({json:{url:new URL('/live/save-race',route.request().url()).href.replace(/^http/,'ws')}})
    if(path==='/api/boards/shared'){
      if(route.request().method()==='PUT'){
        const own=route.request().postDataJSON().content
        content={...own,strokes:[...own.strokes,remote]};version++
        return route.fulfill({json:{version,content}})
      }
      return route.fulfill({json:{id:'shared',name:'Compartida',version,content}})
    }
    return route.fulfill({status:404,json:{detail:'fixture'}})
  })
  await page.routeWebSocket('**/live/save-race',ws=>{socket=ws;ws.send(JSON.stringify({type:'board_version',board_id:'shared',version}))})
  await page.goto('/');await expect.poll(()=>Boolean(socket)).toBe(true)
  const send=message=>socket.send(JSON.stringify({board_id:'shared',client_id:'author',...message}))
  send({type:'stroke_start',stroke_id:remote.id,point:remote.points[0],color:remote.color,width:4})
  send({type:'stroke_points',stroke_id:remote.id,points:[remote.points[1]]});send({type:'stroke_end',stroke_id:remote.id})
  await expect.poll(()=>page.locator('.board-foreground-canvas').evaluate(canvas=>canvas.getContext('2d').getImageData(520*devicePixelRatio,400*devicePixelRatio,1,1).data[3])).toBeGreaterThan(0)
  await page.evaluate(()=>{
    window.inkFrames=[]
    const sample=()=>{
      window.inkFrames.push([...document.querySelectorAll('.app canvas:not(.board-cursor-canvas)')].some(canvas=>{
        const p=canvas.getContext('2d').getImageData(520*devicePixelRatio,400*devicePixelRatio,1,1).data
        return p[3]>0&&p[0]<100&&p[1]<100&&p[2]<100
      }));window.inkSample=requestAnimationFrame(sample)
    };window.inkSample=requestAnimationFrame(sample)
  })
  await page.mouse.move(100,600);await page.mouse.down();await page.mouse.move(200,600,{steps:5});await page.mouse.up()
  await expect.poll(()=>page.evaluate(()=>Boolean(window.canonicalPutHeld))).toBe(true)
  send({type:'ink_settled',version:1,saved:[remote.id],removed:[]})
  await expect.poll(()=>page.evaluate(()=>Boolean(window.canonicalPutReleased))).toBe(true)
  await expect.poll(()=>page.locator('.board-foreground-canvas').evaluate(canvas=>canvas.getContext('2d').getImageData(520*devicePixelRatio,400*devicePixelRatio,1,1).data[3])).toBe(0)
  expect(await page.evaluate(()=>{cancelAnimationFrame(window.inkSample);return window.inkFrames.length>10&&window.inkFrames.every(Boolean)})).toBe(true)
})
