import {test,expect} from '@playwright/test'
import {htmlFixture} from './html-live-fixture.mjs'
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

test('HTML shares actual controls, canvas, timers and scroll without executing scripts twice',async({browser})=>{
  const contexts=await Promise.all([browser.newContext(),browser.newContext({viewport:{width:1280,height:800},hasTouch:true}),browser.newContext()])
  const pages=await Promise.all(contexts.map(context=>context.newPage()))
  const {sockets,events}=await htmlFixture(pages)
  const [a,b,c]=pages
  try{
    await Promise.all([a.goto('/'),b.goto('/')])
    await expect.poll(()=>sockets.size).toBe(2)
    await expect(b.getByRole('button',{name:'Activar HTML compartido.html',exact:true})).toBeVisible()
    await b.evaluate(async()=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
      window.fullPaints=0
      const ctx=document.querySelector('.app>canvas').getContext('2d'),clear=ctx.clearRect.bind(ctx)
      ctx.clearRect=(...args)=>{window.fullPaints++;clear(...args)}
    })
    await a.getByRole('button',{name:'Activar HTML compartido.html',exact:true}).click()
    const owner=a.frameLocator('.board-html-widget iframe'),mirror=b.frameLocator('.board-html-widget iframe')
    await owner.locator('#count').click()
    await expect(mirror.locator('#count')).toHaveText('Contador 1')
    await expect(mirror.locator('html')).toHaveAttribute('data-counter','1')
    await expect(b.getByRole('status')).toContainText('Ana está usando este HTML')
    await owner.getByLabel('Nombre',{exact:true}).fill('Matemática 🙂')
    await expect(mirror.locator('#result')).toHaveText('Matemática 🙂')
    await expect(mirror.getByLabel('Nombre',{exact:true})).toHaveValue('Matemática 🙂')
    await owner.getByLabel('Activar',{exact:true}).check()
    await owner.getByLabel('Opción').selectOption('Dos')
    await expect(mirror.getByLabel('Activar',{exact:true})).toBeChecked()
    await expect(mirror.getByLabel('Opción')).toHaveValue('Dos')
    await expect(mirror.locator('img[data-pizarra-node]')).toHaveCount(1)
    const data=await mirror.locator('img[data-pizarra-node]').evaluate(image=>{const c=document.createElement('canvas');c.width=80;c.height=25;c.getContext('2d').drawImage(image,0,0);return [...c.getContext('2d').getImageData(5,5,1,1).data]})
    expect(data[1]).toBeGreaterThan(100);expect(data[0]).toBeLessThan(10)
    await owner.locator('#scroll').evaluate(element=>element.scrollTop=150)
    await expect.poll(()=>mirror.locator('#scroll').evaluate(element=>element.scrollTop)).toBe(150)
    const time=await mirror.locator('#time').textContent()
    await expect.poll(()=>mirror.locator('#time').textContent()).not.toBe(time)
    await expect(mirror.getByLabel('Secreto')).toHaveValue('')
    await expect(mirror.getByLabel('Secreto')).toBeDisabled()
    expect(await mirror.locator('#animated').evaluate(element=>getComputedStyle(element).animationName)).toBe('none')
    const transform=await mirror.locator('#animated').evaluate(element=>element.style.transform)
    await expect.poll(()=>mirror.locator('#animated').evaluate(element=>element.style.transform)).not.toBe(transform)
    expect(await a.evaluate(()=>window.executions)).toBe(1)
    expect(await b.evaluate(()=>window.executions)).toBe(0)
    expect(await b.evaluate(()=>window.fullPaints)).toBe(0)
    // The tablet edits the same live simulation, rather than a local duplicate.
    await b.getByRole('button',{name:'Seleccionar área',exact:true}).click()
    await mirror.locator('#count').tap()
    await expect(owner.locator('#count')).toHaveText('Contador 2')
    await expect(mirror.locator('#count')).toHaveText('Contador 2')
    await mirror.getByLabel('Nombre',{exact:true}).fill('Desde tablet')
    await expect(owner.locator('#result')).toHaveText('Desde tablet')
    await expect(mirror.locator('#result')).toHaveText('Desde tablet')
    await mirror.getByLabel('Activar',{exact:true}).uncheck()
    await expect(owner.getByLabel('Activar',{exact:true})).not.toBeChecked()
    await mirror.getByLabel('Opción').selectOption('Uno')
    await expect(owner.getByLabel('Opción')).toHaveValue('Uno')
    await c.goto('/')
    await expect(c.frameLocator('.board-html-widget iframe').locator('#count')).toHaveText('Contador 2')
    await expect(c.frameLocator('.board-html-widget iframe').locator('#result')).toHaveText('Desde tablet')
    expect(await c.evaluate(()=>window.executions)).toBe(0)
    expect(events.filter(event=>event.type==='html_frame').slice(1).some(event=>event.text.length<200)).toBe(true)
    await a.getByRole('button',{name:'Detener HTML compartido.html',exact:true}).click()
    await expect(b.getByText('HTML detenido · última vista')).toBeVisible()
    await expect(a.locator('.board-html-widget iframe')).toHaveCount(1) // inert last view
    await expect(b.getByText('Ana está usando este HTML')).toHaveCount(0)
  }finally{await Promise.all(contexts.map(context=>context.close()))}
})
