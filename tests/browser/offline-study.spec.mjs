import {test,expect} from '@playwright/test'

async function saved(page){return page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
  const records=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>resolve(r.result)})
  db.close();return records.find(b=>b.id===localStorage.getItem('pizarra_activa'))
})}
async function ready(page){
  await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true))
  await page.getByRole('button',{name:/Abrir perfil de/}).click()
  await expect(page.getByText('✓ App lista para usar sin internet.',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:/Abrir perfil de/}).click()
}
function smallPDF(){
  const ink='0 0 1 rg 20 20 100 100 re f\n'
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << >> /Contents 4 0 R >>',`<< /Length ${ink.length} >>\nstream\n${ink}endstream`]
  let pdf='%PDF-1.4\n',offsets=[0]
  objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${o}\nendobj\n`})
  const xref=pdf.length
  pdf+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf)
}

test('offline private study opens in a new window, imports PDF, draws, calculates and loads uncached graph UI',async({page,context})=>{
  test.setTimeout(60000)
  await page.route('**/api/**',r=>r.fulfill({status:401,body:'{}'}))
  await page.goto('/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect.poll(async()=>(await saved(page))?.content.camera).toBeDefined()
  await ready(page)
  await context.setOffline(true)
  await page.close()
  const offline=await context.newPage()
  await offline.goto('/?app=1')
  await expect(offline.locator('canvas').first()).toBeVisible()
  await expect(offline.locator('.library-open-button')).toContainText('privada')
  await expect(offline.locator('.offline-status')).toBeVisible()
  await offline.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles({name:'apunte.pdf',mimeType:'application/pdf',buffer:smallPDF()})
  await expect.poll(async()=>(await saved(offline))?.content.media.length).toBe(1)
  await offline.locator('.library-open-button').click()
  await offline.getByRole('button',{name:'Preparar esta pizarra sin conexión',exact:true}).click()
  await expect(offline.locator('.device-storage-panel')).toContainText('Copia de esta pizarra completa en este dispositivo (1 archivo).')
  await offline.locator('.library-panel header button[title="Cerrar"]').click()
  await offline.getByRole('button',{name:'Calculadora científica',exact:true}).click()
  await offline.getByRole('button',{name:'Cálculo Científica',exact:true}).click()
  await offline.getByRole('textbox',{name:'Expresión de la calculadora'}).fill('2+3')
  await offline.getByRole('button',{name:'=',exact:true}).click()
  await expect(offline.locator('.math-screen')).toContainText('5')
  await offline.getByRole('button',{name:'Cerrar panel',exact:true}).click()
  await offline.getByRole('button',{name:'Graficar funciones',exact:true}).click()
  await expect(offline.locator('.js-plotly-plot')).toBeVisible({timeout:20000})
  await offline.getByRole('button',{name:'Cerrar panel',exact:true}).click()
  await offline.getByRole('button',{name:'Opciones del lápiz',exact:true}).click()
  await offline.keyboard.press('Escape')
  await offline.mouse.move(200,280);await offline.mouse.down();await offline.mouse.move(320,340,{steps:6});await offline.mouse.up()
  // Flush before the debounce when the tablet backgrounds the app.
  await offline.evaluate(()=>window.dispatchEvent(new Event('pagehide')))
  await expect.poll(async()=>(await saved(offline))?.content.strokes.length).toBe(1)
  await offline.reload()
  await expect.poll(async()=>(await saved(offline))?.content.media.length).toBe(1)
  expect((await saved(offline)).content.strokes).toHaveLength(1)
  await offline.getByRole('button',{name:'IA: opciones de reconocimiento',exact:true}).click()
  await offline.getByRole('menuitem',{name:'OCR Datalab · PDF completo o imagen…'}).click()
  await expect(offline.getByRole('dialog',{name:'Transcripción con Datalab'})).toContainText('Sin conexión:')
  await expect(offline.getByRole('button',{name:'Transcribir con Datalab',exact:true})).toBeDisabled()
})

test('cached signed-in shared board reopens offline and synchronizes its edits as soon as the connection returns',async({page,context})=>{
  test.setTimeout(60000)
  let content={strokes:[],texts:[],media:[],shapes:[],tables:[],graphs:[],videos:[],camera:{x:0,y:0,zoom:1}},version=1,saves=0,uploads=0
  await context.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/auth/me')return route.fulfill({json:{id:'offline-student',display_name:'Estudiante',color:'#6366f1',is_admin:0,emoji:'📚'}})
    if(path==='/api/library')return route.fulfill({json:{folders:[],boards:[{id:'study-shared',name:'Facultad',folder_id:null,version,updated_at:'2026-10-11',role:'editor'}]}})
    if(path==='/api/boards/study-shared'){
      if(route.request().method()==='PUT'){content=route.request().postDataJSON().content;version++;saves++}
      return route.fulfill({json:{id:'study-shared',name:'Facultad',version,content}})
    }
    if(path.startsWith('/api/assets/')&&route.request().method()==='PUT'){uploads++;return route.fulfill({json:{ok:true}})}
    return route.fulfill({status:503,json:{detail:'No live socket in this test'}})
  })
  await page.goto('/')
  await expect.poll(async()=>(await saved(page))?.id).toBe('study-shared')
  await ready(page)
  expect(await page.evaluate(()=>localStorage.getItem('pizarra-modo-local-preferido'))).toBeNull()
  await context.setOffline(true);await page.close()
  const offline=await context.newPage();await offline.goto('/?app=1')
  await expect(offline.locator('canvas').first()).toBeVisible()
  await expect(offline.locator('.library-open-button')).toContainText('Facultad')
  await expect(offline.getByRole('button',{name:/Abrir perfil de Estudiante/})).toBeVisible()
  await offline.mouse.move(200,300);await offline.mouse.down();await offline.mouse.move(310,360,{steps:6});await offline.mouse.up()
  await expect.poll(async()=>(await saved(offline))?.draft?.strokes.length).toBe(1)
  await offline.locator('input[type=file][accept^="image/png"]').setInputFiles({name:'foto.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=','base64')})
  await expect.poll(async()=>(await saved(offline))?.draft?.media.length).toBe(1)
  expect(saves).toBe(0)
  expect(uploads).toBe(0)
  await offline.reload()
  await expect(offline.locator('canvas').first()).toBeVisible()
  expect((await saved(offline)).draft.strokes).toHaveLength(1)
  await context.setOffline(false)
  await expect.poll(()=>saves,{timeout:15000}).toBeGreaterThan(0)
  await expect.poll(async()=>(await saved(offline))?.draft).toBeUndefined()
  expect(content.strokes).toHaveLength(1)
  expect(content.media).toHaveLength(1)
  expect(uploads).toBe(1)
  await expect(offline.locator('.offline-status')).toHaveCount(0)
})
