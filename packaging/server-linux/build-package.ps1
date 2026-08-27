$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$stageRoot = Join-Path $root ".tmp\aidr-server-linux"
$stage = Join-Path $stageRoot "aidr-server-linux"
$output = Join-Path $root "output\aidr-server-linux.tar.gz"
if (Test-Path $stageRoot) { Remove-Item -Recurse -Force $stageRoot }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item -LiteralPath "$PSScriptRoot\aidr-server.service","$PSScriptRoot\install.sh","$PSScriptRoot\uninstall.sh","$PSScriptRoot\README.md" -Destination $stage
$installReadme = Get-ChildItem -LiteralPath "$root\docs" -File | Where-Object { $_.Name -like "AIDR-Linux-TAR*README.md" } | Select-Object -First 1
if (-not $installReadme) { throw "Unified Linux TAR README was not found." }
Copy-Item -LiteralPath $installReadme.FullName -Destination "$stage\INSTALL-README.md"
New-Item -ItemType Directory -Force -Path "$stage\server" | Out-Null
Copy-Item -Recurse -Force "$root\aidr-server\src","$root\aidr-server\public","$root\aidr-server\tools","$root\aidr-server\package.json","$root\aidr-server\package-lock.json" -Destination "$stage\server"
New-Item -ItemType Directory -Force -Path "$stage\aidr-endpoint\ui" | Out-Null
Copy-Item -Force "$root\aidr-endpoint\ui\index.html","$root\aidr-endpoint\ui\runtime-adapter.js","$root\aidr-endpoint\ui\abgc.js" -Destination "$stage\aidr-endpoint\ui"
New-Item -ItemType Directory -Force -Path (Split-Path $output) | Out-Null
$tarExe = "$env:SystemRoot\System32\tar.exe"
if (-not (Test-Path $tarExe)) { $tarExe = "tar" }
& $tarExe -czf $output -C $stageRoot "aidr-server-linux"
if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
Write-Output $output
