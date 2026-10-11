import {chromium} from '@playwright/test'
import {readFile,writeFile} from 'node:fs/promises'
const svg=await readFile(new URL('../public/icons/pizarra.svg',import.meta.url),'utf8')
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
  const page=await browser.newPage()
  for(const [name,size] of [['pizarra-192.png',192],['pizarra-512.png',512],['pizarra-maskable.png',512]]){
    const encoded=await page.evaluate(async({svg,size})=>{
      const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(svg);await img.decode()
      const canvas=document.createElement('canvas');canvas.width=canvas.height=size
      const ctx=canvas.getContext('2d');ctx.fillStyle='#4f46e5';ctx.fillRect(0,0,size,size);ctx.drawImage(img,0,0,size,size)
      return canvas.toDataURL('image/png').split(',')[1]
    },{svg,size})
    await writeFile(new URL('../public/icons/'+name,import.meta.url),Buffer.from(encoded,'base64'))
  }
}finally{await browser.close()}
