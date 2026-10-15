import {test,expect} from '@playwright/test'
test.use({serviceWorkers:'block'})

test('undoing transcription survives a delayed deletion of the original stroke and keeps redo after peer edits',async({page})=>{
  let version=10,socket
  let content={strokes:[{id:'original-manuscript',points:[{x:180,y:380},{x:320,y:380}],width:3,color:'#202020'}],texts:[],media:[],shapes:[],tables:[],graphs:[],videos:[],camera:{x:0,y:0,zoom:1}}
  const lists=['strokes','texts','media','shapes','tables','graphs','videos']
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/auth/me')return route.fulfill({json:{id:'undo-owner',name:'Undo',display_name:'Undo',color:'#2563eb',emoji:'A'}})
    if(path==='/api/library')return route.fulfill({json:{folders:[],boards:[{id:'undo-shared',name:'Undo shared',version,role:'editor'}]}})
    if(path.endsWith('/live-ticket'))return route.fulfill({json:{url:new URL('/live/undo-shared',route.request().url()).href.replace(/^http/,'ws')}})
    if(path==='/api/study-ai/consult')return route.fulfill({json:{text:'Hola',truncated:false}})
    if(path.endsWith('/history')&&route.request().method()==='POST')return route.fulfill({json:{id:'safety',board_version:version}})
    if(path==='/api/boards/undo-shared'){
      if(route.request().method()==='PUT'){
        const body=route.request().postDataJSON()
        if(body.version!==version)return route.fulfill({status:409,json:{detail:'Conflict'}})
        if(body.changes){for(const key of lists){
          const change=body.changes[key];if(!change)continue
          const items=new Map(content[key].map(item=>[item.id,item]));change.remove.forEach(id=>items.delete(id));change.upsert.forEach(item=>items.set(item.id,item));content[key]=[...items.values()]
        }}else content=body.content
        return route.fulfill({json:{version:++version,content:structuredClone(content)}})
      }
      return route.fulfill({json:{id:'undo-shared',name:'Undo shared',version,content}})
    }
    return route.fulfill({status:404,json:{detail:'fixture'}})
  })
  await page.routeWebSocket('**/live/undo-shared',ws=>{socket=ws;ws.send(JSON.stringify({type:'board_version',board_id:'undo-shared',version}))})
  await page.goto('/');await expect.poll(()=>Boolean(socket)).toBe(true)
  await page.getByRole('button',{name:'Seleccionar área',exact:true}).click();await page.mouse.click(230,380)
  await page.getByRole('button',{name:'IA: opciones de reconocimiento'}).click();await page.getByRole('menuitem',{name:'Transcribir manuscrito con Gemini',exact:true}).click()
  await expect.poll(()=>content.texts.length).toBe(1)
  await page.keyboard.press('Control+z')
  await expect.poll(()=>content.strokes.length).toBe(1)
  const restored=structuredClone(content.strokes[0])
  const base=version++
  // A second contributor's delayed remove still refers to the old object.
  content.strokes=content.strokes.filter(item=>item.id!=='original-manuscript')
  const peer={id:'peer-text',text:'Trabajo del compañero',fontSize:20,color:'#000',x:700,y:650}
  content.texts.push(peer)
  socket.send(JSON.stringify({type:'board_version',board_id:'undo-shared',base_version:base,version,patch:{strokes:{remove:['original-manuscript'],upsert:[]},texts:{remove:[],upsert:[peer]}},deletions:{strokes:['original-manuscript']}}))
  const cached=()=>page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    const row=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').get('undo-owner:undo-shared');r.onsuccess=()=>resolve(r.result)});db.close();return row
  })
  await expect.poll(async()=>(await cached())?.version).toBe(version)
  await expect.poll(async()=>(await cached()).content.strokes.some(item=>JSON.stringify(item.points)===JSON.stringify(restored.points))).toBe(true)
  await page.getByRole('button',{name:'Rehacer',exact:true}).click()
  await expect.poll(()=>content.texts.some(item=>item.text==='Hola')).toBe(true)
  expect(content.texts.some(item=>item.id==='peer-text')).toBe(true)
  await page.getByRole('button',{name:'Deshacer',exact:true}).click()
  await expect.poll(()=>content.strokes.length).toBe(1)
  expect(content.texts.some(item=>item.id==='peer-text')).toBe(true)
})
