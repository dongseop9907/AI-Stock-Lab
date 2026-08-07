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
      "trading-automation-" +
      (Get-Date -Format "yyyy-MM-dd") +
      ".log"
    )

function Write-AutomationLog {
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

  $environmentPath =
    Join-Path `
      $projectPath `
      ".env.local"

  if (-not (Test-Path $environmentPath)) {
    return ""
  }

  $matchingLine =
    Get-Content $environmentPath |
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
    "x-automation-secret" =
      $secret
  }

  Write-AutomationLog `
    "Reading trading system control"

  $controlResponse =
    Invoke-RestMethod `
      -Method Get `
      -Uri (
        "$BaseUrl/api/trading/system/control"
      ) `
      -TimeoutSec 30

  if (
    $controlResponse.ok -ne
    $true
  ) {
    throw "Trading system control request failed"
  }

  $control =
    $controlResponse.control

  Write-AutomationLog (
    "Control state: " +
    "automationEnabled=" +
    $control.automationEnabled +
    ", paperOrderEnabled=" +
    $control.paperOrderEnabled +
    ", emergencyStop=" +
    $control.emergencyStop +
    ", maxOrdersPerCycle=" +
    $control.maxOrdersPerCycle
  )

  $requestBody = @{
    triggerType =
      "SCHEDULED"

    includeMarketSync =
      $true

    # Request automatic paper orders.
    # The database safety control makes the final decision.
    autoOrder =
      $true

    # The server applies the smaller value between
    # this request and maxOrdersPerCycle.
    maxOrders =
      5
  } |
    ConvertTo-Json `
      -Compress

  Write-AutomationLog `
    "Starting scheduled trading automation"

  $response =
    Invoke-RestMethod `
      -Method Post `
      -Uri (
        "$BaseUrl/api/trading/automation/run"
      ) `
      -ContentType (
        "application/json; charset=utf-8"
      ) `
      -Headers $headers `
      -Body (
        [System.Text.Encoding]::UTF8.GetBytes(
          $requestBody
        )
      ) `
      -TimeoutSec 240

  $safeReason = ""

if ($response.skipped -eq $true) {
  if (
    $response.control.emergencyStop -eq
    $true
  ) {
    $safeReason =
      "Emergency stop is active"
  }
  elseif (
    $response.control.automationEnabled -eq
    $false
  ) {
    $safeReason =
      "Automation is paused"
  }
  else {
    $safeReason =
      "Automation was skipped"
  }
}

Write-AutomationLog (
  "Automation result: " +
  "ok=" +
  $response.ok +
  ", skipped=" +
  $response.skipped +
  ", status=" +
  $response.status +
  ", reason=" +
  $safeReason
)

  if (
    $response.skipped -eq
    $true
  ) {
    Write-AutomationLog (
  "Automation skipped safely: " +
  $safeReason
)

    exit 0
  }

  if (
    $response.status -eq
    "SUCCESS"
  ) {
    Write-AutomationLog `
      "Automation completed successfully"

    exit 0
  }

  if (
    $response.status -eq
      "PARTIAL_FAILURE"
  ) {
    Write-AutomationLog `
      "Automation completed with partial failures"

    exit 1
  }

  if (
    $response.status -eq
    "FAILED"
  ) {
    Write-AutomationLog `
      "Automation failed"

    exit 1
  }

  if (
    $response.ok -ne
    $true
  ) {
    Write-AutomationLog `
      "Automation returned an unsuccessful result"

    exit 1
  }

  exit 0
}
catch {
  Write-AutomationLog (
    "Automation script failed: " +
    $_.Exception.Message
  )

  exit 1
}