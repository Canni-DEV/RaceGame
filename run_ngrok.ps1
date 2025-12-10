param(
  [int]$BackendPort = 4000,
  [int]$FrontendPort = 4173,
  [string]$TunnelName = '',      # opcional: nombre del túnel configurado en el dashboard
  [string]$PublicHostname = ''   # opcional: hostname público (p. ej. api.midominio.com)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root 'race-backend'
$frontendDir = Join-Path $root 'online-car-race-3d'
$publicDir = Join-Path $backendDir 'public'

$backendOut = "$env:TEMP\backend.out.log"
$backendErr = "$env:TEMP\backend.err.log"

# Resuelve cloudflared
$cloudflaredCmd = $null
$candidate = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
if ($candidate) { $cloudflaredCmd = $candidate.Source }
else {
  $candidate = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($candidate) { $cloudflaredCmd = $candidate.Source }
}
if (-not $cloudflaredCmd) { throw "cloudflared no encontrado. Añádelo al PATH." }

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

function Stop-ExistingCloudflared {
  $running = Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $cloudflaredCmd }
  if ($running) {
    Write-Host "Cerrando instancias previas de cloudflared..."
    $running | Stop-Process -Force
  }
}

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

function Start-Tunnel {
  param([string]$Target, [string]$Name, [string]$TunnelName, [string]$PublicHostname)
  $logOut = Join-Path $env:TEMP "cloudflared-$Name.out.log"
  $logErr = Join-Path $env:TEMP "cloudflared-$Name.err.log"
  if (Test-Path $logOut) { Remove-Item $logOut -Force }
  if (Test-Path $logErr) { Remove-Item $logErr -Force }

  if ($TunnelName) {
    $args = @('tunnel', 'run', $TunnelName, '--no-autoupdate')
  } else {
    $args = @('tunnel', '--url', $Target, '--metrics', 'localhost:0', '--no-autoupdate', '--no-tls-verify')
  }

  $p = Start-Process $cloudflaredCmd -ArgumentList $args -RedirectStandardOutput $logOut -RedirectStandardError $logErr -NoNewWindow -PassThru
  $procs += $p

  $url = $null
  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 250
    $logs = @()
    if (Test-Path $logOut) { $logs += $logOut }
    if (Test-Path $logErr) { $logs += $logErr }
    if (-not $logs) { continue }

    foreach ($line in Get-Content $logs -Tail 200) {
      if (-not $TunnelName -and $line -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com') { $url = $Matches[0] }
      if ($TunnelName -and $PublicHostname -and $line -match 'Registered tunnel connection') { $url = "https://$PublicHostname" }
    }
    if ($url) { break }
  }

  if (-not $url -and $TunnelName -and $PublicHostname) { $url = "https://$PublicHostname" }
  if (-not $url) { throw "No pude obtener URL de Cloudflare Tunnel para $Name (ver logs $logOut / $logErr)" }
  return $url
}

Stop-ExistingCloudflared
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
Write-Host "Backend escuchando en https://localhost:$BackendPort (logs: $backendOut / $backendErr)"

Write-Host "Creando túnel Cloudflare..."
$backendUrl = Start-Tunnel "https://localhost:$BackendPort" "backend" $TunnelName $PublicHostname
Write-Host "Túnel backend: $backendUrl"

Write-Host ""
Write-Host "Listo:"
Write-Host " - Backend + frontend público (mismo origen): $backendUrl"
Write-Host "Ctrl+C cierra todo."
$runningIds = $procs | Where-Object { $_ -and -not $_.HasExited } | Select-Object -ExpandProperty Id -ErrorAction SilentlyContinue
if ($runningIds) { Wait-Process -Id $runningIds }
