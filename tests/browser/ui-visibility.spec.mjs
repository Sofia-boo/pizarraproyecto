import {test,expect} from '@playwright/test'

for(const tablet of [false,true])test.describe(tablet?'Tablet':'PC',()=>{
  test.use(tablet?{viewport:{width:1000,height:700},hasTouch:true,isMobile:true}:{viewport:{width:1366,height:900}})
test('board controls stay on screen when an embedded input requests focus outside the viewport',async({page})=>{
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'isolated fixture'}))
  await page.goto('/');await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect.poll(()=>page.evaluate(async()=>{
    if(!localStorage.getItem('pizarra_activa'))return undefined
    const db=await new Promise(resolve=>{const request=indexedDB.open('pizarra-dispositivo',1);request.onsuccess=()=>resolve(request.result)})
    const row=await new Promise(resolve=>{const request=db.transaction('boards').objectStore('boards').get(localStorage.getItem('pizarra_activa'));request.onsuccess=()=>resolve(request.result)})
    db.close();return row?.content?.camera
  })).toBeDefined()
  await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const request=indexedDB.open('pizarra-dispositivo',1);request.onsuccess=()=>resolve(request.result)})
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('boards','readwrite'),store=tx.objectStore('boards'),request=store.get(localStorage.getItem('pizarra_activa'))
      request.onsuccess=()=>{const row=request.result;row.content={...row.content,shapes:[{id:'offscreen-html',kind:'rectangle',visualType:'html',x:2500,y:2000,width:640,height:440,color:'#64748b',strokeWidth:1,zIndex:150000,html:{name:'focus.html',source:'<div style="height:1800px"></div><input aria-label="Campo"><button>Probar</button>'}}]};delete row.draft;store.put(row)}
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)
    });db.close()
  })
  await page.reload();await expect(page.locator('.board-html-widget')).toBeAttached()
  await page.getByRole('button',{name:'Activar HTML focus.html',exact:true}).evaluate(button=>button.click())
  await page.frameLocator('iframe[title="HTML: focus.html"]').locator('input').evaluate(input=>{input.focus();input.scrollIntoView({block:'center',inline:'center'})})
  expect(await page.evaluate(()=>({x:document.querySelector('.app').scrollLeft,y:document.querySelector('.app').scrollTop}))).toEqual({x:0,y:0})
  for(const selector of ['.toolbar','.zoom-controls','.theme-switcher','.library-open-button','.anon-profile']){
    const box=await page.locator(selector).boundingBox(),viewport=page.viewportSize()
    expect(box.x,selector).toBeGreaterThanOrEqual(0);expect(box.y,selector).toBeGreaterThanOrEqual(0)
    expect(box.x+box.width,selector).toBeLessThanOrEqual(viewport.width);expect(box.y+box.height,selector).toBeLessThanOrEqual(viewport.height)
  }
  expect(await page.frameLocator('iframe[title="HTML: focus.html"]').locator('input').evaluate(()=>window.scrollY)).toBeGreaterThan(0)
  await page.getByRole('button',{name:'Borrador',exact:true}).click()
  await expect(page.locator('.app')).toHaveAttribute('data-tool','eraser')
})
})
