import {test,expect} from '@playwright/test'

async function openLocal(page) {
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'offline'}))
  await page.goto('/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect.poll(async()=>(await content(page))?.camera).toBeDefined()
}
async function content(page) {
  return page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    const boards=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>resolve(r.result)})
    db.close();return boards.find(b=>b.id===localStorage.getItem('pizarra_activa'))?.content
  })
}
test('ODE fields and numerical solutions can be inserted without formulas and survive reload',async({page})=>{
  await openLocal(page)
  await page.getByRole('button',{name:'Graficar funciones',exact:true}).click()
  await page.getByRole('textbox',{name:'Fórmula 1',exact:true}).fill('')
  await page.getByRole('button',{name:'Opciones del gráfico',exact:true}).click()
  await page.getByRole('checkbox',{name:'Activar EDO',exact:true}).check()
  await page.getByRole('textbox',{name:'Función de la EDO',exact:true}).fill('y')
  await expect.poll(()=>page.locator('.graph-plot-canvas').evaluate(el=>el.data?.map(t=>t.name)??[])).toContain('Solución numérica de la EDO')
  await page.getByRole('button',{name:'Cerrar opciones',exact:true}).click()
  await page.getByRole('button',{name:'Insertar gráfico',exact:true}).click()
  await expect.poll(async()=>(await content(page))?.graphs?.[0]?.settings?.ode?.expression).toBe('y')
  await page.reload()
  await expect(page.locator('.board-live-graph')).toBeVisible()
  await expect.poll(()=>page.locator('.board-live-graph .graph-plot-canvas').evaluate(el=>el.data?.map(t=>t.name)??[])).toContain('Campo direccional')
  await page.screenshot({path:'test-results/edo-campo-direccional.png'})
})
