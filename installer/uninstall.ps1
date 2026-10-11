# PDF Do - uninstaller
$dest = Join-Path $env:LOCALAPPDATA 'Programs\PDFDo'
Get-Process -Name PDFDo -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$links = @((Join-Path ([Environment]::GetFolderPath('Programs')) 'PDF Do.lnk'), (Join-Path ([Environment]::GetFolderPath('Desktop')) 'PDF Do.lnk'))
foreach ($lnk in $links) { Remove-Item $lnk -ErrorAction SilentlyContinue }
Remove-Item 'HKCU:\Software\Classes\Applications\PDFDo.exe' -Recurse -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Classes\.pdf\OpenWithList\PDFDo.exe' -Recurse -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PDFDo' -Recurse -ErrorAction SilentlyContinue
$answer = Read-Host 'Also delete saved preferences, recent files and fonts? (y/N)'
if ($answer -eq 'y') { Remove-Item (Join-Path $env:LOCALAPPDATA 'PDFDo') -Recurse -Force -ErrorAction SilentlyContinue }
# remove the program folder last (this script lives inside it)
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile -Command Start-Sleep 2; Remove-Item -LiteralPath '$dest' -Recurse -Force"
Write-Host 'PDF Do was uninstalled.' -ForegroundColor Green
