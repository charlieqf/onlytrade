param(
  [string]$TaskName = "OnlyTrade-XHotNews-6h",
  [int]$IntervalHours = 6,
  [int]$IntervalMinutes = 0,
  [string]$RepoRoot = "",
  [string]$CollectorArgs = "--provider proxy_news --limit-total 24 --limit-per-category 6 --lookback-hours 12 --translate-zh",
  [switch]$RunNow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Convert-ToGitBashPath {
  param([string]$WindowsPath)
  $path = $WindowsPath -replace "\\", "/"
  if ($path -match "^[A-Za-z]:/") {
    $drive = $path.Substring(0, 1).ToLower()
    $rest = $path.Substring(2)
    return "/$drive$rest"
  }
  return $path
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepoRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
}

if ($IntervalHours -lt 1 -and $IntervalMinutes -lt 1) {
  throw "Either IntervalHours >= 1 or IntervalMinutes >= 1"
}

$bashCmd = Get-Command bash -ErrorAction SilentlyContinue
if (-not $bashCmd) {
  throw "bash not found in PATH. Install Git Bash and ensure bash is available."
}

$bashExe = $bashCmd.Source
$repoBash = Convert-ToGitBashPath -WindowsPath $RepoRoot
if ([string]::IsNullOrWhiteSpace($CollectorArgs)) {
  $bashArgs = ('-lc "cd ''{0}'' && bash scripts/x_hot_news_push.sh"' -f $repoBash)
} else {
  $bashArgs = ('-lc "cd ''{0}'' && bash scripts/x_hot_news_push.sh {1}"' -f $repoBash, $CollectorArgs)
}

$startAt = (Get-Date).AddMinutes(2)
if ($IntervalMinutes -ge 1) {
  $repeatSpan = New-TimeSpan -Minutes $IntervalMinutes
} else {
  $repeatSpan = New-TimeSpan -Hours $IntervalHours
}
$trigger = New-ScheduledTaskTrigger -Once -At $startAt -RepetitionInterval $repeatSpan -RepetitionDuration (New-TimeSpan -Days 3650)
$action = New-ScheduledTaskAction -Execute $bashExe -Argument $bashArgs
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Write-Host "Task registered:" $TaskName
Write-Host "Command:" "$bashExe $bashArgs"
if ($IntervalMinutes -ge 1) {
  Write-Host "Interval minutes:" $IntervalMinutes
} else {
  Write-Host "Interval hours:" $IntervalHours
}
Write-Host "Collector args:" $CollectorArgs

if ($RunNow.IsPresent) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Task started once immediately."
}
