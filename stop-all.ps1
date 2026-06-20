# Stop all VelChat dev services + gateway started by start-all.ps1 / pnpm start:all.
Write-Host "Stopping VelChat services + gateway..." -ForegroundColor Yellow
Get-Job -ErrorAction SilentlyContinue | Stop-Job -ErrorAction SilentlyContinue
Get-Job -ErrorAction SilentlyContinue | Remove-Job -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'dist\\main\.js|dev-gateway\.mjs|start-all\.mjs' } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
Write-Host "Stopped." -ForegroundColor Green
