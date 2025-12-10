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
function Resolve-LanHost {
  param([string]$Preferred)

  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -ne '127.0.0.1' -and
      $_.IPAddress -notlike '169.254.*' -and
      $_.PrefixOrigin -ne 'WellKnown'
    } |
    Select-Object -ExpandProperty IPAddress -Unique

  if ($Preferred -and $ips -contains $Preferred) {
    return $Preferred
  }

  $fallback = $ips | Select-Object -First 1
  if ($Preferred -and $fallback -and $fallback -ne $Preferred) {
    Write-Host "LanHost $Preferred no está asignada en esta máquina; usando $fallback" -ForegroundColor Yellow
  }
  if ($fallback) {
    return $fallback
  }
  return $Preferred
}

function Cleanup {
  Write-Host "Saliendo, matando procesos..."
  foreach ($p in $procs) { if ($p -and !$p.HasExited) { $p.Kill() } }
}
Register-EngineEvent PowerShell.Exiting -Action { Cleanup } | Out-Null

$effectiveLanHost = Resolve-LanHost -Preferred $LanHost
if (-not $effectiveLanHost) {
  throw "No se pudo determinar una IP LAN válida. Pasa -LanHost o revisa tus interfaces de red."
}

$procs = @()

Write-Host "Levantando backend en modo dev (hot reload)..."
$backendProc = Start-Process $npmCmd -ArgumentList @('run','dev') -WorkingDirectory $backendDir -NoNewWindow -PassThru `
  -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr
$procs += $backendProc
Write-Host "Backend dev en https://$($effectiveLanHost):$($BackendPort) (escucha todas las interfaces; logs: $backendOut / $backendErr)"

Write-Host "Levantando frontend en modo dev (hot reload) apuntando al backend LAN..."
$env:VITE_SERVER_URL = "https://$($effectiveLanHost):$($BackendPort)"
$frontendProc = Start-Process $npmCmd -ArgumentList @('run','dev','--','--host','0.0.0.0','--port',"$FrontendPort") `
  -WorkingDirectory $frontendDir -NoNewWindow -PassThru `
  -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr
$procs += $frontendProc
Write-Host "Frontend dev en https://$($effectiveLanHost):$($FrontendPort) (logs: $frontendOut / $frontendErr)"

Write-Host ""
Write-Host "Listo para desarrollo local:"
Write-Host " - Backend dev:  https://$($effectiveLanHost):$($BackendPort)"
Write-Host " - Frontend dev: https://$($effectiveLanHost):$($FrontendPort)"
Write-Host "Ctrl+C cierra ambos procesos."
Wait-Process -Id ($procs | Select-Object -ExpandProperty Id)
