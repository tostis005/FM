# Comprobación NO invasiva desde el servidor Windows.
$ErrorActionPreference='Stop'
$s = Get-Service -Name 'FarmetricaSync' -ErrorAction SilentlyContinue
if (-not $s) { Write-Warning 'No se encuentra FarmetricaSync como servicio de Windows.'; exit 1 }
Write-Host "Servicio: $($s.Status)"
if ($s.Status -ne 'Running') { exit 2 }
try {
  $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5080/api/bootstrap-status' -TimeoutSec 8
  if ($r.StatusCode -eq 200) { Write-Host 'Panel local: accesible' }
} catch { Write-Warning "Panel local inaccesible: $_"; exit 3 }
Write-Host "Configuración local: $env:ProgramData\FarmetricaSync"
