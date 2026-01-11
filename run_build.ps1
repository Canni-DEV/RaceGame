param(
  [int]$BackendPort = 4000,
  [int]$FrontendPort = 4173
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root 'race-backend'
$frontendDir = Join-Path $root 'online-car-race-3d'
$publicDir = Join-Path $backendDir 'public'
$certDir = Join-Path $root 'cert'
$certPath = Join-Path $certDir 'localhost+3.pem'
$keyPath = Join-Path $certDir 'localhost+3-key.pem'

$backendOut = "$env:TEMP\backend.out.log"
$backendErr = "$env:TEMP\backend.err.log"

# Resuelve npm
$npmCmd = $null
$npmCandidate = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCandidate) {
  $npmCmd = $npmCandidate.Source
} else {
  $npmCandidate = Get-Command npm -ErrorAction Stop
  $npmCmd = $npmCandidate.Source
}

$procs = @()

function Stop-ExistingBackend {
  param([int]$Port, [string]$BackendDir)

  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
  } catch { return }

  $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($pid in $pids) {
    $procInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue
    $cmd = $procInfo.CommandLine
    $isBackend = $cmd -and ($cmd -like "*$BackendDir*dist\\index.js*")
    if ($isBackend) {
      Write-Host "Cerrando backend previo en puerto $Port (PID $pid)..."
      Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    } else {
      throw "Puerto $Port ya está en uso por otro proceso (PID $pid). Ciérralo o ejecuta con -BackendPort <otro>."
    }
  }
}

function Cleanup {
  Write-Host "Saliendo, matando procesos..."
  foreach ($p in $procs) { if ($p -and !$p.HasExited) { $p.Kill() } }
}
Register-EngineEvent PowerShell.Exiting -Action { Cleanup } | Out-Null

Stop-ExistingBackend -Port $BackendPort -BackendDir $backendDir

Write-Host "Construyendo frontend..."
Push-Location $frontendDir
Remove-Item Env:VITE_SERVER_URL -ErrorAction SilentlyContinue
Remove-Item Env:VITE_BASE -ErrorAction SilentlyContinue
& $npmCmd run build
Pop-Location

Write-Host "Copiando build al backend (public)..."
if (Test-Path $publicDir) { Remove-Item $publicDir -Recurse -Force }
New-Item -ItemType Directory -Path $publicDir -Force | Out-Null
Copy-Item -Path (Join-Path $frontendDir 'dist\*') -Destination $publicDir -Recurse -Force

Write-Host "Construyendo backend..."
Push-Location $backendDir
& $npmCmd run build
Pop-Location

Write-Host "Arrancando backend desde dist..."
$backendProc = Start-Process node -ArgumentList 'dist/index.js' -WorkingDirectory $backendDir -NoNewWindow -PassThru `
  -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr
$procs += $backendProc
Start-Sleep -Seconds 1
$backendProtocol = if ((Test-Path $certPath) -and (Test-Path $keyPath)) { 'https' } else { 'http' }
$backendUrl = "${backendProtocol}://localhost:$BackendPort"
Write-Host "Backend escuchando en $backendUrl (logs: $backendOut / $backendErr)"

try {
  $healthUrl = "$backendUrl/health"
  $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5
  Write-Host "Health check OK: $($response.StatusCode) $healthUrl"
} catch {
  Write-Host "Health check falló en $backendUrl (revisa logs: $backendOut / $backendErr)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Listo:"
Write-Host " - Backend + frontend local (mismo origen): $backendUrl"
Write-Host "Ctrl+C cierra todo."
$runningIds = $procs | Where-Object { $_ -and -not $_.HasExited } | Select-Object -ExpandProperty Id -ErrorAction SilentlyContinue
if ($runningIds) { Wait-Process -Id $runningIds }
