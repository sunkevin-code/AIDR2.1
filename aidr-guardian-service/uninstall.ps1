param(
  [string]$InstallDir = "$env:LOCALAPPDATA\AIDRGuardian"
)

$ErrorActionPreference = "Stop"
$taskName = "AIDR Guardian Web Service"
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Get-Process "AIDR.Guardian" -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "AIDR Guardian uninstalled. Files remain at: $InstallDir"
