import { test, expect } from '@playwright/test'

async function openLocal(page) {
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'offline'}))
  await page.goto('/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
}
async function content(page) {
  return page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    return new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>{
      const board=r.result.find(b=>b.id===localStorage.getItem('pizarra_activa'));db.close();resolve(board?.content??{})
    }})
  })
}
test('binary trees convert between the example notation and editable canvas objects',async({page})=>{
  await openLocal(page)
  await page.getByRole('button',{name:'Elementos académicos',exact:true}).click()
  await page.getByRole('button',{name:'Árbol desde expresión…',exact:true}).click()
  const expression='(* (* A (* O (* P .))) (* U T))'
  await expect(page.getByRole('textbox',{name:'Expresión del árbol binario'})).toHaveValue(expression)
  await page.getByRole('textbox',{name:'Expresión del árbol binario'}).fill('(A B')
  await page.getByRole('button',{name:'Crear árbol visual',exact:true}).click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect((await content(page)).shapes??[]).toHaveLength(0)
  await page.getByRole('textbox',{name:'Expresión del árbol binario'}).fill(expression)
  await page.getByRole('button',{name:'Crear árbol visual',exact:true}).click()
  await expect.poll(async()=>(await content(page)).shapes?.length).toBe(19)
  await page.getByRole('button',{name:'Expresión del árbol',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Expresión del árbol binario'})).toHaveValue(expression)
  await page.getByRole('button',{name:'Insertar expresión en pizarra',exact:true}).click()
  await expect.poll(async()=>(await content(page)).texts?.[0]?.text).toBe(expression)
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await content(page)).texts?.length).toBe(0)
  await page.reload()
  await page.getByRole('button',{name:'Seleccionar área',exact:true}).click()
  await page.keyboard.press('Control+a')
  await page.getByRole('button',{name:'Expresión del árbol',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Expresión del árbol binario'})).toHaveValue(expression)
  await page.setViewportSize({width:390,height:844})
  await expect(page.getByRole('button',{name:'Crear árbol visual',exact:true})).toBeInViewport()
  await page.screenshot({path:'test-results/arbol-expresion-movil.png'})
})

test('expressions with three or more children draw every branch and survive reload',async({page})=>{
  await openLocal(page)
  await page.getByRole('button',{name:'Elementos académicos',exact:true}).click()
  await page.getByRole('button',{name:'Árbol desde expresión…',exact:true}).click()
  const expression='(8 (4 2 6) (12 10 9 14))'
  await page.getByRole('textbox',{name:'Expresión del árbol binario'}).fill(expression)
  await page.getByRole('button',{name:'Crear árbol visual',exact:true}).click()
  await expect.poll(async()=>(await content(page)).shapes?.length).toBe(15)
  const shapes=(await content(page)).shapes,parent=shapes.find(s=>s.label==='12')
  const edges=shapes.filter(s=>s.connector?.from?.object.id===parent.id)
  expect(edges).toHaveLength(3)
  expect(edges.map(e=>shapes.find(s=>s.id===e.connector.to.object.id).label)).toEqual(['10','9','14'])
  await page.getByRole('button',{name:'Expresión del árbol',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Expresión del árbol binario'})).toHaveValue(expression)
  await page.getByRole('button',{name:'Cancelar',exact:true}).click()
  await page.screenshot({path:'test-results/arbol-varios-hijos.png'})
  await page.reload()
  await page.getByRole('button',{name:'Seleccionar área',exact:true}).click()
  await page.keyboard.press('Control+a')
  await page.getByRole('button',{name:'Expresión del árbol',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Expresión del árbol binario'})).toHaveValue(expression)
})

test('pen microcuts resume one stroke, hover draws nothing and a one-second lift separates strokes',async({page,context})=>{
  await openLocal(page)
  await expect(page.getByRole('button',{name:'Opciones del lápiz',exact:true})).toBeVisible()
  await expect.poll(async()=>(await content(page)).camera).toBeDefined()
  await page.evaluate(()=>{
    window.penEvents=[]
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,e=>window.penEvents.push({id:e.pointerId,type:e.pointerType,event:type,buttons:e.buttons,target:e.target.tagName}))
  })
  const cdp=await context.newCDPSession(page)
  const pen=async(type,x,y,buttons=1)=>cdp.send('Input.dispatchMouseEvent',{
    type,x,y,pointerType:'pen',button:type==='mouseMoved'?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1,
  })
  await pen('mousePressed',220,350)
  await pen('mouseMoved',240,350)
  expect(await page.evaluate(()=>window.penEvents.at(-1).type)).toBe('pen')
  // A real active pointer, with a driver-style cancellation between contacts.
  await page.evaluate(()=>{
    const id=window.penEvents.at(-1).id
    document.querySelector('canvas').dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:id,pointerType:'pen',clientX:240,clientY:350}))
  })
  await pen('mouseReleased',240,350,0)
  await pen('mousePressed',243,350)
  await pen('mouseMoved',265,355)
  await pen('mouseReleased',265,355,0)
  // Hover during the recovery interval must not add points or create a line to the cursor.
  await pen('mouseMoved',500,500,0)
  await expect.poll(async()=>(await content(page)).strokes?.length).toBe(1)
  const strokes=(await content(page)).strokes
  expect(strokes[0].points.some(p=>p.x===243)).toBe(true)
  expect(strokes[0].points.every(p=>p.x<300)).toBe(true)
  await page.waitForTimeout(1000)
  await pen('mousePressed',267,355)
  await pen('mouseMoved',285,355)
  await pen('mouseReleased',285,355,0)
  await expect.poll(async()=>(await content(page)).strokes?.length).toBe(2)
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await content(page)).strokes?.length).toBe(1)
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await content(page)).strokes?.length).toBe(0)
  await page.keyboard.press('Control+y')
  await expect.poll(async()=>(await content(page)).strokes?.length).toBe(1)
  await page.reload()
  await expect.poll(async()=>(await content(page)).strokes?.length).toBe(1)
})
