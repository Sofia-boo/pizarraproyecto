import * as pdfjs from 'pdfjs-dist'
import type {StudyDocument} from './config'
export type PreparedAttachment={name:string;image?:string;document?:StudyDocument}
export async function imageAttachment(blob:Blob){
  const url=URL.createObjectURL(blob)
  try{
    const image=new Image();image.src=url;await image.decode()
    const ratio=Math.min(1,768/Math.max(image.width,image.height))
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio))
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height)
    return canvas.toDataURL('image/jpeg',.9)
  }finally{URL.revokeObjectURL(url)}
}
export async function prepareAttachment(file:File):Promise<PreparedAttachment>{
  if(!file.size||file.size>30_000_000)throw new Error('Elegí un archivo de hasta 30 MB.')
  if(file.type.startsWith('image/'))return {name:file.name,image:await imageAttachment(file)}
  if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
    const loading=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())})
    try{
      const pdf=await loading.promise
      if(pdf.numPages>2000)throw new Error('Este PDF es demasiado extenso. Seleccioná las páginas que necesitás desde la pizarra.')
      const pages:StudyDocument['pages']=[];let preview=''
      const perPage=Math.max(100,Math.floor(200000/pdf.numPages))
      for(let number=1;number<=pdf.numPages;number++){
        const page=await pdf.getPage(number),content=await page.getTextContent()
        pages.push({pageNumber:number,text:content.items.map(item=>'str' in item?item.str+('hasEOL' in item&&item.hasEOL?'\n':' '):'').join('').slice(0,Math.min(16000,perPage))})
        if(number===1){
          const base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(1.5,768/Math.max(base.width,base.height))})
          const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height)
          await page.render({canvas,canvasContext:canvas.getContext('2d')!,viewport}).promise
          preview=canvas.toDataURL('image/jpeg',.9)
        }
        page.cleanup()
      }
      return {name:file.name,image:preview,document:{name:file.name,pages}}
    }finally{await loading.destroy()}
  }
  if(file.type.startsWith('text/')||/\.(txt|md|sql|cpp|c|h|py|js|ts|json|csv)$/i.test(file.name))return {name:file.name,document:{name:file.name,pages:[{pageNumber:1,text:(await file.text()).slice(0,200000)}]}}
  throw new Error('Elegí una imagen, PDF o archivo de texto o código.')
}
