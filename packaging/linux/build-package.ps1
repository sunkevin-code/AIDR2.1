param(
  [string]$OutputDirectory = "$PSScriptRoot\..\..\output"
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path "$PSScriptRoot\..\.."
$stage = Join-Path $env:TEMP "aidr-endpoint-linux"
if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item -LiteralPath "$repo\aidr-agent" -Destination "$stage\agent" -Recurse
Remove-Item -LiteralPath "$stage\agent\node_modules" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "$stage\agent\logs" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath "$PSScriptRoot\aidr-endpoint.service","$PSScriptRoot\install.sh","$PSScriptRoot\uninstall.sh","$PSScriptRoot\enroll.js","$PSScriptRoot\README.md" -Destination $stage
$installReadme = Get-ChildItem -LiteralPath "$repo\docs" -File | Where-Object { $_.Name -like "AIDR-Linux-TAR*README.md" } | Select-Object -First 1
if (-not $installReadme) { throw "Unified Linux TAR README was not found." }
Copy-Item -LiteralPath $installReadme.FullName -Destination "$stage\INSTALL-README.md"
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$archive = Join-Path (Resolve-Path $OutputDirectory) "aidr-endpoint-linux.tar.gz"
if (Test-Path $archive) { Remove-Item -LiteralPath $archive -Force }
tar -czf $archive -C (Split-Path $stage -Parent) (Split-Path $stage -Leaf)
if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
Write-Output $archive
