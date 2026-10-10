# SERVIDOR LOCAL para notebook. Esta ventana permanece abierta mientras funciona.
# Ejecución desde PowerShell: powershell -NoProfile -ExecutionPolicy Bypass -File .\iniciar_pizarra.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path '.\.venv\Scripts\python.exe')) { throw 'No encontré .venv\Scripts\python.exe' }
if (-not (Test-Path '.\package.json')) { throw 'No encontré package.json. Colocá estos archivos en la carpeta raíz.' }
if (-not (Test-Path '.\reconocimiento_local\server.py')) { throw 'No encontré reconocimiento_local\server.py' }
Write-Host '1/3 Adaptando las URLs de la web...' -ForegroundColor Cyan
& '.\.venv\Scripts\python.exe' '.\adaptar_hosting.py'
if ($LASTEXITCODE -ne 0) { throw 'Error al adaptar las URLs; no se inicia el servidor.' }
Write-Host '2/3 Compilando la versión web...' -ForegroundColor Cyan
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Error durante npm.cmd run build. Copiá el mensaje de error antes de continuar.' }
Write-Host '3/3 Iniciando en http://127.0.0.1:8765' -ForegroundColor Green
Write-Host 'Para apagar: Ctrl+C en esta ventana. Tus datos permanecerán guardados.'
& '.\.venv\Scripts\python.exe' -m uvicorn web_host:app --host 127.0.0.1 --port 8765
