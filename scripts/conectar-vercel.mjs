import { writeFileSync } from 'node:fs'

const destination = new URL(process.argv[2] || '')
const publicSite = new URL(process.argv[3] || 'https://pizarraproyecto.vercel.app')
if (destination.protocol !== 'https:' || destination.pathname !== '/' ||
    destination.username || destination.password || destination.search || destination.hash ||
    destination.hostname.endsWith('.vercel.app')) {
  throw new Error('Indicá la URL HTTPS raíz del servidor, por ejemplo https://tu-servicio.onrender.com')
}
if (publicSite.protocol !== 'https:' || publicSite.pathname !== '/' || publicSite.search || publicSite.hash || publicSite.username || publicSite.password) {
  throw new Error('La dirección pública de Vercel debe ser una URL HTTPS raíz.')
}
// Do not replace a working configuration with an expired tunnel or an HTML page.
try {
  const response=await fetch(`${destination.origin}/healthz`,{signal:AbortSignal.timeout(10000)})
  if(!response.ok||(await response.json()).ok!==true)throw new Error('Comprobación de salud incorrecta.')
}catch(error){
  throw new Error(`El servidor ${destination.origin} no está disponible. No se modificó la configuración. ${error.message}`)
}
// Vercel serves the frontend; only authenticated APIs go to the home computer.
writeFileSync(new URL('../vercel.json', import.meta.url), JSON.stringify({
  $schema: 'https://openapi.vercel.sh/vercel.json',
  framework: 'vite',
  rewrites: [
    {source:'/api/:path*',destination:`${destination.origin}/api/:path*`},
    {source:'/recognize/:path*',destination:`${destination.origin}/recognize/:path*`},
  ],
  headers:[{source:'/api/:path*',headers:[{key:'Cache-Control',value:'private, no-store'}]}],
}, null, 2) + '\n')
writeFileSync(new URL('../hosting.local.json', import.meta.url), JSON.stringify({
  publicOrigin:publicSite.origin,backendOrigin:destination.origin,
},null,2)+'\n')
console.log(`La página queda en ${publicSite.origin}; la API se conecta a ${destination.origin}. Reiniciá iniciar_pizarra.ps1 y subí vercel.json a GitHub.`)
