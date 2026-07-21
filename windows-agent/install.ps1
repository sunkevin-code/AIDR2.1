param(
  [string]$PolicyPath = "$PSScriptRoot\policy.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$taskName = "AIDR Guardian"
$guardian = Join-Path $PSScriptRoot "AidrGuardian.ps1"
if (-not (Test-Path -LiteralPath $guardian)) {
  throw "AidrGuardian.ps1 not found."
}

$logDir = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

$argument = "-NoProfile -ExecutionPolicy Bypass -File `"$guardian`" -PolicyPath `"$PolicyPath`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 7)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "AIDR Guardian for AI Agent zero-trust monitoring" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "AIDR Guardian installed and started." -ForegroundColor Green
Write-Host "Task: $taskName"
Write-Host "Policy: $PolicyPath"
Write-Host "Logs: $logDir\aidr-events.jsonl"
