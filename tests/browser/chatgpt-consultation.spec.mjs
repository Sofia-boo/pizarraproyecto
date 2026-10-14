import {test,expect} from '@playwright/test'

async function board(page){return page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
  const all=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>resolve(r.result)})
  db.close();const saved=all.find(b=>b.id===localStorage.getItem('pizarra_activa'));return saved?.draft??saved?.content
})}
async function open(page){
  await page.getByRole('button',{name:'IA: opciones de reconocimiento',exact:true}).click()
  await page.getByRole('menuitem',{name:/Consultar con ChatGPT/}).click()
  return page.getByRole('dialog',{name:'ChatGPT',exact:true})
}
for(const tablet of [false,true])test.describe(tablet?'Tablet':'PC',()=>{
  test.use(tablet?{viewport:{width:800,height:1280},hasTouch:true,isMobile:true}:{viewport:{width:1366,height:900}})
  test('same independent workflow separates conversations and pastes native editable mathematics',async({page})=>{
    const calls=[]
    page.on('request',r=>{if(r.url().includes('/api/chatgpt/'))calls.push(r.url())})
    await page.route('**/api/**',r=>r.fulfill({status:503,body:'offline'}))
    await page.addInitScript(()=>{
      sessionStorage.setItem('chatgpt-mode:device','pc')
      window.answer=String.raw`## Mi base
\[v_1=\begin{pmatrix}1\\0\\0\end{pmatrix},\quad A=\begin{bmatrix}1&2\\3&4\end{bmatrix}\]
\(\langle v_2,v_1\rangle=\frac{4}{2}\)`
      Object.defineProperty(navigator,'clipboard',{value:{readText:async()=>window.answer,writeText:async()=>{}}})
    })
    await page.goto('/');await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
    await expect.poll(async()=>(await board(page))?.camera).toBeDefined()
    let dialog=await open(page)
    await expect(dialog.getByRole('button',{name:'Con PC',exact:true})).toHaveCount(0)
    await expect(dialog.getByRole('button',{name:'En este dispositivo',exact:true})).toHaveCount(0)
    await dialog.getByRole('textbox',{name:'Pregunta para ChatGPT'}).fill('Primera pregunta')
    await dialog.getByRole('button',{name:'Pegar como texto editable',exact:true}).click()
    await expect(dialog.locator('.chatgpt-message.assistant')).toHaveCount(1)
    await expect.poll(async()=>(await board(page))?.shapes?.map(s=>s.matrix)).toEqual([[['1'],['0'],['0']],[['1','2'],['3','4']]])
    expect((await board(page)).texts.map(t=>t.text).join('')).not.toContain('\\begin')
    await dialog.getByRole('button',{name:'Cambiar de chat',exact:true}).click()
    await expect(dialog.locator('.chatgpt-message')).toHaveCount(0)
    await expect(dialog.getByRole('textbox',{name:'Pregunta para ChatGPT'})).toHaveValue('')
    await page.evaluate(()=>{window.answer='Respuesta del segundo chat'})
    await dialog.getByRole('button',{name:'Pegar como texto editable',exact:true}).click()
    await expect(dialog.locator('.chatgpt-message')).toContainText('Respuesta del segundo chat')
    await dialog.getByRole('combobox',{name:'Conversación de la pizarra'}).selectOption('initial')
    await expect(dialog.getByRole('textbox',{name:'Pregunta para ChatGPT'})).toHaveValue('Primera pregunta')
    await expect(dialog.locator('.chatgpt-message')).not.toContainText('Respuesta del segundo chat')
    await dialog.getByRole('button',{name:'Cerrar ChatGPT',exact:true}).click()
    await page.reload();dialog=await open(page)
    await expect(dialog.getByRole('textbox',{name:'Pregunta para ChatGPT'})).toHaveValue('Primera pregunta')
    await expect(dialog.getByRole('combobox').locator('option')).toHaveText(['Chat 2','Chat 1'])
    await dialog.getByRole('button',{name:'Cerrar ChatGPT',exact:true}).click()
    const saved=await board(page),vector=saved.shapes[0],camera=saved.camera
    await page.getByRole('button',{name:'Seleccionar área',exact:true}).click()
    await page.mouse.click((vector.x+vector.width/2)*camera.zoom+camera.x,(vector.y+vector.height/2)*camera.zoom+camera.y)
    await page.getByRole('button',{name:'Editar elemento',exact:true}).click()
    await page.getByRole('textbox',{name:'Matriz del lienzo: fila 1, columna 1'}).fill('9')
    await page.getByRole('button',{name:'Aplicar',exact:true}).click()
    await expect.poll(async()=>(await board(page)).shapes[0].matrix[0][0]).toBe('9')
    expect(calls).toEqual([])
    await page.screenshot({path:`test-results/chatgpt-unificado-${tablet?'tablet':'pc'}.png`})
  })
})
