$ErrorActionPreference='Stop'
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$toolsPath=Join-Path $workspace '.android-build'
$jdkPath=Join-Path $toolsPath 'jdk'
$sdkPath=Join-Path $toolsPath 'sdk'
$gradlePath=Join-Path $toolsPath 'gradle-8.11.1/bin/gradle.bat'
if(!(Test-Path -LiteralPath (Join-Path $jdkPath 'bin/javac.exe')) -or !(Test-Path -LiteralPath $gradlePath) -or !(Test-Path -LiteralPath (Join-Path $sdkPath 'platforms/android-36/android.jar'))){throw 'Preparar JDK 17, Gradle 8.11.1 y Android SDK 36 en .android-build antes de compilar.'}
$env:JAVA_HOME=$jdkPath
$env:ANDROID_HOME=$sdkPath
$env:GRADLE_USER_HOME=Join-Path $toolsPath 'gradle-cache'
('sdk.dir='+$sdkPath.Replace('\','/')) | Set-Content -LiteralPath (Join-Path $workspace 'android/local.properties') -Encoding ascii
$signing=Join-Path $toolsPath 'signing.properties'
$keyStore=Join-Path $toolsPath 'pizarra-release.jks'
if(!(Test-Path -LiteralPath $signing)){
    if(Test-Path -LiteralPath $keyStore){throw 'Existe la clave de firma pero faltan sus propiedades privadas. No reemplazarla.'}
    $bytes=New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $password=([System.BitConverter]::ToString($bytes)).Replace('-','')
    @("storePassword=$password","keyPassword=$password") | Set-Content -LiteralPath $signing -Encoding ascii
}
$properties=Get-Content -LiteralPath $signing | ConvertFrom-StringData
$env:PIZARRA_ANDROID_SIGN_PASSWORD=$properties.storePassword
if(!(Test-Path -LiteralPath $keyStore)){
    & (Join-Path $jdkPath 'bin/keytool.exe') -genkeypair -keystore $keyStore -alias pizarra -keyalg RSA -keysize 3072 -validity 10000 -storepass:env PIZARRA_ANDROID_SIGN_PASSWORD -keypass:env PIZARRA_ANDROID_SIGN_PASSWORD -dname 'CN=Pizarra Proyecto, O=Pizarra, C=AR'
    if($LASTEXITCODE -ne 0){throw 'No se pudo crear la firma Android.'}
}
$drawable=Join-Path $workspace 'android/app/src/main/res/drawable'
New-Item -ItemType Directory -Force -Path $drawable | Out-Null
Copy-Item -LiteralPath (Join-Path $workspace 'public/icons/pizarra-192.png') -Destination (Join-Path $drawable 'ic_launcher.png')
Push-Location (Join-Path $workspace 'android')
try{
    & $gradlePath --console=plain wrapper --gradle-version 8.11.1 assembleRelease lintRelease testReleaseUnitTest
    if($LASTEXITCODE -ne 0){throw 'La compilacion o la revision Android fallo.'}
}finally{Pop-Location}
$cert=Join-Path $toolsPath 'signing-certificate.der'
& (Join-Path $jdkPath 'bin/keytool.exe') -exportcert -alias pizarra -keystore $keyStore -storepass:env PIZARRA_ANDROID_SIGN_PASSWORD -file $cert
if($LASTEXITCODE -ne 0){throw 'No se pudo exportar el certificado publico.'}
$fingerprint=((Get-FileHash -LiteralPath $cert -Algorithm SHA256).Hash -replace '(..)(?!$)','$1:')
$links=@(@{relation=@('delegate_permission/common.handle_all_urls','delegate_permission/common.use_as_origin');target=@{namespace='android_app';package_name='com.sofic.pizarra';sha256_cert_fingerprints=@($fingerprint)}})
$wellKnown=Join-Path $workspace 'public/.well-known'
New-Item -ItemType Directory -Force -Path $wellKnown | Out-Null
ConvertTo-Json -InputObject $links -Depth 6 | Set-Content -LiteralPath (Join-Path $wellKnown 'assetlinks.json') -Encoding utf8
$downloads=Join-Path $workspace 'public/downloads'
New-Item -ItemType Directory -Force -Path $downloads | Out-Null
$apk=Join-Path $downloads 'pizarra-chatgpt.apk'
Copy-Item -LiteralPath (Join-Path $workspace 'android/app/build/outputs/apk/release/app-release.apk') -Destination $apk
& (Join-Path $sdkPath 'build-tools/35.0.0/apksigner.bat') verify --print-certs $apk
if($LASTEXITCODE -ne 0){throw 'La firma APK no es valida.'}
Remove-Item Env:PIZARRA_ANDROID_SIGN_PASSWORD
Write-Output 'APK firmado y assetlinks.json generados. Conservar .android-build/pizarra-release.jks y signing.properties fuera de Git.'
