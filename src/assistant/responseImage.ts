import {toBlob} from 'html-to-image'
export async function responseImage(element:HTMLElement):Promise<File>{
  await document.fonts.ready
  const {width,height}=element.getBoundingClientRect()
  if(!width||!height)throw new Error('Pegá una respuesta antes de insertarla.')
  if(height>12000)throw new Error('La respuesta es muy larga. Insertala en varias partes para conservar la legibilidad.')
  const blob=await toBlob(element,{backgroundColor:'#ffffff',pixelRatio:Math.min(2,Math.sqrt(4_000_000/(width*height))),preferredFontFormat:'woff2'})
  if(!blob)throw new Error('No se pudo preparar la respuesta con formato. Probá insertar como texto.')
  return new File([blob],'respuesta-chatgpt.png',{type:'image/png'})
}
