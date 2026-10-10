$ErrorActionPreference = 'Stop'
$pizarraConnectionFile = Join-Path $PSScriptRoot 'logs\conexion-actual.json'
if (-not (Test-Path -LiteralPath $pizarraConnectionFile)) { Write-Host 'No hay una conexión registrada.';exit }
$pizarraConnection = Get-Content -LiteralPath $pizarraConnectionFile -Raw | ConvertFrom-Json
foreach ($pizarraProcessId in @($pizarraConnection.ServidorPID,$pizarraConnection.TunelPID)) {
    $pizarraProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $pizarraProcessId" -ErrorAction SilentlyContinue
    if ($pizarraProcess -and ($pizarraProcess.CommandLine -match 'uvicorn web_host:app' -or $pizarraProcess.CommandLine -match 'cloudflared.*tunnel.*127.0.0.1:8765')) {
        foreach ($pizarraChild in @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $pizarraProcessId")) {
            if ($pizarraChild.CommandLine -match 'uvicorn web_host:app') { Stop-Process -Id $pizarraChild.ProcessId -ErrorAction SilentlyContinue }
        }
        Stop-Process -Id $pizarraProcessId -ErrorAction SilentlyContinue
    }
}
Write-Host 'Conexión de esta PC detenida. Las pizarras siguen guardadas.'
