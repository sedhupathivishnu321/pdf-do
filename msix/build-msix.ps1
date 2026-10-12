# Builds the Microsoft Store package:  dist\PDFDo.msix  (unsigned - the Store signs it)
# Prerequisite: build.ps1 has produced dist\PDFDo (launcher + app + service). Windows SDK (makeappx) installed.
# Use the three values from Partner Center > Product management > Product identity:
#   .\msix\build-msix.ps1 -IdentityName "12345VINTECHNOLOGIES.PDFDo" -Publisher "CN=XXXXXXXX-XXXX-..." -PublisherDisplayName "VIN TECHNOLOGIES"
# -LocalTestSign signs the package with the local VIN TECHNOLOGIES certificate (for sideload testing only).
param(
  [string]$IdentityName = 'VINTECHNOLOGIES.PDFDo',
  [string]$Publisher = 'CN=VIN TECHNOLOGIES, O=VIN TECHNOLOGIES',
  [string]$PublisherDisplayName = 'VIN TECHNOLOGIES',
  [string]$Version = '1.1.0.0',
  [switch]$LooseOnly,
  [switch]$LocalTestSign
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot; $root = Split-Path -Parent $here
$src = Join-Path $root 'dist\PDFDo'
if (-not (Test-Path (Join-Path $src 'PDFDo.exe'))) { throw 'dist\PDFDo not found - run build.ps1 first.' }
$kit = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter makeappx.exe | Where-Object FullName -match '\\x64\\' | Sort-Object FullName | Select-Object -Last 1 -ExpandProperty FullName
if (-not $kit) { throw 'makeappx.exe not found - install the Windows SDK.' }

$layout = Join-Path $here 'layout'
if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
New-Item -ItemType Directory $layout | Out-Null
Copy-Item (Join-Path $src 'PDFDo.exe') $layout
Copy-Item (Join-Path $src 'app') (Join-Path $layout 'app') -Recurse
Copy-Item (Join-Path $src 'service') (Join-Path $layout 'service') -Recurse
Copy-Item (Join-Path $here 'Assets') (Join-Path $layout 'Assets') -Recurse
# MSIX forbids [ ] in file names. python-docx ships an unused unpacked template folder containing "[Content_Types].xml"
# (the library only reads templates\default.docx), so it is left out of the package.
Get-ChildItem $layout -Recurse -Directory -Filter 'default-docx-template' | Remove-Item -Recurse -Force
$bad = Get-ChildItem $layout -Recurse -Force | Where-Object { $_.Name -match '[<>:"|?*\[\]]' }
if ($bad) { throw ('File names not allowed in MSIX: ' + (($bad | Select-Object -First 5 -ExpandProperty FullName) -join '; ')) }

$m = Get-Content (Join-Path $here 'AppxManifest.template.xml') -Raw
$m = $m.Replace('@@IDENTITY_NAME@@', $IdentityName).Replace('@@PUBLISHER@@', $Publisher).Replace('@@PUBLISHER_DISPLAY_NAME@@', $PublisherDisplayName).Replace('@@VERSION@@', $Version)
[IO.File]::WriteAllText((Join-Path $layout 'AppxManifest.xml'), $m, (New-Object Text.UTF8Encoding($false)))
# index the scale / target-size qualified icons into resources.pri so the manifest can reference the plain names
$makepri = Join-Path (Split-Path $kit) 'makepri.exe'
$cfg = Join-Path $here 'priconfig.xml'
& $makepri createconfig /cf $cfg /dq en-US /pv 10.0.0 /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'makepri createconfig failed' }
& $makepri new /pr $layout /cf $cfg /mn (Join-Path $layout 'AppxManifest.xml') /of (Join-Path $layout 'resources.pri') /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'makepri new failed' }
Remove-Item $cfg -Force
Write-Host ('layout ready: {0:N0} MB' -f ((Get-ChildItem $layout -Recurse -File | Measure-Object Length -Sum).Sum / 1MB))
if ($LooseOnly) { return }

$out = Join-Path $root 'dist\PDFDo.msix'
if (Test-Path $out) { Remove-Item $out -Force }
& $kit pack /d $layout /p $out /o
if ($LASTEXITCODE -ne 0) { throw 'makeappx failed' }
if ($LocalTestSign) {
  $signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter signtool.exe | Where-Object FullName -match '\\x64\\' | Select-Object -Last 1 -ExpandProperty FullName
  $thumb = (Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object Subject -eq $Publisher | Select-Object -First 1).Thumbprint
  if (-not $thumb) { throw "No local certificate with subject '$Publisher'." }
  & $signtool sign /fd SHA256 /sha1 $thumb $out
}
Write-Host ('Built {0} ({1:N0} MB)' -f $out, ((Get-Item $out).Length / 1MB)) -ForegroundColor Green
