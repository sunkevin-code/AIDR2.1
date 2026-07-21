$ErrorActionPreference = "Stop"
$taskName = "AIDR Guardian"
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "AIDR Guardian uninstalled." -ForegroundColor Green
} else {
  Write-Host "AIDR Guardian scheduled task was not found."
}
