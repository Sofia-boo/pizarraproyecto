import {test,expect} from '@playwright/test'

test.use({serviceWorkers:'block'})

test('pen strokes erased on a tablet before their first save leave no ink previews on the PC',async({browser})=>{
  const contexts=await Promise.all([browser.newContext({hasTouch:true}),browser.newContext()])
  const [tablet,pc]=await Promise.all(contexts.map(context=>context.newPage()))
  let version=0,content={strokes:[],texts:[],media:[],shapes:[],tables:[],graphs:[],videos:[],camera:{x:0,y:0,zoom:1}}
  const sockets=new Map(),saves=[]
  for(const [index,page] of [tablet,pc].entries()){
    const id=String(index)
    await page.route('**/api/**',async route=>{
      const path=new URL(route.request().url()).pathname
      const reply=json=>route.fulfill({json})
      if(path==='/api/auth/me')return reply({id,name:id,display_name:id,color:'#2563eb',emoji:'A'})
      if(path==='/api/library')return reply({folders:[],boards:[{id:'shared',name:'Compartida',version,role:'editor'}]})
      if(path.endsWith('/live-ticket'))return reply({url:new URL(`/live/tablet-${id}`,route.request().url()).href.replace(/^http/,'ws')})
      if(path==='/api/boards/shared'){
        if(route.request().method()!=='PUT')return reply({id:'shared',name:'Compartida',version,content})
        const body=route.request().postDataJSON();saves.push(body)
        if(body.content)content=body.content
        for(const [key,change] of Object.entries(body.changes??{})){
          const items=new Map(content[key].map(item=>[item.id,item]))
          for(const id of change.remove)items.delete(id)
          for(const item of change.upsert)items.set(item.id,item)
          content[key]=[...items.values()]
        }
        const removed=body.discarded_strokes??[]
        content.strokes=content.strokes.filter(stroke=>!removed.includes(stroke.id))
        version++
        for(const socket of sockets.values()){
          socket.send(JSON.stringify({type:'board_version',board_id:'shared',version,deletions:{strokes:removed}}))
          socket.send(JSON.stringify({type:'ink_settled',board_id:'shared',version,saved:[],removed}))
        }
        return reply({version})
      }
      return route.fulfill({status:404,json:{detail:'fixture'}})
    })
    await page.routeWebSocket('**/live/tablet-*',ws=>{
      sockets.set(id,ws);ws.send(JSON.stringify({type:'board_version',board_id:'shared',version}))
      ws.onMessage(raw=>{
        const message={...JSON.parse(raw),board_id:'shared',client_id:id}
        for(const [other,socket] of sockets)if(other!==id)socket.send(JSON.stringify(message))
      })
    })
  }
  try{
    await Promise.all([tablet.goto('/'),pc.goto('/')])
    await expect.poll(()=>sockets.size).toBe(2)
    // Hold the debounce/recovery clock while drawing and erasing with real pen
    // events. None of these strokes ever enters a canonical server snapshot.
    await tablet.clock.install();await tablet.clock.pauseAt(new Date())
    const cdp=await contexts[0].newCDPSession(tablet)
    const pen=(type,x,y,buttons=1)=>cdp.send('Input.dispatchMouseEvent',{
      type,x,y,pointerType:'pen',button:type==='mouseMoved'?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1,
    })
    for(const x of [450,500,550]){
      await pen('mousePressed',x,400);await pen('mouseMoved',x+25,400);await pen('mouseReleased',x+25,400,0)
    }
    const visible=()=>pc.locator('.board-foreground-canvas').evaluate(canvas=>[465,515,565].map(x=>{
      const pixel=canvas.getContext('2d').getImageData(x*devicePixelRatio,400*devicePixelRatio,1,1).data
      return pixel[3]>0
    }))
    await expect.poll(visible).toEqual([true,true,true])
    await tablet.getByRole('button',{name:'Borrador',exact:true}).click()
    for(const x of [465,515,565])await tablet.mouse.click(x,400)
    expect(saves).toHaveLength(0)
    await tablet.clock.runFor(1000)
    await expect.poll(()=>saves.length).toBeGreaterThan(0)
    expect(content.strokes).toHaveLength(0)
    await expect.poll(visible).toEqual([false,false,false])
    expect(saves[0].discarded_strokes).toHaveLength(3)
  }finally{await Promise.all(contexts.map(context=>context.close()))}
})
