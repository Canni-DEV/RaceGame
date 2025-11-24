param(
  [int]$BackendPort = 4000,
  [int]$FrontendPort = 4173
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root 'race-backend'
$frontendDir = Join-Path $root 'online-car-race-3d'

$ngrokPath = 'C:\Portables\ngrok\ngrok.exe'  # ruta fija a ngrok
$backendOut = "$env:TEMP\backend.out.log"
$backendErr = "$env:TEMP\backend.err.log"
$npmCmd = $null
$npmCandidate = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCandidate) {
  $npmCmd = $npmCandidate.Source
} else {
  $npmCandidate = Get-Command npm -ErrorAction Stop
  $npmCmd = $npmCandidate.Source
}
$publicDir = Join-Path $backendDir 'public'

$procs = @()

# Detiene ngrok previos para evitar ERR_NGROK_334 por túneles existentes.
function Stop-ExistingNgrok {
  $running = Get-Process -Name ngrok -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $ngrokPath }
  if ($running) {
    Write-Host "Cerrando instancias previas de ngrok..."
    $running | Stop-Process -Force
  }
}

function Cleanup {
  Write-Host "Saliendo, matando procesos..."
  foreach ($p in $procs) { if ($p -and !$p.HasExited) { $p.Kill() } }
}
Register-EngineEvent PowerShell.Exiting -Action { Cleanup } | Out-Null

function Start-Tunnel {
  param([string]$Target, [string]$Name)
  $log = Join-Path $env:TEMP "ngrok-$Name.log"
  if (Test-Path $log) { Remove-Item $log -Force }
  $p = Start-Process $ngrokPath -ArgumentList @('http', $Target, '--log=stdout', '--log-format=json') `
    -RedirectStandardOutput $log -NoNewWindow -PassThru
  $procs += $p
  $url = $null
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    if (-not (Test-Path $log)) { continue }
    Get-Content $log | ForEach-Object {
      try {
        $json = $_ | ConvertFrom-Json
        if ($json.msg -eq 'started tunnel' -and $json.url -like 'https://*') {
          $url = $json.url
        }
      } catch {}
    }
    if ($url) { break }
  }
  if (-not $url) { throw "No pude obtener URL de ngrok para $Name" }
  return $url
}

Stop-ExistingNgrok

Write-Host "Construyendo frontend..."
Push-Location $frontendDir
Remove-Item Env:VITE_SERVER_URL -ErrorAction SilentlyContinue
Remove-Item Env:VITE_BASE -ErrorAction SilentlyContinue
& $npmCmd run build
Pop-Location

Write-Host "Copiando build al backend (public)..."
if (Test-Path $publicDir) {
  Remove-Item $publicDir -Recurse -Force
}
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

Write-Host "Creando túnel ngrok backend..."
$backendUrl = Start-Tunnel "https://localhost:$BackendPort" "backend"
Write-Host "Túnel backend: $backendUrl"

Write-Host ""
Write-Host "Listo:"
Write-Host " - Backend + frontend público (mismo origen): $backendUrl"
Write-Host "Ctrl+C cierra todo."
Wait-Process -Id ($procs | Select-Object -ExpandProperty Id)
