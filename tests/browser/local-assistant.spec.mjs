import {test,expect} from '@playwright/test'
import {MODEL_CACHE,MODEL_FILES,modelURL} from '../../src/assistant/config.ts'

async function open(page){
  await page.getByRole('button',{name:'IA: opciones de reconocimiento',exact:true}).click()
  await page.getByRole('menuitem',{name:/Asistente de estudio local/}).click()
  return page.getByRole('dialog',{name:'Asistente de estudio local'})
}
test('assistant UI with a simulated engine preserves conversations, inserts answers and captures handwriting offline',async({page,context})=>{
  await page.addInitScript(({cacheName,urls})=>{
    const Original=window.Worker
    window.Worker=class{
      constructor(url,options){if(!String(url).includes('engine.worker'))return new Original(url,options);this.terminated=false}
      terminate(){this.terminated=true}
      async postMessage(message){
        if(message.type==='load'){
          const cache=await caches.open(cacheName)
          for(const url of urls)await cache.put(url,new Response('simulated model for UI test'))
          if(!this.terminated)this.onmessage?.({data:{type:'ready'}})
        }
        if(message.type==='ask'){
          window.lastAssistantRequest=message
          const text='Resultado: $2 + 3 = 5$.\n$$\\frac{1}{2} \\cdot \\frac{1}{3} = \\frac{1}{6}$$'
          this.onmessage?.({data:{type:'text',text}})
          this.onmessage?.({data:{type:'done',text}})
        }
      }
    }
  },{cacheName:MODEL_CACHE,urls:MODEL_FILES.map(modelURL)})
  await page.route('**/api/**',r=>r.fulfill({status:503,body:'offline'}))
  await page.goto('/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect(page.locator('.library-open-button')).toContainText('privada')
  await page.mouse.move(220,310);await page.mouse.down();await page.mouse.move(330,380,{steps:6});await page.mouse.up()
  let dialog=await open(page)
  await dialog.getByRole('button',{name:/Descargar IA para/}).click()
  await expect(dialog.getByRole('status')).toHaveText('IA lista')
  await context.setOffline(true)
  await dialog.getByRole('textbox',{name:'Pregunta al asistente'}).fill('¿Cuánto es 2 + 3?')
  await dialog.getByRole('button',{name:'Preguntar',exact:true}).click()
  await expect(dialog.locator('.assistant-answer').last()).toContainText('5')
  await expect(dialog.locator('.assistant-answer .katex')).toHaveCount(2)
  await dialog.locator('.assistant-message.assistant').last().getByLabel('Acciones del mensaje').click()
  await dialog.getByRole('button',{name:'Insertar en la pizarra'}).click()
  await dialog.getByRole('textbox',{name:'Pregunta al asistente'}).fill('Explicá el ejercicio de mi manuscrito')
  await dialog.getByRole('button',{name:'Adjuntar ▾',exact:true}).click()
  await dialog.getByRole('menuitem',{name:'Agregar selección de la pizarra',exact:true}).click()
  await expect(page.locator('.ocr-selection-instruction')).toBeVisible()
  await page.mouse.move(195,285);await page.mouse.down();await page.mouse.move(350,400,{steps:8});await page.mouse.up()
  dialog=page.getByRole('dialog',{name:'Asistente de estudio local'})
  await expect(dialog.getByRole('img',{name:'Imagen a consultar'})).toBeVisible()
  await expect(dialog.getByRole('textbox',{name:'Pregunta al asistente'})).toHaveValue('Explicá el ejercicio de mi manuscrito')
  await expect(dialog.locator('.assistant-answer').last()).toContainText('5')
  await dialog.getByRole('button',{name:'Cargar IA guardada',exact:true}).click()
  await dialog.getByRole('button',{name:'Preguntar',exact:true}).click()
  expect(await page.evaluate(()=>window.lastAssistantRequest.messages.at(-1).image)).toMatch(/^data:image\/jpeg/)
  await expect(dialog.locator('.assistant-message')).toHaveCount(4)
  await dialog.getByRole('button',{name:'Cerrar asistente',exact:true}).click()
  await page.reload()
  await expect(page.locator('.library-open-button')).toContainText('privada')
  dialog=await open(page)
  await expect(dialog.locator('.assistant-message')).toHaveCount(4)
  await expect(dialog.getByRole('button',{name:'Cargar IA guardada',exact:true})).toBeEnabled()
  await expect(dialog.locator('.assistant-tools,.assistant-settings,.assistant-storage')).toHaveCount(0)
  await page.setViewportSize({width:800,height:650})
  const bounds=await dialog.boundingBox(),chat=await dialog.locator('.assistant-messages').boundingBox()
  expect(chat.height).toBeGreaterThan(bounds.height*.55)
  expect(await dialog.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeLessThanOrEqual(1)
  await page.screenshot({path:'test-results/assistant-simple-tablet.png'})
  await dialog.getByRole('button',{name:'Cerrar asistente',exact:true}).click()
  await expect(dialog).toHaveCount(0)
  await page.clock.install()
  await page.evaluate(()=>{localStorage.setItem('study-check-in:device','5');window.dispatchEvent(new Event('study-check-in-settings'))})
  await page.clock.fastForward('04:50')
  await page.mouse.click(150,200)
  await page.clock.fastForward('00:20')
  await expect(page.getByLabel('Pausa de estudio')).toBeVisible()
  await page.getByRole('button',{name:'Pausar avisos',exact:true}).click()
  await expect(page.getByLabel('Pausa de estudio')).toHaveCount(0)
  await page.screenshot({path:'test-results/assistant-offline-ui.png'})
})

test('compact chat attaches a PDF through its menu and reads relevant pages locally',async({page})=>{
  await page.setViewportSize({width:390,height:480})
  await page.addInitScript(({cacheName,urls})=>{
    const Original=window.Worker
    window.Worker=class{
      constructor(url,options){if(!String(url).includes('engine.worker'))return new Original(url,options)}
      terminate(){}
      async postMessage(message){
        if(message.type==='load'){const cache=await caches.open(cacheName);for(const url of urls)await cache.put(url,new Response('fake model'));this.onmessage?.({data:{type:'ready'}})}
        if(message.type==='ask'){window.pdfAssistantRequest=message;this.onmessage?.({data:{type:'done',text:'SELECT permite consultar datos. La fracción es $\\frac{1}{2}$.'}})}
      }
    }
  },{cacheName:MODEL_CACHE,urls:MODEL_FILES.map(modelURL)})
  await page.route('**/api/**',r=>r.fulfill({status:503,body:'offline'}))
  await page.goto('/');await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  const dialog=await open(page)
  await dialog.getByRole('button',{name:/Descargar IA para/}).click()
  await expect(dialog.getByRole('status')).toHaveText('IA lista')
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>']
  for(let i=0;i<2;i++){
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 7 0 R >> >> /Contents ${4+i*2} 0 R >>`)
    const text=i===0?'Matrices and determinants':'SELECT name FROM students - SQL databases'
    const content=`BT /F1 12 Tf 15 160 Td (${text}) Tj ET\n`
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`)
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  let pdf='%PDF-1.4\n';const offsets=[0]
  objects.forEach((object,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${object}\nendobj\n`})
  const xref=pdf.length
  pdf+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  await dialog.getByRole('button',{name:'Adjuntar ▾',exact:true}).click()
  const chooser=page.waitForEvent('filechooser')
  await dialog.getByRole('menuitem',{name:'Seleccionar archivo o imagen',exact:true}).click()
  await (await chooser).setFiles({name:'estudio.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdf)})
  await expect(dialog.locator('.assistant-attachment')).toContainText('estudio.pdf')
  await dialog.getByLabel('Pregunta al asistente').fill('Explicá SELECT en SQL de la página 2')
  await dialog.getByRole('button',{name:'Preguntar',exact:true}).click()
  await expect(dialog.locator('.assistant-answer .katex')).toHaveCount(1)
  const request=await page.evaluate(()=>window.pdfAssistantRequest)
  expect(request.context).toContain('página 2');expect(request.context).toContain('SELECT name FROM students')
  expect(request.messages.at(-1).document).toBeUndefined()
  expect(request.messages.at(-1).image).toBeUndefined()
  expect(request.messages.at(-1).fileName).toBe('estudio.pdf')
  const box=await dialog.boundingBox(),chat=await dialog.locator('.assistant-messages').boundingBox()
  expect(chat.height).toBeGreaterThan(box.height*.5)
  await expect(dialog.getByRole('button',{name:'Preguntar',exact:true})).toBeInViewport()
  expect(await dialog.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeLessThanOrEqual(1)
  await page.screenshot({path:'test-results/assistant-simple-small-screen.png'})
})
