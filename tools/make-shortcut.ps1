# make-shortcut.ps1 -- puts a desktop shortcut for the builder.
#
# The shortcut points straight at electron.exe from node_modules, so there is
# no console window and no launcher script in between. Re-run it after moving
# the project folder.
#
# ASCII only: powershell.exe reads a BOM-less .ps1 as ANSI.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tools\make-shortcut.ps1
#   powershell -ExecutionPolicy Bypass -File tools\make-shortcut.ps1 -Remove

param(
  [string]$Name = 'Sborshchik interfeysa Aion',
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$exe  = Join-Path $root 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $root 'icon.ico'
$link = Join-Path ([Environment]::GetFolderPath('Desktop')) ($Name + '.lnk')

if ($Remove) {
  if (Test-Path $link) { Remove-Item $link -Force; Write-Output ('removed ' + $link) }
  else { Write-Output 'nothing to remove' }
  exit 0
}

if (-not (Test-Path $exe)) {
  Write-Output ('electron not found: ' + $exe)
  Write-Output 'run "npm install" in the project folder first'
  exit 1
}

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($link)
$sc.TargetPath = $exe
$sc.Arguments = '"' + $root + '"'
$sc.WorkingDirectory = $root
$sc.Description = 'Sborshchik interfeysa Aion Classic'
if (Test-Path $icon) { $sc.IconLocation = $icon }
$sc.Save()

Write-Output ('shortcut: ' + $link)
Write-Output ('target:   ' + $exe)
