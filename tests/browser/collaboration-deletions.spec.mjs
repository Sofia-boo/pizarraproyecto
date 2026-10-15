import {test,expect} from '@playwright/test'

test.use({serviceWorkers:'block'})

async function fixture(browser){
  const contexts=await Promise.all([browser.newContext(),browser.newContext()])
  const [a,b]=await Promise.all(contexts.map(context=>context.newPage()))
  const lists=['strokes','texts','media','shapes','tables','graphs','videos']
  let version=0
  let content={strokes:[
    {id:'erased',points:[{x:450,y:350},{x:600,y:350}],color:'#000000',width:4},
    {id:'selected',points:[{x:450,y:500},{x:600,y:500}],color:'#000000',width:4},
  ],texts:[],media:[],shapes:[],tables:[],graphs:[],videos:[],camera:{x:0,y:0,zoom:1}}
  const sockets=new Map()
  let startRetry,finishRetry,firstPending=false,retryPending=false,bWrites=0
  const firstGate=new Promise(resolve=>startRetry=resolve)
  const retryGate=new Promise(resolve=>finishRetry=resolve)
  for(const [index,page] of [a,b].entries()){
    const id=index?'b':'a'
    await page.route('**/api/**',async route=>{
      const path=new URL(route.request().url()).pathname
      const reply=(json,status=200)=>route.fulfill({json,status})
      if(path==='/api/auth/me')return reply({id,name:id,display_name:id,color:'#2563eb',emoji:'A'})
      if(path==='/api/library')return reply({folders:[],boards:[{id:'shared',name:'Compartida',version,role:'editor'}]})
      if(path.endsWith('/live-ticket'))return reply({url:new URL(`/live/deletions-${id}`,route.request().url()).href.replace(/^http/,'ws')})
      if(path==='/api/boards/shared'){
        if(route.request().method()!=='PUT')return reply({id:'shared',name:'Compartida',version,content})
        const body=route.request().postDataJSON()
        if(id==='b'&&++bWrites===1){firstPending=true;await firstGate}
        if(body.version!==version)return reply({detail:'Conflict'},409)
        const before=structuredClone(content)
        if(body.changes){
          for(const key of lists){
            const change=body.changes[key];if(!change)continue
            const items=new Map(content[key].map(item=>[item.id,item]))
            for(const removed of change.remove)items.delete(removed)
            for(const item of change.upsert)items.set(item.id,item)
            content[key]=[...items.values()]
          }
        }else content=body.content
        const saved=structuredClone(content),at=++version,deletions={}
        for(const key of lists){
          const ids=new Set(content[key].map(item=>item.id))
          const removed=before[key].filter(item=>!ids.has(item.id)).map(item=>item.id)
          if(removed.length)deletions[key]=removed
        }
        for(const socket of sockets.values())socket.send(JSON.stringify({type:'board_version',board_id:'shared',version:at,deletions}))
        if(id==='b'&&bWrites===2){retryPending=true;await retryGate}
        return reply({version:at,content:saved})
      }
      return reply({detail:'fixture'},404)
    })
    await page.routeWebSocket('**/live/deletions-*',ws=>{
      sockets.set(id,ws);ws.send(JSON.stringify({type:'board_version',board_id:'shared',version}))
    })
  }
  await Promise.all([a.goto('/'),b.goto('/')])
  await expect.poll(()=>sockets.size).toBe(2)
  await b.mouse.move(100,650);await b.mouse.down();await b.mouse.move(200,650,{steps:5});await b.mouse.up()
  await expect.poll(()=>firstPending).toBe(true)
  await a.keyboard.press('e');await a.mouse.click(500,350)
  await expect.poll(()=>content.strokes.some(item=>item.id==='erased')).toBe(false)
  startRetry()
  await expect.poll(()=>retryPending).toBe(true)
  return {a,b,contexts,finishRetry,getContent:()=>content}
}

async function cached(page){
  return page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    const row=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').get('b:shared');r.onsuccess=()=>resolve(r.result)})
    db.close();return row
  })
}

test('a delayed save during selection never restores peer deletions or changes the selected stroke identity',async({browser})=>{
  const {b,contexts,finishRetry,getContent}=await fixture(browser)
  try{
    await b.keyboard.press('v');await b.mouse.move(500,500);await b.mouse.down();await b.mouse.move(520,520,{steps:3})
    finishRetry()
    await expect.poll(async()=>(await cached(b))?.version).toBe(2)
    // The peer's deletion shifted the stroke array while this drag was active.
    await b.mouse.move(550,550,{steps:3});await b.mouse.up()
    await expect.poll(()=>getContent().strokes.find(item=>item.id==='selected')?.points[0]).toEqual({x:500,y:550})
    expect(getContent().strokes.some(item=>item.id==='erased')).toBe(false)
    await b.keyboard.press('Delete')
    await expect.poll(()=>getContent().strokes.length).toBe(1)
    expect(getContent().strokes[0].points[0]).toEqual({x:100,y:650})
  }finally{finishRetry();await Promise.all(contexts.map(context=>context.close()))}
})

test('undoing a local stroke after a conflict preserves the other user deletion',async({browser})=>{
  const {b,contexts,finishRetry,getContent}=await fixture(browser)
  try{
    finishRetry();await expect.poll(async()=>(await cached(b))?.version).toBe(2)
    await b.keyboard.press('Control+z')
    await expect.poll(()=>getContent().strokes.length).toBe(1)
    expect(getContent().strokes[0].id).toBe('selected')
  }finally{finishRetry();await Promise.all(contexts.map(context=>context.close()))}
})
