# Builds a standalone copy of the app: dist\WT-Keybinder\WT Keybinder.exe
# Uses the Electron runtime already in node_modules (no downloads): copies it, renames electron.exe, and puts the app in resources\app.
# Your current settings (config.json, labels.json, mouse-layout.json) are copied in as the starting settings.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist'
if (-not (Test-Path (Join-Path $electron 'electron.exe'))) { throw 'Electron is not installed. Run: npm install' }

$out = Join-Path $root 'dist\WT-Keybinder'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force $out | Out-Null

# 1) the Electron runtime
robocopy $electron $out /E /NFL /NDL /NJH /NJS /NP | Out-Null
Rename-Item (Join-Path $out 'electron.exe') 'WT Keybinder.exe'
Remove-Item (Join-Path $out 'resources\default_app.asar') -ErrorAction SilentlyContinue

# 2) the app (no node_modules, no dist, no scratch files)
$app = Join-Path $out 'resources\app'
New-Item -ItemType Directory -Force $app | Out-Null
foreach ($f in 'main.cjs', 'preload.cjs', 'server.mjs', 'package.json', 'config.json', 'labels.json', 'mouse-layout.json', 'ui.json') {
  $p = Join-Path $root $f
  if (Test-Path $p) { Copy-Item $p $app }
}
foreach ($d in 'lib', 'public', 'data') { robocopy (Join-Path $root $d) (Join-Path $app $d) /E /NFL /NDL /NJH /NJS /NP | Out-Null }
New-Item -ItemType Directory -Force (Join-Path $app 'tools') | Out-Null
Copy-Item (Join-Path $root 'tools\input-helper.ps1') (Join-Path $app 'tools')

$size = [math]::Round(((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB)
Write-Host "Built $out  ($size MB)"
Write-Host "Run: `"$out\WT Keybinder.exe`""
