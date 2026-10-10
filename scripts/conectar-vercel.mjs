import { writeFileSync } from 'node:fs'

const destination = new URL(process.argv[2] || '')
if (destination.protocol !== 'https:' || destination.pathname !== '/' ||
    destination.username || destination.password || destination.search || destination.hash ||
    destination.hostname.endsWith('.vercel.app')) {
  throw new Error('Indicá la URL HTTPS raíz del servidor, por ejemplo https://tu-servicio.onrender.com')
}
// Serve login, API, assets and WebSockets from the same persistent server.
writeFileSync(new URL('../vercel.json', import.meta.url), JSON.stringify({
  $schema: 'https://openapi.vercel.sh/vercel.json',
  redirects: [{ source: '/:path*', destination: `${destination.origin}/:path*`, permanent: false }],
}, null, 2) + '\n')
console.log(`vercel.json preparado para ${destination.origin}. Subí el archivo a GitHub para activar la redirección.`)
