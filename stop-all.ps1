# Stop all VelChat dev services + gateway started by start-all.ps1 / pnpm start:all.
# Kills by listening port (reliable for orphaned pnpm→node children) + by command line.
Write-Host "Stopping VelChat services + gateway..." -ForegroundColor Yellow

Get-Job -ErrorAction SilentlyContinue | Stop-Job -ErrorAction SilentlyContinue
Get-Job -ErrorAction SilentlyContinue | Remove-Job -Force -ErrorAction SilentlyContinue

# Service HTTP ports 3000-3012 + dev gateway 8080.
$ports = (3000..3012) + 8080
foreach ($p in $ports) {
  try {
    Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
  } catch { }
}

Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'dist\\main\.js|dev-gateway\.mjs|start-all\.mjs' } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch { } }

Write-Host "Stopped." -ForegroundColor Green
