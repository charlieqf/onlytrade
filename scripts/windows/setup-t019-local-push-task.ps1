param(
  [string]$TaskName = "OnlyTrade-T019-LocalPush-10m",
  [int]$IntervalMinutes = 10,
  [int]$StartDelayMinutes = 4,
  [int]$StartHour = 8,
  [int]$EndHour = 23,
  [string]$RepoRoot = "",
  [string]$BashExe = "",
  [switch]$RunNow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-GitBashExe {
  param([string]$PreferredPath)
  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($PreferredPath)) {
    $candidates += $PreferredPath
  }
  $candidates += @(
    "C:\Program Files\Git\bin\bash.exe",
    "C:\Program Files\Git\usr\bin\bash.exe"
  )
  foreach ($candidate in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path $candidate)) {
      return (Resolve-Path $candidate).Path
    }
  }
  throw "Git Bash not found. Install Git for Windows or pass -BashExe."
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepoRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
} else {
  $RepoRoot = (Resolve-Path $RepoRoot).Path
}

if ($IntervalMinutes -lt 1) {
  throw "IntervalMinutes must be >= 1"
}
if ($StartDelayMinutes -lt 0) {
  throw "StartDelayMinutes must be >= 0"
}
if ($StartHour -lt 0 -or $StartHour -gt 23) {
  throw "StartHour must be between 0 and 23"
}
if ($EndHour -lt 1 -or $EndHour -gt 24) {
  throw "EndHour must be between 1 and 24"
}
if ($StartHour -ge $EndHour) {
  throw "StartHour must be less than EndHour"
}

$runnerPath = Join-Path $RepoRoot "scripts\windows\run-t019-local-push.ps1"
if (-not (Test-Path $runnerPath)) {
  throw "Runner script not found: $runnerPath"
}

$BashExe = Resolve-GitBashExe -PreferredPath $BashExe
$powershellExe = Join-Path $PSHOME "powershell.exe"
if (-not (Test-Path $powershellExe)) {
  $powershellExe = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
}

$startAt = (Get-Date).AddMinutes($StartDelayMinutes)
$repeatSpan = New-TimeSpan -Minutes $IntervalMinutes
$trigger = New-ScheduledTaskTrigger -Once -At $startAt -RepetitionInterval $repeatSpan -RepetitionDuration (New-TimeSpan -Days 3650)
$actionArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -RepoRoot "{1}" -BashExe "{2}" -StartHour {3} -EndHour {4}' -f $runnerPath, $RepoRoot, $BashExe, $StartHour, $EndHour
$action = New-ScheduledTaskAction -Execute $powershellExe -Argument $actionArgs
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Write-Host "Task registered:" $TaskName
Write-Host "Runner:" $runnerPath
Write-Host "Bash:" $BashExe
Write-Host "Interval minutes:" $IntervalMinutes
Write-Host "Start delay minutes:" $StartDelayMinutes
Write-Host "Daytime window:" ("{0}:00-{1}:00" -f $StartHour, $EndHour)
Write-Host "Command:" "$powershellExe $actionArgs"

if ($RunNow.IsPresent) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Task started once immediately."
}
