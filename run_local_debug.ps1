param(
  [int]$BackendPort = 4000,
  [int]$FrontendPort = 5173,
  [string]$LanHost = '192.168.0.214',  # ajusta si quieres otra IP LAN
  [bool]$DebugModelStructure = $true   # activa el trazado del modelo en consola del navegador
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root 'race-backend'
$frontendDir = Join-Path $root 'online-car-race-3d'

$backendOut = "$env:TEMP\backend.debug.out.log"
$backendErr = "$env:TEMP\backend.debug.err.log"
$frontendOut = "$env:TEMP\frontend.debug.out.log"
$frontendErr = "$env:TEMP\frontend.debug.err.log"

$script:procs = @()
$script:cleaned = $false

$npmCmd = $null
$npmCandidate = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCandidate) {
  $npmCmd = $npmCandidate.Source
} else {
  $npmCandidate = Get-Command npm -ErrorAction Stop
  $npmCmd = $npmCandidate.Source
}

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
  if ($script:cleaned) { return }
  $script:cleaned = $true

  Write-Host "Saliendo, matando procesos..."
  foreach ($p in $script:procs) {
    if ($p -and !$p.HasExited) {
      try {
        $p.Kill()
        $null = $p.WaitForExit(5000)
      } catch {
        Write-Verbose "No se pudo terminar el proceso $($p.Id): $_"
      }
    }
  }
}
Register-EngineEvent PowerShell.Exiting -Action { Cleanup } | Out-Null

$effectiveLanHost = Resolve-LanHost -Preferred $LanHost
if (-not $effectiveLanHost) {
  throw "No se pudo determinar una IP LAN válida. Pasa -LanHost o revisa tus interfaces de red."
}

$script:procs = @()

Write-Host "Levantando backend en modo debug (hot reload)..."
$backendProc = Start-Process $npmCmd -ArgumentList @('run','dev') -WorkingDirectory $backendDir -NoNewWindow -PassThru `
  -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr
$script:procs += $backendProc
Write-Host "Backend dev en https://$($effectiveLanHost):$($BackendPort) (escucha todas las interfaces; logs: $backendOut / $backendErr)"

Write-Host "Levantando frontend en modo debug (hot reload) apuntando al backend LAN..."
$env:VITE_SERVER_URL = "https://$($effectiveLanHost):$($BackendPort)"
if ($DebugModelStructure) {
  $env:VITE_DEBUG_CAR_MODEL_STRUCTURE = 'true'
} else {
  $env:VITE_DEBUG_CAR_MODEL_STRUCTURE = 'false'
}
$frontendProc = Start-Process $npmCmd -ArgumentList @('run','dev','--','--host','0.0.0.0','--port',"$FrontendPort") `
  -WorkingDirectory $frontendDir -NoNewWindow -PassThru `
  -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr
$script:procs += $frontendProc
Write-Host "Frontend dev en https://$($effectiveLanHost):$($FrontendPort) (logs: $frontendOut / $frontendErr)"
if ($DebugModelStructure) {
  Write-Host "Modo debug del modelo activo (VITE_DEBUG_CAR_MODEL_STRUCTURE=true); revisa la consola del navegador para ver los materiales." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Listo para depuración local:"
Write-Host " - Backend dev:  https://$($effectiveLanHost):$($BackendPort)"
Write-Host " - Frontend dev: https://$($effectiveLanHost):$($FrontendPort)"
Write-Host "Ctrl+C cierra ambos procesos."
try {
  Wait-Process -Id ($script:procs | Select-Object -ExpandProperty Id)
} catch [System.Management.Automation.PipelineStoppedException] {
  Write-Host "Interrumpido manualmente (Ctrl+C)." -ForegroundColor Yellow
} finally {
  Cleanup
  Unregister-Event -SourceIdentifier PowerShell.Exiting -ErrorAction SilentlyContinue
}
