# Builds dist\service\pdfdo-service.exe (PyInstaller, one-folder) and bundles Tesseract (exe + DLLs + eng/osd data).
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $here '.venv\Scripts\python.exe'
$tessSrc = 'C:\Program Files\Tesseract-OCR'
if (-not (Test-Path "$tessSrc\tesseract.exe")) { throw 'Tesseract not found. Install Tesseract 5 (UB-Mannheim build) first.' }
Push-Location $here
& $py -m PyInstaller --noconfirm --clean --name pdfdo-service --distpath dist --workpath build --specpath build `
  --paths $here --add-data "$here\app\static;app\static" `
  --hidden-import uvicorn.logging --hidden-import uvicorn.loops.auto --hidden-import uvicorn.protocols.http.auto `
  --hidden-import uvicorn.protocols.websockets.auto --hidden-import uvicorn.lifespan.on --hidden-import multipart `
  --exclude-module matplotlib --exclude-module jiwer --exclude-module pytest --exclude-module tkinter `
  service_main.py
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed' }
$out = Join-Path $here 'dist\pdfdo-service'
$t = Join-Path $out 'tesseract'
New-Item -ItemType Directory -Force -Path "$t\tessdata" | Out-Null
Copy-Item "$tessSrc\tesseract.exe" $t
Copy-Item "$tessSrc\*.dll" $t
Copy-Item "$tessSrc\tessdata\eng.traineddata", "$tessSrc\tessdata\osd.traineddata" "$t\tessdata"
if (Test-Path "$tessSrc\tessdata\configs") { Copy-Item "$tessSrc\tessdata\configs" "$t\tessdata\configs" -Recurse }
if (Test-Path "$tessSrc\tessdata\tessconfigs") { Copy-Item "$tessSrc\tessdata\tessconfigs" "$t\tessdata\tessconfigs" -Recurse }
Copy-Item "$tessSrc\doc\LICENSE*" $t -ErrorAction SilentlyContinue
Pop-Location
Write-Host ('Service built: {0:N0} MB' -f ((Get-ChildItem $out -Recurse | Measure-Object Length -Sum).Sum / 1MB))
