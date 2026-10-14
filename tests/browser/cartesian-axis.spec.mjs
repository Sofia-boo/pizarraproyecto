import {test,expect} from '@playwright/test'

async function board(page){return page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
  const all=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>resolve(r.result)})
  db.close();const saved=all.find(b=>b.id===localStorage.getItem('pizarra_activa'));return saved?.draft??saved?.content
})}
async function insert(page){
  await page.route('**/api/**',r=>r.fulfill({status:503,body:'offline'}))
  await page.goto('/');await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect.poll(async()=>(await board(page))?.camera).toBeDefined()
  await page.getByRole('button',{name:'Formas',exact:true}).click()
  await page.getByRole('menuitem',{name:'Ejes cartesianos X e Y cuadriculados',exact:true}).click()
  await expect.poll(async()=>(await board(page))?.shapes?.[0]?.symbol).toBe('cartesian')
  return (await board(page)).shapes[0]
}
async function drag(page,a,b){await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up()}
function screen(point,camera){return {x:point.x*camera.zoom+camera.x,y:point.y*camera.zoom+camera.y}}

test('axis tips grow X and Y independently without a text editor, preserve origin and support undo and reload',async({page})=>{
  const original=await insert(page),camera=(await board(page)).camera
  await expect(page.getByRole('button',{name:'Editar elemento',exact:true})).toHaveCount(0)
  const center={x:original.x+original.width/2,y:original.y+original.height/2},origin=screen(center,camera)
  await page.mouse.dblclick(origin.x,origin.y)
  await expect(page.getByRole('complementary',{name:'Editar elemento académico'})).toHaveCount(0)
  await page.mouse.click(20,origin.y)
  const x=screen({x:original.x+original.width,y:center.y},camera)
  await drag(page,x,{x:x.x+90*camera.zoom,y:x.y+40*camera.zoom})
  await expect.poll(async()=>(await board(page))?.shapes?.[0]?.width).toBeCloseTo(620)
  let item=(await board(page)).shapes[0]
  expect(item.height).toBe(original.height);expect(item.x+item.width/2).toBeCloseTo(center.x);expect(item.y+item.height/2).toBeCloseTo(center.y)
  const y=screen({x:center.x,y:item.y},camera)
  await drag(page,y,{x:y.x+50*camera.zoom,y:y.y-80*camera.zoom})
  await expect.poll(async()=>(await board(page))?.shapes?.[0]?.height).toBeCloseTo(600)
  item=(await board(page)).shapes[0];expect(item.width).toBeCloseTo(620);expect(item.x+item.width/2).toBeCloseTo(center.x);expect(item.y+item.height/2).toBeCloseTo(center.y)
  expect((await board(page)).camera).toEqual(camera)
  await page.getByRole('button',{name:'Deshacer',exact:true}).click();await expect.poll(async()=>(await board(page))?.shapes?.[0]?.height).toBe(original.height)
  await page.getByRole('button',{name:'Rehacer',exact:true}).click();await expect.poll(async()=>(await board(page))?.shapes?.[0]?.height).toBeCloseTo(600)
  await page.reload();await expect.poll(async()=>(await board(page))?.shapes?.[0]?.width).toBeCloseTo(620)
})

test.describe('tablet axes',()=>{
  test.use({viewport:{width:1000,height:1280},hasTouch:true,isMobile:true})
  test('a finger grows an axis instead of panning and pointer cancellation restores the previous size',async({page,context})=>{
    const original=await insert(page),camera=(await board(page)).camera
    const x=screen({x:original.x+original.width,y:original.y+original.height/2},camera)
    const cdp=await context.newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...x,id:1}]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x.x+70,y:x.y,id:1}]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await expect.poll(async()=>(await board(page))?.shapes?.[0]?.width).toBeCloseTo(original.width+140/camera.zoom)
    expect((await board(page)).camera).toEqual(camera)
    const resized=(await board(page)).shapes[0],top=screen({x:resized.x+resized.width/2,y:resized.y},camera)
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...top,id:2}]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:top.x,y:top.y-70,id:2}]})
    await expect.poll(async()=>(await board(page))?.shapes?.[0]?.height).toBeGreaterThan(resized.height)
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]})
    await expect.poll(async()=>(await board(page))?.shapes?.[0]?.height).toBe(resized.height)
    expect((await board(page)).camera).toEqual(camera)
    await page.screenshot({path:'test-results/ejes-arrastre-tablet.png'})
  })
})
