# PDF Do - build script. Produces dist\PDFDo\ (launcher + app) ready to run or install.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root 'dist\PDFDo'
$csc  = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path "$dist\app" -Force | Out-Null

Write-Host 'Compiling launcher...' -ForegroundColor Cyan
& $csc /nologo /target:winexe /optimize+ /win32icon:"$root\assets\logo.ico" /out:"$dist\PDFDo.exe" /reference:System.Windows.Forms.dll /reference:System.Management.dll "$root\launcher\PDFDoLauncher.cs"
if ($LASTEXITCODE -ne 0) { throw 'Launcher compile failed' }

Write-Host 'Copying application files...' -ForegroundColor Cyan
foreach ($d in 'css', 'js', 'lib', 'assets') { Copy-Item "$root\$d" "$dist\app\$d" -Recurse -Force }
Copy-Item "$root\index.html" "$dist\app\index.html" -Force

$svc = "$root\pdf2docx_service\dist\pdfdo-service"
if (-not (Test-Path "$svc\pdfdo-service.exe")) {
  Write-Host 'Building the conversion service (first time only, a few minutes)...' -ForegroundColor Cyan
  & powershell -NoProfile -ExecutionPolicy Bypass -File "$root\pdf2docx_service\build_service.ps1"
  if ($LASTEXITCODE -ne 0) { throw 'service build failed' }
}
Copy-Item $svc "$dist\service" -Recurse -Force

Copy-Item "$root\installer\Install PDF Do.cmd" $dist -Force
Copy-Item "$root\installer\Uninstall PDF Do.cmd" $dist -Force
Copy-Item "$root\installer\install.ps1" $dist -Force
Copy-Item "$root\installer\uninstall.ps1" $dist -Force
Copy-Item "$root\README.md" $dist -Force

$size = '{0:N1} MB' -f ((Get-ChildItem $dist -Recurse | Measure-Object Length -Sum).Sum / 1MB)
Write-Host "Done: $dist ($size)" -ForegroundColor Green
