$ErrorActionPreference='Stop'
$workspace=$PSScriptRoot
$dataDirectory=Join-Path $workspace 'datos'
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
$privateKey=Read-Host 'Pegá tu API key de Datalab (no se muestra ni se sube a GitHub)' -AsSecureString
$credential=New-Object System.Net.NetworkCredential('', $privateKey)
if ([string]::IsNullOrWhiteSpace($credential.Password)) { throw 'La clave está vacía.' }
$configurationPath=Join-Path $dataDirectory 'datalab.json'
@{api_key=$credential.Password} | ConvertTo-Json | Set-Content -LiteralPath $configurationPath -Encoding utf8
$credential=$null
$privateKey=$null
Write-Output 'Datalab configurado en datos/datalab.json. No hace falta reiniciar el servidor.'
