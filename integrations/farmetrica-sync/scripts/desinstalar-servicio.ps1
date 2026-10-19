param([switch]$EliminarDatos)
$ErrorActionPreference='Stop'
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Ejecuta PowerShell como administrador.' }
$s = Get-Service 'FarmetricaSync' -ErrorAction SilentlyContinue
if ($s) {
  if ($s.Status -ne 'Stopped') { Stop-Service 'FarmetricaSync' -Force; (Get-Service 'FarmetricaSync').WaitForStatus('Stopped','00:00:30') }
  & sc.exe delete 'FarmetricaSync' | Out-Null
}
if (Test-Path "$env:ProgramFiles\FarmetricaSync") { Remove-Item "$env:ProgramFiles\FarmetricaSync" -Recurse -Force }
if ($EliminarDatos -and (Test-Path "$env:ProgramData\FarmetricaSync")) { Remove-Item "$env:ProgramData\FarmetricaSync" -Recurse -Force }
Write-Host 'Servicio eliminado. Los datos de configuración se conservan salvo que se use -EliminarDatos.'
