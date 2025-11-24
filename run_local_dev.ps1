param(
  [int]$BackendPort = 4000,
  [int]$FrontendPort = 5173,
  [string]$LanHost = '192.168.0.214'  # ajusta si quieres otra IP LAN
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root 'race-backend'
$frontendDir = Join-Path $root 'online-car-race-3d'

$backendOut = "$env:TEMP\backend.dev.out.log"
$backendErr = "$env:TEMP\backend.dev.err.log"
$frontendOut = "$env:TEMP\frontend.dev.out.log"
$frontendErr = "$env:TEMP\frontend.dev.err.log"

$npmCmd = $null
$npmCandidate = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCandidate) {
  $npmCmd = $npmCandidate.Source
} else {
  $npmCandidate = Get-Command npm -ErrorAction Stop
  $npmCmd = $npmCandidate.Source
}

$procs = @()
function Cleanup {
  Write-Host "Saliendo, matando procesos..."
  foreach ($p in $procs) { if ($p -and !$p.HasExited) { $p.Kill() } }
}
Register-EngineEvent PowerShell.Exiting -Action { Cleanup } | Out-Null

Write-Host "Levantando backend en modo dev (hot reload)..."
$backendProc = Start-Process $npmCmd -ArgumentList @('run','dev') -WorkingDirectory $backendDir -NoNewWindow -PassThru `
  -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr
$procs += $backendProc
Write-Host "Backend dev en https://$($LanHost):$($BackendPort) (escucha todas las interfaces; logs: $backendOut / $backendErr)"

Write-Host "Levantando frontend en modo dev (hot reload) apuntando al backend LAN..."
$env:VITE_SERVER_URL = "https://$($LanHost):$($BackendPort)"
$frontendProc = Start-Process $npmCmd -ArgumentList @('run','dev','--','--host',"$LanHost",'--port',"$FrontendPort") `
  -WorkingDirectory $frontendDir -NoNewWindow -PassThru `
  -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr
$procs += $frontendProc
Write-Host "Frontend dev en https://$($LanHost):$($FrontendPort) (logs: $frontendOut / $frontendErr)"

Write-Host ""
Write-Host "Listo para desarrollo local:"
Write-Host " - Backend dev:  https://$($LanHost):$($BackendPort)"
Write-Host " - Frontend dev: https://$($LanHost):$($FrontendPort)"
Write-Host "Ctrl+C cierra ambos procesos."
Wait-Process -Id ($procs | Select-Object -ExpandProperty Id)
