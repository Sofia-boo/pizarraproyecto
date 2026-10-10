# Tunel HTTPS temporal de Cloudflare SIN verificacion por correo.
# ATENCION: cualquier persona con la URL podra acceder a la pizarra compartida.
# Ejecutar desde la raiz del proyecto con la pizarra ya iniciada.
$ErrorActionPreference = 'Stop'

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    throw 'No se encontro cloudflared. Abrí otra terminal o revisa su instalacion.'
}

try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8765/api/library' -TimeoutSec 8 -UseBasicParsing
    if ($r.StatusCode -ne 200) { throw ('HTTP ' + $r.StatusCode) }
} catch {
    throw 'No se pudo consultar la biblioteca local. Primero inicia la pizarra y verifica http://127.0.0.1:8765/api/library'
}

Write-Host ''
Write-Host 'ATENCION: ENLACE PUBLICO SIN AUTENTICACION' -ForegroundColor Yellow
Write-Host 'Cualquier persona con el enlace puede abrir y modificar las pizarras compartidas.' -ForegroundColor Yellow
Write-Host 'No difundas la URL. Para apagar el acceso, presiona Ctrl+C.' -ForegroundColor Yellow
Write-Host ''
Write-Host 'Creando enlace HTTPS temporal...' -ForegroundColor Green
Write-Host 'Copia la URL que termine en trycloudflare.com desde la terminal.'
Write-Host ''
& cloudflared tunnel --url 'http://127.0.0.1:8765'
