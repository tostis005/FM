# Ejecutar con PowerShell 5.1+ como administrador en el servidor Windows.
# El servicio utilizará LocalSystem de forma predeterminada. Ver README para cuentas SQL integradas.
param(
    [string]$Source = '',
    [string]$InstallDir = "$env:ProgramFiles\FarmetricaSync"
)
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Ejecuta PowerShell como administrador.' }
if (-not $Source) { $Source = Join-Path $PSScriptRoot '..\dist\win-x64' }
$Source = (Resolve-Path $Source).Path
$exe = Join-Path $Source 'FarmetricaSync.exe'
if (-not (Test-Path $exe)) { throw "Falta $exe. Primero ejecuta publicar-win-x64.ps1 en un equipo de compilación." }
$name='FarmetricaSync'
$existing = Get-Service -Name $name -ErrorAction SilentlyContinue
if ($existing) {
  if ($existing.Status -ne 'Stopped') { Stop-Service $name -Force; (Get-Service $name).WaitForStatus('Stopped', '00:00:30') }
}
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path (Join-Path $Source '*') -Destination $InstallDir -Recurse -Force
$dataDir = Join-Path $env:ProgramData 'FarmetricaSync'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
# Seguridad del almacén JSON y del anillo de claves DPAPI.
& icacls.exe $dataDir /inheritance:r /T | Out-Null
& icacls.exe $dataDir /grant '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /T | Out-Null
if (-not $existing) {
  $bin="`"$(Join-Path $InstallDir 'FarmetricaSync.exe')`""
  New-Service -Name $name -BinaryPathName $bin -DisplayName 'Farmétrica Sync' -StartupType Automatic | Out-Null
}
& sc.exe failure $name 'reset=' '86400' 'actions=' 'restart/60000/restart/60000/restart/60000' | Out-Null
Start-Service $name
Write-Host 'Farmétrica Sync instalado y arrancado.' -ForegroundColor Green
Write-Host 'Panel local: http://127.0.0.1:5080'
Write-Host 'NOTA: la autenticación integrada de SQL Server usará la identidad del servicio. Configurar una cuenta de dominio con privilegios mínimos si la infraestructura lo requiere.' -ForegroundColor Yellow
