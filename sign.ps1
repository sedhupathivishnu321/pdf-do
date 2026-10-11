# Signs the PDF Do executables with a code-signing certificate and adds a trusted timestamp.
# Usage (certificate in the Windows store):   .\sign.ps1 -Thumbprint <SHA1 thumbprint>
#        (certificate in a .pfx file):         .\sign.ps1 -Pfx C:\path\cert.pfx -Password (Read-Host -AsSecureString)
# EV certificates on a hardware token work through the Thumbprint form (the token prompts for its PIN).
param([string]$Thumbprint, [string]$Pfx, [securestring]$Password,
      [string]$Timestamp = 'http://timestamp.digicert.com')
$ErrorActionPreference = 'Stop'
$signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter signtool.exe | Where-Object FullName -match '\\x64\\' | Select-Object -First 1 -ExpandProperty FullName
if (-not $signtool) { throw 'signtool.exe not found - install the Windows SDK (Signing Tools).' }
if (-not $Thumbprint -and -not $Pfx) { throw 'Pass -Thumbprint or -Pfx.' }
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$files = 'dist\PDFDo\PDFDo.exe', 'dist\PDFDo-Portable.exe', 'dist\PDFDoSetup.exe' | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ }
foreach ($f in $files) {
  $a = @('sign', '/fd', 'SHA256', '/tr', $Timestamp, '/td', 'SHA256', '/d', 'PDF Do')
  if ($Thumbprint) { $a += @('/sha1', $Thumbprint) }
  else { $a += @('/f', $Pfx); if ($Password) { $a += @('/p', [System.Net.NetworkCredential]::new('', $Password).Password) } }
  & $signtool @a $f
  if ($LASTEXITCODE -ne 0) { throw "Signing failed: $f" }
  & $signtool verify /pa /v $f | Select-String 'Successfully verified|Issued to'
}
Write-Host 'All files signed.' -ForegroundColor Green
