param(
  [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

$projectPath = (
  Resolve-Path (
    Join-Path $PSScriptRoot ".."
  )
).Path

$logDirectory =
  Join-Path $projectPath "logs"

if (-not (Test-Path $logDirectory)) {
  New-Item `
    -ItemType Directory `
    -Force `
    -Path $logDirectory |
    Out-Null
}

$logPath =
  Join-Path `
    $logDirectory `
    (
      "daily-report-" +
      (Get-Date -Format "yyyy-MM-dd") +
      ".log"
    )

function Write-ReportLog {
  param(
    [string]$Message
  )

  $line =
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"

  Write-Host $line

  $line |
    Out-File `
      -FilePath $logPath `
      -Append `
      -Encoding utf8
}

function Get-EnvironmentValue {
  param(
    [string]$Name
  )

  $envPath =
    Join-Path `
      $projectPath `
      ".env.local"

  if (-not (Test-Path $envPath)) {
    return ""
  }

  $matchingLine =
    Get-Content $envPath |
      Where-Object {
        $_ -match "^\s*$Name\s*="
      } |
      Select-Object -Last 1

  if (-not $matchingLine) {
    return ""
  }

  $value =
    $matchingLine `
      -replace "^\s*$Name\s*=\s*", ""

  return $value.Trim().Trim('"').Trim("'")
}

try {
  $secret =
    Get-EnvironmentValue `
      "TRADING_AUTOMATION_SECRET"

  if (
    [string]::IsNullOrWhiteSpace(
      $secret
    )
  ) {
    throw "TRADING_AUTOMATION_SECRET is not configured"
  }

  $headers = @{
    "x-automation-secret" = $secret
  }

  $body = @{
    accountName = "default-paper"
    force = $false
  } |
    ConvertTo-Json `
      -Compress

  Write-ReportLog `
    "Sending daily performance report"

  $response =
    Invoke-RestMethod `
      -Method Post `
      -Uri (
        "$BaseUrl/api/alerts/telegram/daily-report"
      ) `
      -ContentType (
        "application/json; charset=utf-8"
      ) `
      -Headers $headers `
      -Body (
        [System.Text.Encoding]::UTF8.GetBytes(
          $body
        )
      ) `
      -TimeoutSec 120

  $responseText =
    $response |
      ConvertTo-Json `
        -Depth 30 `
        -Compress

  Write-ReportLog (
    "Report result: " +
    $responseText
  )

  if ($response.ok -ne $true) {
    exit 1
  }

  if (
    $response.summary.alertLevel -eq
    "CRITICAL"
  ) {
    Write-ReportLog `
      "Critical alert detected"

    exit 2
  }

  exit 0
}
catch {
  Write-ReportLog (
    "Report failed: " +
    $_.Exception.Message
  )

  exit 1
}