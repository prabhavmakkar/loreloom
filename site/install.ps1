# Loreloom installer for Windows (preview).
#
#   irm https://getloreloom.vercel.app/install.ps1 | iex
#
# Everything installs inside your user folder; no administrator rights needed.
#   1. A private copy of Node.js in %USERPROFILE%\.loreloom\node, if you don't
#      already have Node 22+. Checked against nodejs.org's published checksums.
#   2. Loreloom itself in %USERPROFILE%\.loreloom\app.
#   3. A "Loreloom" shortcut in your Start menu.
#   4. Optionally, Claude Code (Anthropic's official installer) for the AI helper.
#
# Your books live in %USERPROFILE%\Loreloom. Re-running this updates Loreloom
# and never touches your books.
#
# Uninstall: delete %USERPROFILE%\.loreloom and the Start menu shortcut.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest much faster

$Repo      = 'prabhavmakkar/loreloom'
$Ref       = if ($env:LORELOOM_REF) { $env:LORELOOM_REF } else { 'main' }
$NodeMajor = 22
$Root      = Join-Path $env:USERPROFILE '.loreloom'
$AppDir    = Join-Path $Root 'app'
$NodeDir   = Join-Path $Root 'node'
$BinDir    = Join-Path $Root 'bin'

function Step($msg) { Write-Host "`n-> $msg" -ForegroundColor Cyan }
function Fail($msg) {
  Write-Host "`nSomething went wrong: $msg" -ForegroundColor Red
  Write-Host "Nothing in your books folder was changed. You can run the installer again,"
  Write-Host "or ask for help at https://github.com/$Repo/issues"
  throw $msg
}
function Ask($question) {
  $a = Read-Host "$question [Y/n]"
  return -not ($a -match '^[nN]')
}
function NodeOk($exe) {
  try { $v = & $exe -p 'process.versions.node.split(".")[0]' 2>$null; return [int]$v -ge $NodeMajor } catch { return $false }
}

Write-Host "`nLoreloom installer (Windows preview)" -ForegroundColor White
Write-Host "Free, open-source writing software. Your books stay on this computer." -ForegroundColor DarkGray

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
New-Item -ItemType Directory -Force -Path $Root, $BinDir | Out-Null
$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("loreloom-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

try {
  # ------------------------------------------------------------ Node.js
  $Node = $null
  $privateNode = Join-Path $NodeDir 'node.exe'
  if ((Test-Path $privateNode) -and (NodeOk $privateNode)) { $Node = $privateNode }
  else {
    $sys = Get-Command node -ErrorAction SilentlyContinue
    if ($sys -and (NodeOk $sys.Source)) { $Node = $sys.Source }
  }

  if (-not $Node) {
    Step "Downloading Node.js $NodeMajor (the engine Loreloom runs on)"
    $base = "https://nodejs.org/dist/latest-v$NodeMajor.x"
    $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content
    $line = ($sums -split "`n") | Where-Object { $_ -match "node-v[0-9.]+-win-$arch\.zip$" } | Select-Object -First 1
    if (-not $line) { Fail "couldn't find a Node.js download for win-$arch." }
    $expected, $file = ($line.Trim() -split '\s+')
    $zip = Join-Path $Tmp $file
    Invoke-WebRequest -UseBasicParsing "$base/$file" -OutFile $zip
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected.ToLower()) { Fail "the Node.js download didn't match its checksum, so it wasn't used." }
    Expand-Archive $zip -DestinationPath $Tmp -Force
    if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
    Move-Item (Join-Path $Tmp ($file -replace '\.zip$','')) $NodeDir
    $Node = $privateNode
    Write-Host "Node.js $(& $Node -v) installed privately in $NodeDir" -ForegroundColor DarkGray
  } else {
    Write-Host "Using Node.js $(& $Node -v) at $Node" -ForegroundColor DarkGray
  }
  $NodeBin = Split-Path $Node
  $env:Path = "$NodeBin;$env:Path"
  $Npm = Join-Path $NodeBin 'npm.cmd'

  # ------------------------------------------------------------ Loreloom
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$AppDir*cli.ts*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  Step "Downloading Loreloom"
  $srcZip = Join-Path $Tmp 'loreloom.zip'
  Invoke-WebRequest -UseBasicParsing "https://codeload.github.com/$Repo/zip/$Ref" -OutFile $srcZip
  Expand-Archive $srcZip -DestinationPath (Join-Path $Tmp 'src') -Force
  $src = Get-ChildItem (Join-Path $Tmp 'src') -Directory | Select-Object -First 1

  Step "Setting up Loreloom (this takes a minute or two)"
  Push-Location $src.FullName
  try {
    & $Npm ci --no-audit --no-fund --loglevel=error *> (Join-Path $Tmp 'npm.log')
    if ($LASTEXITCODE -ne 0) { Get-Content (Join-Path $Tmp 'npm.log') -Tail 20; Fail "installing Loreloom's parts failed." }
    & $Npm run build -w '@loreloom/web' *> (Join-Path $Tmp 'build.log')
    if ($LASTEXITCODE -ne 0) { Get-Content (Join-Path $Tmp 'build.log') -Tail 20; Fail "building Loreloom failed." }
  } finally { Pop-Location }
  if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force }
  Move-Item $src.FullName $AppDir

  # ------------------------------------------------------------ launcher
  $launcher = Join-Path $BinDir 'loreloom.ps1'
  @"
`$env:Path = "$NodeBin;`$env:USERPROFILE\.local\bin;`$env:Path"
foreach (`$port in 4317..4327) {
  try {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Headers @{ 'X-Loreloom' = '1' } "http://127.0.0.1:`$port/api/ai/status" | Out-Null
    Start-Process "http://127.0.0.1:`$port"; exit
  } catch {}
}
Start-Process -WindowStyle Hidden -WorkingDirectory "$AppDir" -FilePath "$Node" ``
  -ArgumentList '"$AppDir\node_modules\tsx\dist\cli.mjs"', '"$AppDir\packages\server\src\cli.ts"' ``
  -RedirectStandardOutput "$Root\loreloom.log" -RedirectStandardError "$Root\loreloom.err.log"
"@ | Set-Content -Path $launcher -Encoding UTF8

  Step "Adding Loreloom to your Start menu"
  $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut((Join-Path $startMenu 'Loreloom.lnk'))
  $lnk.TargetPath = (Get-Command powershell.exe).Source
  $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
  $lnk.WorkingDirectory = $AppDir
  $lnk.Description = 'Loreloom: write your novel'
  $lnk.Save()

  # ------------------------------------------------------------ Claude Code
  Step "AI helper"
  $claude = Get-Command claude -ErrorAction SilentlyContinue
  $claudePath = if ($claude) { $claude.Source } else { Join-Path $env:USERPROFILE '.local\bin\claude.exe' }
  if (-not (Test-Path $claudePath)) {
    Write-Host "Loreloom's AI helper (brainstorm, draft, review) runs on Claude Code, using"
    Write-Host "your own Claude Pro or Max plan. Loreloom works without it, too."
    if (Ask "Install Claude Code now with Anthropic's official installer?") {
      try { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression }
      catch { Write-Host "Claude Code didn't install. You can try later from https://code.claude.com" }
    } else {
      Write-Host "Skipped. You can add it any time: https://code.claude.com" -ForegroundColor DarkGray
    }
  }
  if (Test-Path $claudePath) {
    $status = & $claudePath auth status --json 2>$null | Out-String
    if ($status -match '"loggedIn":\s*true') {
      Write-Host "Claude Code is installed and signed in. The AI helper is ready." -ForegroundColor DarkGray
    } elseif (Ask "Sign in to Claude now? (a browser window will open)") {
      & $claudePath auth login
    } else {
      Write-Host "To use the AI helper later, open PowerShell and type: claude auth login" -ForegroundColor DarkGray
    }
  }

  Write-Host "`nLoreloom is installed." -ForegroundColor Green
  Write-Host "Open it any time from the Start menu (search for Loreloom)."
  Write-Host "Your books are saved in $env:USERPROFILE\Loreloom, on this computer only."
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher
}
finally {
  Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
