# Copies the offline web app into mobile\www (the folder the Android app bundles).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$www = Join-Path $PSScriptRoot 'www'
if (Test-Path $www) { Remove-Item $www -Recurse -Force }
New-Item -ItemType Directory $www | Out-Null
Copy-Item (Join-Path $root 'index.html') $www
foreach ($d in 'css', 'js', 'lib', 'assets') { Copy-Item (Join-Path $root $d) (Join-Path $www $d) -Recurse }
Write-Host ('web assets copied: {0:N1} MB' -f ((Get-ChildItem $www -Recurse -File | Measure-Object Length -Sum).Sum / 1MB))
