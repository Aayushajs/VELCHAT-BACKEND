# ============================================================
# VelChat — start all backend services + dev API gateway on ONE port.
# Run:   .\start-all.ps1            (add -Stream to stream every service's logs)
# Stop:  Ctrl+C  (kills everything reliably)   ·   or in another window: .\stop-all.ps1
# Frontend base URL after start:  http://localhost:8080
# ============================================================
param([switch]$Stream)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path node_modules)) {
  Write-Host "node_modules missing - run 'pnpm install' first." -ForegroundColor Red
  exit 1
}

# Services run from compiled dist - build first (turbo caches, so re-runs are fast).
Write-Host "Building (pnpm build)..." -ForegroundColor Yellow
pnpm build | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "build failed" -ForegroundColor Red; exit 1 }

# Delegate to the cross-platform node aggregator: it spawns each service as a direct child, so a
# single Ctrl+C stops them all reliably (SIGTERM then SIGKILL) - no orphaned pnpm/node grandchildren.
$nodeArgs = @('tools/gateway/start-all.mjs')
if ($Stream) { $nodeArgs += '--verbose' }
node @nodeArgs
