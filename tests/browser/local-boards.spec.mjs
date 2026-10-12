import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('private board saves without a backend, survives refresh and exports a backup',async({page})=>{
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'Server off'}))
  await page.goto('/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect(page.locator('canvas').first()).toBeVisible()
  const canvas=page.locator('canvas').first()
  const bounds=await canvas.boundingBox()
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2)
  await page.mouse.down()
  await page.mouse.move(bounds.x+bounds.width/2+120,bounds.y+bounds.height/2+80,{steps:12})
  await page.mouse.up()
  await expect.poll(()=>page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
    return new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').getAll();r.onsuccess=()=>{const count=r.result.filter(b=>b.id.startsWith('local:')).reduce((n,b)=>n+b.content.strokes.length,0);db.close();resolve(count)}})
  })).toBeGreaterThan(0)
  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.getByRole('button',{name:/Mi pizarra privada/}).first().click()
  const downloaded=page.waitForEvent('download')
  await page.getByRole('button',{name:'Descargar respaldo',exact:true}).click()
  const file=await downloaded
  const backup=JSON.parse(await readFile(await file.path(),'utf8'))
  expect(backup.format).toBe('pizarra-backup-v1')
  expect(backup.content.strokes.length).toBeGreaterThan(0)
  await Promise.all([
    page.waitForEvent('load'),
    page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({name:'respaldo.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))}),
  ])
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.screenshot({path:'test-results/privada-local.png'})
  await page.setViewportSize({width:375,height:812})
  await page.getByRole('button',{name:'Opciones del lápiz'}).click()
  const pen=await page.getByRole('group',{name:'Configuración del lápiz'}).boundingBox()
  expect(pen.x).toBeGreaterThanOrEqual(0)
  expect(pen.x+pen.width).toBeLessThanOrEqual(375)
  expect(pen.width).toBeGreaterThan(pen.height*2)
  await page.screenshot({path:'test-results/lapiz-movil.png'})
})

test('shared board and image remain on this device after the server goes offline',async({page})=>{
  let offline=false
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII=','base64')
  await page.route('**/api/**',async route=>{
    if(offline)return route.abort('failed')
    const path=new URL(route.request().url()).pathname
    const respond=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)})
    if(path==='/api/auth/me')return respond({id:'browser-user',display_name:'Prueba',emoji:'🙂',color:'#6366f1',is_admin:0})
    if(path==='/api/library')return respond({folders:[],boards:[{id:'shared-browser',name:'Compartida de prueba',folder_id:null,version:2,updated_at:'2026-10-10',role:'editor'}]})
    if(path==='/api/boards/shared-browser')return respond({id:'shared-browser',name:'Compartida de prueba',version:2,content:{
      strokes:[],texts:[],camera:{x:0,y:0,zoom:1},media:[{id:'m',assetId:'image-test',x:10,y:10,width:100,height:100,name:'Prueba',kind:'image'}]}})
    if(path==='/api/assets/image-test')return route.fulfill({status:200,contentType:'image/png',body:image})
    return route.fulfill({status:404,contentType:'application/json',body:'{"detail":"No disponible"}'})
  })
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect.poll(()=>page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    return new Promise(resolve=>{const r=db.transaction('assets').objectStore('assets').get('browser-user:image-test');r.onsuccess=()=>{db.close();resolve(Boolean(r.result))}})
  })).toBe(true)
  offline=true
  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(page.getByRole('button',{name:'Abrir perfil de Prueba'})).toBeVisible()
  await page.screenshot({path:'test-results/compartida-copia-local.png'})
})
