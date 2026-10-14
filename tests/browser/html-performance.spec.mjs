import {test,expect} from '@playwright/test'
test.use({serviceWorkers:'block'})

test('HTML scripts stay idle until activation and stop executing when stopped',async({page})=>{
  await page.addInitScript(()=>{window.fixtureTicks=0;addEventListener('message',event=>{if(event.data?.fixtureTick)window.fixtureTicks++})})
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'isolated fixture'}))
  await page.goto('/');await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect.poll(()=>page.evaluate(async()=>{
    const id=localStorage.getItem('pizarra_activa');if(!id)return undefined
    const db=await new Promise(resolve=>{const request=indexedDB.open('pizarra-dispositivo',1);request.onsuccess=()=>resolve(request.result)})
    const row=await new Promise(resolve=>{const request=db.transaction('boards').objectStore('boards').get(id);request.onsuccess=()=>resolve(request.result)})
    db.close();return row?.content?.camera
  })).toBeDefined()
  await page.locator('input[accept="text/html,.html,.htm"]').setInputFiles(Array.from({length:3},(_,index)=>({name:`sample-${index}.html`,mimeType:'text/html',buffer:Buffer.from("<!doctype html><script>setInterval(()=>parent.postMessage({fixtureTick:true},'*'),30)</script><button>Usar</button>")})))
  await expect(page.locator('.board-html-widget')).toHaveCount(3)
  await expect(page.locator('.board-html-widget iframe')).toHaveCount(0)
  expect(await page.evaluate(()=>window.fixtureTicks)).toBe(0)
  await page.getByRole('button',{name:'Activar HTML sample-2.html',exact:true}).click()
  await expect(page.locator('.board-html-widget iframe')).toHaveCount(1)
  await expect.poll(()=>page.evaluate(()=>window.fixtureTicks)).toBeGreaterThan(2)
  await page.getByRole('button',{name:'Detener HTML sample-2.html',exact:true}).click()
  await expect(page.locator('.board-html-widget iframe')).toHaveCount(0)
  expect(await page.evaluate(async()=>{
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
    const before=window.fixtureTicks;await new Promise(resolve=>setTimeout(resolve,150));return window.fixtureTicks===before
  })).toBe(true)
})

test('another user sees HTML activity without loading it or repainting the whole board for cursors',async({browser})=>{
  const contexts=await Promise.all([browser.newContext(),browser.newContext()]),pages=await Promise.all(contexts.map(context=>context.newPage()))
  const users=[{id:'a',name:'Ana',display_name:'Ana',color:'#2563eb',emoji:'A'},{id:'b',name:'Beto',display_name:'Beto',color:'#ef4444',emoji:'B'}]
  const content={strokes:[],texts:[],media:[],tables:[],graphs:[],videos:[],camera:{x:0,y:0,zoom:1},shapes:[{id:'html-shared',kind:'rectangle',visualType:'html',x:150,y:220,width:640,height:440,color:'#64748b',strokeWidth:1,zIndex:150000,html:{name:'compartido.html',source:'<!doctype html><button style="width:200px;height:80px" onclick="this.textContent=\'Listo\'">Probar actividad</button>'}}]}
  const sockets=new Map(),events=[]
  try{
    for(const [index,page] of pages.entries()){
      const user=users[index]
      await page.route('**/api/**',route=>{
        const path=new URL(route.request().url()).pathname
        if(path==='/api/auth/me')return route.fulfill({json:user})
        if(path==='/api/library')return route.fulfill({json:{folders:[],boards:[{id:'shared',name:'Compartida',role:'editor',version:0}]}})
        if(path.endsWith('/live-ticket'))return route.fulfill({json:{url:new URL(`/live/html-${user.id}`,route.request().url()).href.replace(/^http/,'ws')}})
        if(path==='/api/boards/shared')return route.fulfill({json:{id:'shared',name:'Compartida',content,version:0}})
        return route.fulfill({status:404,json:{detail:'fixture'}})
      })
      await page.routeWebSocket('**/live/html-*',ws=>{
        sockets.set(user.id,ws);ws.send(JSON.stringify({type:'board_version',board_id:'shared',version:0}))
        ws.onMessage(raw=>{
          const event=JSON.parse(raw);events.push(event)
          for(const [id,peer] of sockets)if(id!==user.id)peer.send(JSON.stringify({...event,board_id:'shared',client_id:user.id,user_id:user.id,name:user.name,emoji:user.emoji,color:user.color}))
        })
      })
    }
    await Promise.all(pages.map(page=>page.goto('/')))
    const [a,b]=pages
    await expect.poll(()=>sockets.size).toBe(2)
    await expect(a.getByRole('button',{name:'Activar HTML compartido.html',exact:true})).toBeVisible()
    await expect(b.getByRole('button',{name:'Activar HTML compartido.html',exact:true})).toBeVisible()
    // Count real canvas repaints after loading has settled.
    await b.evaluate(async()=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
      window.fullPaints=0
      const ctx=document.querySelector('.app>canvas').getContext('2d'),clear=ctx.clearRect.bind(ctx)
      ctx.clearRect=(...args)=>{window.fullPaints++;clear(...args)}
    })
    await a.getByRole('button',{name:'Activar HTML compartido.html',exact:true}).click()
    const frame=a.frameLocator('iframe[title="HTML: compartido.html"]')
    await frame.getByRole('button',{name:'Probar actividad',exact:true}).click()
    await expect(b.getByRole('status')).toContainText('Ana está usando este HTML')
    await expect(b.locator('.board-html-widget iframe')).toHaveCount(0)
    await expect.poll(()=>events.filter(event=>event.html_id==='html-shared').length).toBeGreaterThan(1)
    expect(await b.evaluate(()=>window.fullPaints)).toBe(0)
    await a.getByRole('button',{name:'Detener HTML compartido.html',exact:true}).click()
    await expect(b.getByText('Ana está usando este HTML')).toHaveCount(0)
  }finally{await Promise.all(contexts.map(context=>context.close()))}
})
