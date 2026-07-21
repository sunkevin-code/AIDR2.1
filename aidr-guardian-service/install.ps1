<#
.SYNOPSIS
  Installs AIDR Guardian as a Windows scheduled task.
.DESCRIPTION
  Copies the executable and policy to %LOCALAPPDATA%\AIDRGuardian
  and creates a scheduled task that starts at user logon.
.PARAMETER InstallDir
  Custom installation directory (default: %LOCALAPPDATA%\AIDRGuardian)
.PARAMETER Port
  Custom web console port (default: 8787)
.EXAMPLE
  .\install.ps1
.EXAMPLE
  .\install.ps1 -InstallDir "D:\AIDR" -Port 9090
#>
param(
  [string]$InstallDir = "$env:LOCALAPPDATA\AIDRGuardian",
  [int]$Port = 8787
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$taskName = "AIDR Guardian Web Service"

# Validate source
$sourceExe = Join-Path $PSScriptRoot "dist\AIDR.Guardian.exe"
$sourcePolicy = Join-Path $PSScriptRoot "dist\policy.json"
if (-not (Test-Path -LiteralPath $sourceExe)) {
  Write-Host "ERROR: AIDR.Guardian.exe not found." -ForegroundColor Red
  Write-Host "Run: cd aidr-guardian-service; npm install; npm run build:exe" -ForegroundColor Yellow
  exit 1
}

# Install directory
Write-Host "Installing to: $InstallDir" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $InstallDir "AIDR.Guardian.exe") -Force
Copy-Item -LiteralPath $sourcePolicy -Destination (Join-Path $InstallDir "policy.json") -Force

# Set port via env var for the task
$exe = Join-Path $InstallDir "AIDR.Guardian.exe"
$action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 7)

# Remove old task if exists
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null

# Register new task
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "AIDR Guardian - AI Agent security monitoring web service" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host ""
Write-Host "✓ AIDR Guardian installed!" -ForegroundColor Green
Write-Host "  Install dir: $InstallDir" -ForegroundColor Gray
Write-Host "  Console:     http://127.0.0.1:$Port" -ForegroundColor Cyan
Write-Host "  Task name:   $taskName" -ForegroundColor Gray
Write-Host ""
Write-Host "To configure, open the console in your browser." -ForegroundColor Yellow
