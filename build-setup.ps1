# Builds the single-file installer dist\PDFDoSetup.exe from dist\PDFDo (run build.ps1 first).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root 'dist\PDFDo'
if (-not (Test-Path "$dist\PDFDo.exe")) { throw 'Run build.ps1 first.' }
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$work = Join-Path $root 'dist\_setup'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Path $work | Out-Null

# the installed copy needs an uninstaller; it is the setup exe itself, copied in as "Uninstall PDF Do.exe"
Write-Host 'Compiling setup stub...' -ForegroundColor Cyan
& $csc /nologo /target:winexe /optimize+ /win32icon:"$root\assets\logo.ico" /out:"$work\stub.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:Microsoft.CSharp.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "$root\installer\PDFDoSetup.cs"
if ($LASTEXITCODE -ne 0) { throw 'Setup compile failed' }

Write-Host 'Packing payload (this takes a minute)...' -ForegroundColor Cyan
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stage = Join-Path $work 'payload'
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($i in 'PDFDo.exe', 'app', 'service') { Copy-Item "$dist\$i" $stage -Recurse -Force }
Copy-Item "$work\stub.exe" "$stage\Uninstall PDF Do.exe"
$zip = Join-Path $work 'payload.zip'
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

$out = Join-Path $root 'dist\PDFDoSetup.exe'
$fs = [System.IO.File]::Create($out)
foreach ($f in "$work\stub.exe", $zip) { $in = [System.IO.File]::OpenRead($f); $in.CopyTo($fs); $in.Close() }
$len = (Get-Item $zip).Length
$tail = [System.BitConverter]::GetBytes([int64]$len) + [System.Text.Encoding]::ASCII.GetBytes('PDFDOPAY')
$fs.Write($tail, 0, 16); $fs.Close()
# portable single-file edition: same stub + payload, behaves as a self-extracting launcher when its file name contains 'Portable'
$port = Join-Path $root 'dist\PDFDo-Portable.exe'
Copy-Item $out $port -Force
Remove-Item $work -Recurse -Force
Write-Host ('Created portable {0} ({1:N0} MB)' -f $port, ((Get-Item $port).Length / 1MB)) -ForegroundColor Green
Write-Host ('Created {0} ({1:N0} MB)' -f $out, ((Get-Item $out).Length / 1MB)) -ForegroundColor Green
