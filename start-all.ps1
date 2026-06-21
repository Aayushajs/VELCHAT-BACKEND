# ============================================================
# VelChat — start all backend services + dev API gateway
# Run:  .\start-all.ps1        Stop: Ctrl+C  (or .\stop-all.ps1)
# Frontend base URL after start: http://localhost:8080
# ============================================================
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "VelChat — starting backend services + gateway..." -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path node_modules)) {
  Write-Host "node_modules missing — run 'pnpm install' first." -ForegroundColor Red
  exit 1
}

# Services run from compiled dist — build first (turbo caches, so this is fast on re-runs).
Write-Host "Building (pnpm build)..." -ForegroundColor Yellow
pnpm build | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "build failed" -ForegroundColor Red; exit 1 }

$services = Get-Content tools/gateway/services.json -Raw | ConvertFrom-Json
$jobs = @()

foreach ($s in $services) {
  Write-Host ("  starting {0} on :{1}" -f $s.name, $s.http) -ForegroundColor Green
  $jobs += Start-Job -Name $s.name -ScriptBlock {
    param($root, $name)
    Set-Location $root
    pnpm --filter "@velchat/$name" start
  } -ArgumentList $PWD.Path, $s.name
}

Write-Host "  starting gateway on :8080" -ForegroundColor Cyan
$jobs += Start-Job -Name 'gateway' -ScriptBlock {
  param($root)
  Set-Location $root
  pnpm gateway
} -ArgumentList $PWD.Path

# Wait for the gateway to come up.
for ($i = 0; $i -lt 40; $i++) {
  try {
    if ((Invoke-WebRequest 'http://localhost:8080/health' -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200) { break }
  } catch { Start-Sleep -Milliseconds 750 }
}

Write-Host ""
Write-Host "Health:" -ForegroundColor Cyan
function Test-Svc([int]$port, [string]$name) {
  try {
    if ((Invoke-WebRequest "http://localhost:$port/health" -TimeoutSec 3 -UseBasicParsing).StatusCode -eq 200) {
      Write-Host ("  OK   {0} (:{1})" -f $name, $port) -ForegroundColor Green
    }
  } catch { Write-Host ("  DOWN {0} (:{1})" -f $name, $port) -ForegroundColor Red }
}
foreach ($s in $services) { Test-Svc $s.http $s.name }

Write-Host ""
Write-Host "================= UNIFIED API =================" -ForegroundColor Cyan
Write-Host "  http://localhost:8080    <- frontend base URL" -ForegroundColor Yellow
Write-Host "  /auth /users /chat /channels /media /search ... routed to services" -ForegroundColor Gray
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop all. Keep this window open." -ForegroundColor Gray
Write-Host ""

# Cleanup that actually kills the service processes. Start-Job spawns pnpm→node grandchildren that
# orphan on Ctrl+C, so the reliable kill is BY LISTENING PORT (every service + the gateway), plus
# the jobs and a command-line sweep as a backstop.
$ports = @($services | ForEach-Object { $_.http }) + 8080
function Stop-All {
  Write-Host "`nStopping all services..." -ForegroundColor Yellow
  $jobs | Stop-Job -ErrorAction SilentlyContinue
  $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
  foreach ($p in $ports) {
    try {
      Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    } catch { }
  }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'dist\\main\.js|dev-gateway\.mjs' } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch { } }
  Write-Host "Stopped." -ForegroundColor Green
}

# Ctrl+C → run cleanup then exit (trap fires even if `finally` is skipped).
trap {
  Stop-All
  break
}

try {
  while ($true) {
    Start-Sleep -Seconds 5
    foreach ($j in $jobs) { if ($j.State -eq 'Failed') { Write-Host ("job {0} failed" -f $j.Name) -ForegroundColor Yellow } }
  }
} finally {
  Stop-All
}
