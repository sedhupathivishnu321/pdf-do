# Builds the signed Android APK:  mobile\dist\PDFDo.apk
# Needs: JDK 21, Android SDK (ANDROID_HOME, build-tools 35), Node. The signing keystore is NOT in this repository;
# pass -Keystore / -KeystorePassword (a first-time keystore is created with -CreateKeystore).
param(
  [string]$Keystore = "$env:USERPROFILE\Downloads\PDFDo-Android-Keystore\pdfdo-release.jks",
  [string]$KeystorePassword = $env:PDFDO_KS_PASS,
  [string]$Alias = 'pdfdo',
  [switch]$CreateKeystore
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$jdk = Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-21*' | Select-Object -First 1 -ExpandProperty FullName
if (-not $jdk) { throw 'JDK 21 not found.' }
$env:JAVA_HOME = $jdk
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
$env:ANDROID_HOME = $sdk
$bt = Get-ChildItem "$sdk\build-tools" -Directory | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName

if ($CreateKeystore -and -not (Test-Path $Keystore)) {
  if (-not $KeystorePassword) { throw 'Pass -KeystorePassword for the new keystore.' }
  New-Item -ItemType Directory -Force (Split-Path $Keystore) | Out-Null
  & "$jdk\bin\keytool.exe" -genkeypair -v -keystore $Keystore -alias $Alias -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $KeystorePassword -keypass $KeystorePassword -dname 'CN=VIN TECHNOLOGIES, O=VIN TECHNOLOGIES, C=IN'
}
if (-not (Test-Path $Keystore)) { throw "Keystore not found: $Keystore (use -CreateKeystore)" }
if (-not $KeystorePassword) { throw 'Pass -KeystorePassword (or set PDFDO_KS_PASS).' }

Push-Location $here
try {
  & powershell -ExecutionPolicy Bypass -File "$here\sync-web.ps1"
  if (-not (Test-Path "$here\node_modules")) { npm install --no-audit --no-fund }
  npx cap sync android
  Push-Location "$here\android"
  & .\gradlew.bat assembleRelease --no-daemon
  if ($LASTEXITCODE -ne 0) { throw 'Gradle build failed' }
  Pop-Location
  $unsigned = Get-ChildItem "$here\android\app\build\outputs\apk\release" -Filter '*.apk' | Select-Object -First 1 -ExpandProperty FullName
  New-Item -ItemType Directory -Force "$here\dist" | Out-Null
  $aligned = "$here\dist\aligned.apk"; $out = "$here\dist\PDFDo.apk"
  & "$bt\zipalign.exe" -f -p 4 $unsigned $aligned
  & "$bt\apksigner.bat" sign --ks $Keystore --ks-key-alias $Alias --ks-pass "pass:$KeystorePassword" --key-pass "pass:$KeystorePassword" --out $out $aligned
  Remove-Item $aligned -Force
  & "$bt\apksigner.bat" verify --print-certs $out | Select-Object -First 3
  Write-Host ('Built {0} ({1:N1} MB)' -f $out, ((Get-Item $out).Length / 1MB)) -ForegroundColor Green
} finally { Pop-Location -ErrorAction SilentlyContinue }
