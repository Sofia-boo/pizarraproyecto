import {test,expect} from '@playwright/test'

test('live ink remains visible across unrelated commits and becomes the matching saved stroke exactly once',async({page})=>{
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
