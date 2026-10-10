# SOLO PARA PRUEBA CON TU CORREO. Deja acceso bloqueado al resto.
# Ejecutar con: powershell -NoProfile -ExecutionPolicy Bypass -File .\iniciar_tunel_privado.ps1
param([string]$Correo = '')
$ErrorActionPreference = 'Stop'
if (-not $Correo) { $Correo = Read-Host 'Ingresá TU correo (primera prueba individual)' }
if ($Correo -notmatch '^[^\s@,]+@[^\s@,]+\.[^\s@,]+$') { throw 'Ingresá un único correo válido. Nunca abras un túnel sin --allowed-mail.' }
$cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cmd) { throw 'cloudflared no está instalado. Ver LEEME_HOSTING.txt' }
Write-Host 'Verificando versión de cloudflared (se requiere 2026.9.3 o posterior)...'
$versionOutput = (& cloudflared --version) | Out-String
Write-Host $versionOutput
if ($versionOutput -match '(\d{4})\.(\d+)\.(\d+)') {
  $found = [version]("$($matches[1]).$($matches[2]).$($matches[3])")
  if ($found -lt [version]'2026.9.3') {
    throw 'Actualizá cloudflared a 2026.9.3 o superior para autenticar por correo; no publicar sin protección.'
  }
} else { throw 'No pude verificar la versión de cloudflared. No publicar sin protección.' }
Write-Host 'Creando enlace HTTPS temporal protegido por correo...' -ForegroundColor Green
Write-Host 'Copiá el enlace trycloudflare.com que aparezca en esta terminal.'
Write-Host 'Al apagar tu notebook o presionar Ctrl+C se corta el acceso.'
& cloudflared tunnel --url http://127.0.0.1:8765 --allowed-mail "$Correo"
