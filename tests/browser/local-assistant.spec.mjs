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
          this.onmessage?.({data:{type:'text',text:'Resultado: 2 + 3 = 5'}})
          this.onmessage?.({data:{type:'done',text:'Resultado: 2 + 3 = 5'}})
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
  await expect(dialog.getByText('IA cargada · podés usarla sin internet.',{exact:true})).toBeVisible()
  await context.setOffline(true)
  await dialog.getByRole('textbox',{name:'Pregunta al asistente'}).fill('¿Cuánto es 2 + 3?')
  await dialog.getByRole('button',{name:'Preguntar',exact:true}).click()
  await expect(dialog.locator('.assistant-answer').last()).toContainText('5')
  await dialog.getByRole('button',{name:'Insertar en la pizarra'}).click()
  await dialog.getByRole('textbox',{name:'Pregunta al asistente'}).fill('Explicá el ejercicio de mi manuscrito')
  await dialog.getByRole('button',{name:'Seleccionar manuscrito o imagen'}).click()
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
  await dialog.getByText('Comprobar matemática y dibujar',{exact:true}).click()
  await dialog.getByLabel('Expresión para comprobar').fill('x^2')
  await dialog.getByRole('button',{name:'Derivar en x',exact:true}).click()
  await expect(dialog.locator('output')).toContainText('2 * x')
  await dialog.getByRole('button',{name:'Escribir cálculo en pizarra',exact:true}).click()
  await dialog.getByRole('button',{name:'Poner gráfico en pizarra',exact:true}).click()
  await dialog.getByText('Comprobar matemática y dibujar',{exact:true}).click()
  await dialog.getByRole('button',{name:'Cerrar asistente',exact:true}).click()
  await expect(page.locator('.board-live-graph')).toBeVisible()
  await page.clock.install()
  dialog=await open(page)
  await dialog.getByLabel('Frecuencia de preguntas de estudio').selectOption('5')
  await dialog.getByRole('button',{name:'Cerrar asistente',exact:true}).click()
  await expect(dialog).toHaveCount(0)
  await page.clock.fastForward('04:50')
  await page.mouse.click(150,200)
  await page.clock.fastForward('00:20')
  await expect(page.getByLabel('Pausa de estudio')).toBeVisible()
  await page.getByRole('button',{name:'Pausar avisos',exact:true}).click()
  await expect(page.getByLabel('Pausa de estudio')).toHaveCount(0)
  await page.screenshot({path:'test-results/assistant-offline-ui.png'})
})
