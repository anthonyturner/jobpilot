<#
.SYNOPSIS
  Registers a Windows scheduled task that starts JobPilot when you log in,
  so scheduled sweeps run without keeping a terminal open.

.DESCRIPTION
  Runs as your user (no admin rights, no stored password), hidden, and only
  while you are logged in. Remove it with:  .\scripts\install-startup-task.ps1 -Remove
#>
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$taskName = 'JobPilot'
$repo = Split-Path -Parent $PSScriptRoot

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task '$taskName'."
  return
}

if (-not (Test-Path (Join-Path $repo 'web\dist\web\browser\index.html'))) {
  Write-Host 'Building the UI first...'
  Push-Location $repo
  npm run build
  Pop-Location
}

$npm = (Get-Command npm.cmd).Source
$action = New-ScheduledTaskAction -Execute $npm -Argument 'run serve' -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -Hidden
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Description 'JobPilot job-search copilot (http://127.0.0.1:7317)' -Force | Out-Null

Write-Host "Registered '$taskName'. It starts at your next login; start it now with: Start-ScheduledTask $taskName"
