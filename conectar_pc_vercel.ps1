# Inicia el servidor de esta PC y un enlace temporal, sin reemplazar datos.
param([string]$Pagina = 'https://pizarraproyecto.vercel.app')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue) {
    throw 'El puerto 8765 está ocupado. Cerrá el servidor anterior antes de conectar esta versión.'
}
$pizarraPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pizarraPython)) { throw 'Falta .venv\Scripts\python.exe' }
$pizarraCloudflared = (Get-Command cloudflared -ErrorAction Stop).Source
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar la página.' }
$pizarraLogs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Path $pizarraLogs -Force | Out-Null
$pizarraStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$pizarraTunnelLog = Join-Path $pizarraLogs "tunel-$pizarraStamp.log"
$pizarraTunnel = Start-Process -FilePath $pizarraCloudflared -ArgumentList @('tunnel','--url','http://127.0.0.1:8765','--no-autoupdate') -WindowStyle Hidden -PassThru -RedirectStandardError $pizarraTunnelLog -RedirectStandardOutput (Join-Path $pizarraLogs "tunel-$pizarraStamp.stdout.log")
try {
    $pizarraUrl = $null
    for ($pizarraAttempt=0; $pizarraAttempt -lt 225; $pizarraAttempt++) {
        if (Test-Path -LiteralPath $pizarraTunnelLog) {
            $pizarraText = Get-Content -LiteralPath $pizarraTunnelLog -Raw
            if ($pizarraText -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $pizarraUrl=$Matches[0];break }
        }
        if ($pizarraTunnel.HasExited) { throw 'El túnel se cerró. Revisá logs/.' }
        Start-Sleep -Milliseconds 200
    }
    if (-not $pizarraUrl) { throw 'No se obtuvo el enlace del túnel. Revisá logs/.' }
    & node scripts/conectar-vercel.mjs $pizarraUrl $Pagina
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo configurar Vercel.' }
    $env:PIZARRA_PUBLIC_ORIGINS = $Pagina.TrimEnd('/')
    $env:PIZARRA_WS_ORIGIN = $pizarraUrl
    $pizarraServer = Start-Process -FilePath $pizarraPython -ArgumentList @('-m','uvicorn','web_host:app','--host','127.0.0.1','--port','8765','--workers','1','--proxy-headers') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $pizarraLogs "servidor-$pizarraStamp.log") -RedirectStandardOutput (Join-Path $pizarraLogs "servidor-$pizarraStamp.stdout.log")
    $pizarraReady = $false
    for ($pizarraAttempt=0; $pizarraAttempt -lt 50; $pizarraAttempt++) {
        if ($pizarraServer.HasExited) { throw 'El servidor se cerró. Revisá su log en logs/.' }
        try {
            $pizarraHealth = Invoke-WebRequest -Uri 'http://127.0.0.1:8765/healthz' -TimeoutSec 1 -UseBasicParsing
            if ($pizarraHealth.StatusCode -eq 200) { $pizarraReady=$true;break }
        } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $pizarraReady) { throw 'El servidor no respondió a la comprobación de inicio. Revisá logs/.' }
    [pscustomobject]@{ServidorPID=$pizarraServer.Id;TunelPID=$pizarraTunnel.Id;URL=$pizarraUrl;Pagina=$Pagina} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $pizarraLogs 'conexion-actual.json')
    Write-Host "Página en Vercel: $Pagina"
    Write-Host "Conexión temporal de tu PC: $pizarraUrl"
    Write-Host 'Subí vercel.json a GitHub para que Vercel use esta conexión.'
    Write-Host 'Los procesos siguen activos en segundo plano. Para detenerlos: .\detener_pc_vercel.ps1'
    Write-Host 'Al reiniciar el túnel cambia la URL: ejecutá este script y volvé a subir vercel.json.'
} catch {
    if ($pizarraServer -and -not $pizarraServer.HasExited) {
        foreach ($pizarraChild in @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($pizarraServer.Id)")) {
            if ($pizarraChild.CommandLine -match 'uvicorn web_host:app') { Stop-Process -Id $pizarraChild.ProcessId -ErrorAction SilentlyContinue }
        }
        Stop-Process -Id $pizarraServer.Id -ErrorAction SilentlyContinue
    }
    if (-not $pizarraTunnel.HasExited) { Stop-Process -Id $pizarraTunnel.Id }
    throw
}
