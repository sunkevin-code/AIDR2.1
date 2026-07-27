$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$stageRoot = Join-Path $root ".tmp\aidr-server-linux"
$stage = Join-Path $stageRoot "aidr-server-linux"
$output = Join-Path $root "output\aidr-server-linux.tar.gz"
if (Test-Path $stageRoot) { Remove-Item -Recurse -Force $stageRoot }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item -LiteralPath "$PSScriptRoot\aidr-server.service","$PSScriptRoot\install.sh","$PSScriptRoot\uninstall.sh","$PSScriptRoot\README.md" -Destination $stage
New-Item -ItemType Directory -Force -Path "$stage\server" | Out-Null
Copy-Item -Recurse -Force "$root\aidr-server\src","$root\aidr-server\public","$root\aidr-server\tools","$root\aidr-server\package.json","$root\aidr-server\package-lock.json" -Destination "$stage\server"
New-Item -ItemType Directory -Force -Path "$stage\aidr-endpoint\ui" | Out-Null
Copy-Item -Force "$root\aidr-endpoint\ui\index.html","$root\aidr-endpoint\ui\runtime-adapter.js","$root\aidr-endpoint\ui\abgc.js" -Destination "$stage\aidr-endpoint\ui"
New-Item -ItemType Directory -Force -Path (Split-Path $output) | Out-Null
tar -czf $output -C $stageRoot "aidr-server-linux"
Write-Output $output
