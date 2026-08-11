param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [ValidateSet("Debug", "Release")]
  [string]$Configuration = "Release"
)
$ErrorActionPreference = "Stop"
$source = Join-Path $ProjectDir "tools\sas-dxgi-capture\Program.cpp"
$outDir = Join-Path $ProjectDir "tools\sas-dxgi-capture\bin\$Configuration"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) { throw "Falta Visual Studio Build Tools con C++ de escritorio para compilar SAS DXGI Capture." }
$installation = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw "No se encontró el componente C++ de escritorio de Visual Studio Build Tools." }
$devShell = Join-Path $installation "Common7\Tools\Microsoft.VisualStudio.DevShell.dll"
if (-not (Test-Path $devShell)) { throw "No se encontró Microsoft.VisualStudio.DevShell.dll." }
Import-Module $devShell
Enter-VsDevShell -VsInstallPath $installation -SkipAutomaticLocation -DevCmdArguments "-arch=x64 -host_arch=x64" | Out-Null
$exe = Join-Path $outDir "SasDxgiCapture.exe"
& cl.exe /nologo /utf-8 /std:c++17 /EHsc /O2 /DUNICODE /D_UNICODE $source /Fe:$exe /link d3d11.lib dxgi.lib windowscodecs.lib crypt32.lib ole32.lib oleaut32.lib user32.lib gdi32.lib
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exe)) { throw "Falló la compilación de SasDxgiCapture.exe." }
Get-FileHash -Algorithm SHA256 -Path $exe | Select-Object Algorithm, Hash, Path
