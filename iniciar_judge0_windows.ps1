$ErrorActionPreference='Stop'
$taskRoot=$PSScriptRoot
$taskLogs=Join-Path $taskRoot 'logs'
New-Item -ItemType Directory -Path $taskLogs -Force | Out-Null
$taskState=Join-Path $taskLogs 'judge0-proceso.json'
if(Test-Path -LiteralPath $taskState) {
  $previous=Get-Content -LiteralPath $taskState -Raw | ConvertFrom-Json
  $existing=Get-CimInstance Win32_Process -Filter "ProcessId = $($previous.ProcesoPID)" -ErrorAction SilentlyContinue
  if($existing -and $existing.Name -eq 'wsl.exe' -and $existing.CommandLine -match 'servidor_judge0/iniciar\.sh'){return}
}
$taskScript=Join-Path $taskRoot 'servidor_judge0/iniciar.sh'
$taskLinuxPath=& wsl -d Ubuntu-22.04 -u root --exec wslpath -a $taskScript.Replace('\','/')
if($LASTEXITCODE -ne 0 -or -not $taskLinuxPath){throw 'No se pudo iniciar Ubuntu para Judge0.'}
$taskStamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$taskProcess=Start-Process wsl.exe -WindowStyle Hidden -PassThru -ArgumentList @('-d','Ubuntu-22.04','-u','root','--exec','bash',('"'+$taskLinuxPath.Trim()+'"')) -RedirectStandardOutput (Join-Path $taskLogs "judge0-$taskStamp.stdout.log") -RedirectStandardError (Join-Path $taskLogs "judge0-$taskStamp.log")
@{ProcesoPID=$taskProcess.Id;Iniciado=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $taskState -Encoding UTF8
Write-Host 'Judge0 iniciado en segundo plano dentro de Ubuntu.'
