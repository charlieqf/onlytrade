[CmdletBinding()]
param(
  [string]$RepoRoot = "",
  [string]$BashExe = "",
  [string]$LogDir = ""
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
  throw "Git Bash not found."
}

function Write-LogLine {
  param(
    [string]$Path,
    [string]$Message
  )
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $Path -Value ("[{0}] {1}" -f $stamp, $Message) -Encoding UTF8
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepoRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
} else {
  $RepoRoot = (Resolve-Path $RepoRoot).Path
}

$BashExe = Resolve-GitBashExe -PreferredPath $BashExe

if ([string]::IsNullOrWhiteSpace($LogDir)) {
  $LogDir = Join-Path $RepoRoot "logs"
}
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$logPath = Join-Path $LogDir "t017_frontend_deploy.log"
$repoBash = Convert-ToGitBashPath -WindowsPath $RepoRoot
$bashCommand = "cd '$repoBash' && bash scripts/english/deploy_t017_frontend.sh"

Write-LogLine -Path $logPath -Message ("start: repo={0} bash={1}" -f $RepoRoot, $BashExe)
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
  $outputLines = & $BashExe -lc $bashCommand 2>&1
  $exitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorAction
}

foreach ($line in @($outputLines)) {
  if ($null -ne $line) {
    $text = if ($line -is [System.Management.Automation.ErrorRecord]) {
      $line.ToString()
    } else {
      [string]$line
    }
    if (-not [string]::IsNullOrWhiteSpace($text)) {
      Add-Content -Path $logPath -Value $text -Encoding UTF8
    }
  }
}

if ($exitCode -ne 0) {
  Write-LogLine -Path $logPath -Message ("finish: failed exit_code={0}" -f $exitCode)
  exit $exitCode
}

Write-LogLine -Path $logPath -Message "finish: success"
