$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $MyInvocation.MyCommand.Path
$taskLogs=Join-Path $taskRoot 'logs'
New-Item -ItemType Directory -Path $taskLogs -Force | Out-Null
$statusPath=Join-Path $taskLogs 'instalacion-judge0.json'
function Save-Status([string]$state,[string]$detail) {
  @{Estado=$state;Detalle=$detail;Actualizado=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8
}
$taskIdentity=[Security.Principal.WindowsIdentity]::GetCurrent()
if(-not ([Security.Principal.WindowsPrincipal]$taskIdentity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Ejecutar este archivo como administrador para instalar WSL.'
}
try {
  Save-Status 'Instalando' 'Preparando WSL 2. No se reinicia Windows automaticamente.'
  $restartNeeded=$false
  foreach($feature in @('VirtualMachinePlatform','Microsoft-Windows-Subsystem-Linux')) {
    $state=Get-WindowsOptionalFeature -Online -FeatureName $feature
    if($state.State -ne 'Enabled') {
      $result=Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart
      if($result.RestartNeeded){$restartNeeded=$true}
    }
  }
  & winget install --id Microsoft.WSL --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity *> (Join-Path $taskLogs 'instalar-wsl.log')
  if($LASTEXITCODE -notin @(0,-1978335189)) { throw "No se pudo instalar WSL; revisar logs/instalar-wsl.log (codigo $LASTEXITCODE)." }
  if($restartNeeded) {
    Save-Status 'Requiere reinicio' 'WSL instalado. Reiniciar Windows y ejecutar de nuevo instalar_judge0_windows.ps1 como administrador para continuar con Ubuntu y Judge0.'
    exit 3010
  }
  & wsl --install -d Ubuntu-22.04 --no-launch *> (Join-Path $taskLogs 'instalar-ubuntu.log')
  if($LASTEXITCODE -ne 0){throw 'No se pudo preparar Ubuntu. Revisar logs/instalar-ubuntu.log; puede requerir reiniciar Windows.'}
  $prepareScript=Join-Path $taskRoot 'servidor_judge0/preparar_wsl.py'
  $preparePath=(& wsl -d Ubuntu-22.04 -u root -- wslpath -a $prepareScript).Trim()
  $changed=(& wsl -d Ubuntu-22.04 -u root -- python3 $preparePath).Trim()
  if($LASTEXITCODE -ne 0){throw 'No se pudo configurar cgroup v1 en Ubuntu.'}
  if($changed -eq 'changed') {
    & wsl --terminate Ubuntu-22.04 | Out-Null
    Start-Sleep -Seconds 3
  }
  $linuxScript=Join-Path $taskRoot 'servidor_judge0/instalar.sh'
  $linuxPath=(& wsl -d Ubuntu-22.04 -u root -- wslpath -a $linuxScript).Trim()
  & wsl -d Ubuntu-22.04 -u root -- bash $linuxPath *> (Join-Path $taskLogs 'instalar-judge0.log')
  if($LASTEXITCODE -ne 0){throw 'Judge0 no paso la instalacion/prueba de aislamiento. Revisar logs/instalar-judge0.log.'}
  $taskData=Join-Path $taskRoot 'datos'
  New-Item -ItemType Directory -Path $taskData -Force | Out-Null
  @{url='http://127.0.0.1:2358'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskData 'judge0.json') -Encoding ASCII
  Save-Status 'Listo' 'Judge0 local activo en 127.0.0.1:2358. La pizarra ya puede compilar C++.'
} catch {
  Save-Status 'Pendiente' $_.Exception.Message
  throw
}
