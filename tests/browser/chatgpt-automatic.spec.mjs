import {test,expect} from '@playwright/test'

async function open(page){
  await page.route('**/api/auth/me',r=>r.fulfill({status:401,json:{detail:'fixture'}}))
  await page.goto('/');await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await page.getByRole('button',{name:'IA: opciones de reconocimiento',exact:true}).click()
  await page.getByRole('menuitem',{name:/Consultar con ChatGPT/}).click()
  const dialog=page.getByRole('dialog',{name:'ChatGPT',exact:true})
  await expect(dialog.getByRole('button',{name:'Conectar ChatGPT',exact:true})).toBeEnabled()
  return dialog
}
test('PC sends once, receives the answer automatically and keeps conversations separate',async({page})=>{
  const requests=[];let complete=true,submitted=0
  await page.route('**/api/chatgpt/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname
    if(path.endsWith('/status'))return route.fulfill({json:{state:'ready'}})
    if(path.endsWith('/consult')){
      submitted++;requests.push(await new Request(req.url(),{method:'POST',headers:req.headers(),body:req.postDataBuffer()}).formData())
      return route.fulfill({status:202,json:{id:'auto-'+submitted,status:'running'}})
    }
    return route.fulfill({json:{id:'auto-'+submitted,status:complete?'complete':'running',text:'## Resultado\n$\\frac{1}{2}$',conversation:'https://chatgpt.com/c/12345678-abcd-1234-abcd-123456789012'}})
  })
  const dialog=await open(page)
  await dialog.getByRole('button',{name:'Conectar ChatGPT',exact:true}).click()
  await expect(dialog.getByRole('button',{name:'Conectado a ChatGPT',exact:true})).toBeVisible()
  await dialog.getByRole('textbox',{name:'Pregunta para ChatGPT'}).fill('Resolver el ejercicio')
  await dialog.locator('input[type=file]').setInputFiles({name:'foto.png',mimeType:'image/png',buffer:Buffer.from('image fixture')})
  await dialog.getByRole('button',{name:'Enviar',exact:true}).evaluate(button=>{button.click();button.click()})
  await expect(dialog.locator('.chatgpt-message.assistant')).toHaveCount(1)
  expect(submitted).toBe(1);expect(requests[0].get('prompt')).toBe('Resolver el ejercicio');expect(requests[0].getAll('files')).toHaveLength(1)
  await expect(dialog.locator('.chatgpt-message.assistant .katex')).toBeVisible()
  await dialog.getByRole('textbox',{name:'Pregunta para ChatGPT'}).fill('Continuar')
  await dialog.getByRole('button',{name:'Enviar',exact:true}).click()
  await expect(dialog.locator('.chatgpt-message.assistant')).toHaveCount(2)
  expect(requests[1].get('conversation')).toContain('/c/12345678')
  await dialog.getByRole('button',{name:'Cambiar de chat',exact:true}).click()
  await expect(dialog.locator('.chatgpt-message')).toHaveCount(0)
  complete=false
  await dialog.getByRole('textbox',{name:'Pregunta para ChatGPT'}).fill('Otro ejercicio')
  await dialog.getByRole('button',{name:'Enviar',exact:true}).click()
  await expect(dialog.getByText('ChatGPT está respondiendo…',{exact:true})).toBeVisible()
  expect(requests[2].get('conversation')).toBeNull()
  await dialog.getByRole('button',{name:'Cerrar ChatGPT',exact:true}).click()
  complete=true
  await page.reload()
  await page.getByRole('button',{name:'IA: opciones de reconocimiento',exact:true}).click();await page.getByRole('menuitem',{name:/Consultar con ChatGPT/}).click()
  await expect(dialog.locator('.chatgpt-message.assistant')).toHaveCount(1)
  expect(submitted).toBe(3)
})

test('a lost PC job releases the panel without automatically submitting it again',async({page})=>{
  let sends=0
  await page.route('**/api/chatgpt/**',route=>{
    const path=new URL(route.request().url()).pathname
    if(path.endsWith('/status'))return route.fulfill({json:{state:'ready'}})
    if(path.endsWith('/consult')){sends++;return route.fulfill({status:202,json:{id:'lost-job',status:'running'}})}
    return route.fulfill({status:404,json:{detail:'La consulta ya no está disponible. Revisá Chrome.'}})
  })
  const dialog=await open(page);await dialog.getByRole('button',{name:'Conectar ChatGPT',exact:true}).click()
  await dialog.getByRole('textbox',{name:'Pregunta para ChatGPT'}).fill('Conservar la pregunta')
  await dialog.getByRole('button',{name:'Enviar',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('Revisá Chrome')
  await expect(dialog.getByRole('button',{name:'Cambiar de chat',exact:true})).toBeEnabled()
  await expect(dialog.locator('.chatgpt-message.user')).toContainText('Conservar la pregunta')
  expect(sends).toBe(1)
})

test.describe('local Android controller',()=>{
  test.use({viewport:{width:1000,height:1280},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0'})
  test('uses the validated device channel for text, binary attachments and the answer with no PC requests',async({page})=>{
    const pc=[];page.on('request',r=>{if(r.url().includes('/api/chatgpt/'))pc.push(r.url())})
    await page.route('**/api/**',r=>r.fulfill({status:503,body:'PC apagada'}))
    await page.addInitScript(()=>{
      sessionStorage.setItem('pizarra-native-browser','1')
      addEventListener('load',()=>{
        const channel=new MessageChannel();window.nativeCalls=[];window.uploaded='';let polls=0
        channel.port1.onmessage=event=>{
          const request=JSON.parse(event.data);window.nativeCalls.push(request.method)
          let data={state:'ready'}
          if(request.method==='prepare'){window.nativePrepared=request.data;data={id:request.data.request_id,status:'preparing'}}
          if(request.method==='chunk'){window.uploaded+=atob(request.data.chunk);data={ok:true}}
          if(request.method==='submit')data={id:request.data.job,status:'running'}
          if(request.method==='result')data={id:request.data.job,status:++polls>1?'complete':'running',text:'Respuesta desde la tablet: $\\frac{3}{4}$'}
          channel.port1.postMessage(JSON.stringify({type:'pizarra-native-response',id:request.id,data}))
        }
        window.postMessage(JSON.stringify({type:'pizarra-native-ready',version:3}),location.origin,[channel.port2])
      })
    })
    const dialog=await open(page)
    await dialog.getByRole('button',{name:'Conectar ChatGPT',exact:true}).tap()
    await dialog.getByRole('textbox',{name:'Pregunta para ChatGPT'}).fill('Explicá mi manuscrito')
    const bytes=Buffer.from(Array.from({length:70000},(_,i)=>i%256))
    await dialog.locator('input[type=file]').setInputFiles({name:'manuscrito.png',mimeType:'image/png',buffer:bytes})
    await dialog.getByRole('button',{name:'Enviar',exact:true}).tap()
    await expect(dialog.locator('.chatgpt-message.assistant')).toContainText('Respuesta desde la tablet')
    const transferred=await page.evaluate(()=>({data:Array.from(window.uploaded,character=>character.charCodeAt(0)),calls:window.nativeCalls,request:window.nativePrepared}))
    expect(Buffer.from(transferred.data)).toEqual(bytes)
    expect(transferred.request.prompt).toBe('Explicá mi manuscrito')
    expect(transferred.calls.filter(method=>method==='submit')).toHaveLength(1)
    expect(pc).toEqual([])
  })
})
