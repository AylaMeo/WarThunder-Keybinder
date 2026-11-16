# Builds a standalone copy of the app: dist\WT-Keybinder\WT Keybinder.exe
# Uses the Electron runtime already in node_modules (no downloads): copies it, renames electron.exe, and puts the app in resources\app.
# Your current settings (config.json, ui.json, labels.json, mouse-layout.json) are copied in as STARTING settings only: on its first
# run the exe copies them to %APPDATA%\wt-keybinder and keeps its settings there from then on, so a rebuild never overwrites them.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist'
if (-not (Test-Path (Join-Path $electron 'electron.exe'))) { throw 'Electron is not installed. Run: npm install, then: node node_modules/electron/install.js (newer Electron versions download their binary separately)' }

# robocopy reports success with exit codes 0-7 (1 = files copied); 8 and up mean something was NOT copied.
function Copy-Tree($from, $to) {
  robocopy $from $to /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copy failed (robocopy exit code $LASTEXITCODE): $from -> $to" }
}

$out = Join-Path $root 'dist\WT-Keybinder'
$settings = 'config.json', 'ui.json', 'labels.json', 'mouse-layout.json'

# Older builds kept their settings inside the exe's own folder, which is about to be replaced. Carry them over to where the
# exe keeps them now (only files that are not there yet, so settings already in use are never overwritten).
$oldApp = Join-Path $out 'resources\app'
$userData = Join-Path $env:APPDATA 'wt-keybinder'
if (Test-Path $oldApp) {
  foreach ($f in $settings) {
    $src = Join-Path $oldApp $f
    $dst = Join-Path $userData $f
    if ((Test-Path $src) -and -not (Test-Path $dst)) {
      New-Item -ItemType Directory -Force $userData | Out-Null
      Copy-Item $src $dst
      Write-Host "Kept the previous exe's $f -> $dst"
    }
  }
}

if (Test-Path $out) {
  try { Remove-Item -Recurse -Force $out }
  catch { throw "Could not replace $out - is WT Keybinder still running? Quit it from the tray menu first. ($($_.Exception.Message))" }
}
New-Item -ItemType Directory -Force $out | Out-Null

# 1) the Electron runtime
Copy-Tree $electron $out
Rename-Item (Join-Path $out 'electron.exe') 'WT Keybinder.exe'
Remove-Item (Join-Path $out 'resources\default_app.asar') -ErrorAction SilentlyContinue

# 2) the app (no node_modules, no dist, no tests, no scratch files)
$app = Join-Path $out 'resources\app'
New-Item -ItemType Directory -Force $app | Out-Null
foreach ($f in @('main.cjs', 'preload.cjs', 'server.mjs', 'package.json', 'LICENSE') + $settings) {
  $p = Join-Path $root $f
  if (Test-Path $p) { Copy-Item $p $app }
}
foreach ($d in 'lib', 'public', 'data') { Copy-Tree (Join-Path $root $d) (Join-Path $app $d) }
New-Item -ItemType Directory -Force (Join-Path $app 'tools') | Out-Null
Copy-Item (Join-Path $root 'tools\input-helper.ps1') (Join-Path $app 'tools')

# 3) check the result before calling it built
foreach ($f in 'WT Keybinder.exe', 'resources\app\main.cjs', 'resources\app\server.mjs', 'resources\app\public\index.html', 'resources\app\data\catalog.json', 'resources\app\data\presets.json', 'resources\app\tools\input-helper.ps1') {
  if (-not (Test-Path (Join-Path $out $f))) { throw "Build is incomplete: $f is missing" }
}

$size = [math]::Round(((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB)
Write-Host "Built $out  ($size MB)"
Write-Host "Run: `"$out\WT Keybinder.exe`""
exit 0
