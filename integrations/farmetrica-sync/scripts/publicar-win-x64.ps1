# Ejecutar en el PC de compilación, no en el servidor del cliente.
# Requisitos de compilación: .NET 10 SDK y acceso a NuGet durante el primer restore.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$project = Join-Path $root 'src\FarmetricaSync\FarmetricaSync.csproj'
$out = Join-Path $root 'dist\win-x64'
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { throw 'Instala .NET 10 SDK en el PC de compilación.' }
New-Item -ItemType Directory -Force -Path $out | Out-Null
& dotnet publish $project -r win-x64 -c Release --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:PublishTrimmed=false -o $out
if ($LASTEXITCODE -ne 0) { throw 'Falló dotnet publish.' }
Write-Host "Publicación creada: $out" -ForegroundColor Green
Write-Host 'Copiar toda la carpeta dist\win-x64 al servidor. El servidor NO necesita .NET instalado.'
