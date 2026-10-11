import {readFileSync} from 'node:fs'

const routing=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'))
const backend=new URL(routing.rewrites.find(rule=>rule.source==='/api/:path*').destination).origin
const reply=(status,detail)=>Response.json(detail,{status,headers:{'Cache-Control':'private, no-store'}})

// Only transfers the Vercel secret to a server explicitly paired from its
// local console. No endpoint can read the key back, even with the pairing code.
export default {async fetch(request) {
  if(request.method!=='POST')return reply(405,{detail:'Método no permitido.'})
  if(Number(request.headers.get('content-length')??0)>1024)return reply(413,{detail:'Solicitud demasiado grande.'})
  let ticket
  try {
    const raw=await request.text()
    if(new TextEncoder().encode(raw).length>1024)return reply(413,{detail:'Solicitud demasiado grande.'})
    ticket=JSON.parse(raw).ticket
  }catch{return reply(400,{detail:'Solicitud no válida.'})}
  if(typeof ticket!=='string'||!/^[a-f0-9]{64}$/.test(ticket))return reply(403,{detail:'Enlace privado no válido.'})
  const key=(process.env.ocrkey||process.env.DATALAB_API_KEY||'').trim()
  if(!key)return reply(503,{detail:'Falta ocrkey en las variables de producción de Vercel.'})
  try {
    const response=await fetch(`${backend}/api/ocr/setup-private`,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket,api_key:key}),
    })
    if(!response.ok)return reply(response.status===403?403:502,{detail:'No se pudo completar el enlace privado con el servidor.'})
    return reply(200,{configured:true})
  }catch{return reply(503,{detail:'El servidor de la PC no está disponible.'})}
}}
