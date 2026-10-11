# PDF Do - per-user installer (no admin rights needed).
$ErrorActionPreference = 'Stop'
$src  = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA 'Programs\PDFDo'

Write-Host ''
Write-Host '  Installing PDF Do...' -ForegroundColor Cyan

Get-Process -Name PDFDo -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item "$src\PDFDo.exe" $dest -Force
Copy-Item "$src\app" "$dest\app" -Recurse -Force
Copy-Item "$src\uninstall.ps1" $dest -Force
Copy-Item "$src\Uninstall PDF Do.cmd" $dest -Force

$exe  = Join-Path $dest 'PDFDo.exe'
$icon = Join-Path $dest 'app\assets\logo.ico'

# shortcuts (Start menu + Desktop)
$shell = New-Object -ComObject WScript.Shell
$links = @((Join-Path ([Environment]::GetFolderPath('Programs')) 'PDF Do.lnk'), (Join-Path ([Environment]::GetFolderPath('Desktop')) 'PDF Do.lnk'))
foreach ($lnk in $links) {
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = $exe
  $s.WorkingDirectory = $dest
  $s.IconLocation = "$icon,0"
  $s.Description = 'PDF Do - private PDF studio'
  $s.Save()
}

# "Open with" support for .pdf files
$app = 'HKCU:\Software\Classes\Applications\PDFDo.exe'
New-Item -Path "$app\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $app -Name 'FriendlyAppName' -Value 'PDF Do'
Set-ItemProperty -Path "$app\shell\open\command" -Name '(default)' -Value ('"{0}" "%1"' -f $exe)
New-Item -Path "$app\SupportedTypes" -Force | Out-Null
Set-ItemProperty -Path "$app\SupportedTypes" -Name '.pdf' -Value ''
New-Item -Path "$app\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path "$app\DefaultIcon" -Name '(default)' -Value $icon
New-Item -Path 'HKCU:\Software\Classes\.pdf\OpenWithList\PDFDo.exe' -Force | Out-Null

# Apps & features entry
$u = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PDFDo'
New-Item -Path $u -Force | Out-Null
Set-ItemProperty $u DisplayName 'PDF Do'
Set-ItemProperty $u DisplayVersion '1.0.0'
Set-ItemProperty $u Publisher 'PDF Do'
Set-ItemProperty $u DisplayIcon $icon
Set-ItemProperty $u InstallLocation $dest
Set-ItemProperty $u UninstallString ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $dest 'uninstall.ps1'))
Set-ItemProperty $u NoModify 1
Set-ItemProperty $u NoRepair 1

Write-Host "  Installed to $dest" -ForegroundColor Green
Write-Host '  A "PDF Do" shortcut was added to your Desktop and Start menu.' -ForegroundColor Green
Write-Host '  Tip: right-click any PDF > Open with > PDF Do.'
Start-Process $exe
