param(
  [string]$BaseUrl =
    "http://localhost:3000",

  [switch]$AutoOrder,

  [ValidateRange(1, 5)]
  [int]$MaxOrders = 1,

  [string]$StartTime =
    "09:05",

  [string]$EndTime =
    "15:15",

  [string]$Secret = ""
)

$ErrorActionPreference = "Stop"

try {
  $koreaTimeZone =
    [System.TimeZoneInfo]::
      FindSystemTimeZoneById(
        "Korea Standard Time"
      )

  $now =
    [System.TimeZoneInfo]::
      ConvertTime(
        [DateTimeOffset]::UtcNow,
        $koreaTimeZone
      )

  if (
    $now.DayOfWeek -eq
      [DayOfWeek]::Saturday -or
    $now.DayOfWeek -eq
      [DayOfWeek]::Sunday
  ) {
    Write-Host (
      "주말이므로 실행하지 않습니다: " +
      $now.ToString(
        "yyyy-MM-dd HH:mm:ss"
      )
    )

    exit 0
  }

  $start =
    [TimeSpan]::Parse(
      $StartTime
    )

  $end =
    [TimeSpan]::Parse(
      $EndTime
    )

  if (
    $now.TimeOfDay -lt
      $start -or
    $now.TimeOfDay -gt
      $end
  ) {
    Write-Host (
      "설정된 운영 시간이 아닙니다: " +
      $now.ToString(
        "yyyy-MM-dd HH:mm:ss"
      )
    )

    exit 0
  }

  $body = @{
    triggerType =
      "SCHEDULED"

    includeMarketSync =
      $true

    autoOrder =
      [bool]$AutoOrder

    maxOrders =
      $MaxOrders
  } |
    ConvertTo-Json `
      -Compress

  $headers = @{}

  if (
    -not [string]::
      IsNullOrWhiteSpace(
        $Secret
      )
  ) {
    $headers[
      "x-automation-secret"
    ] = $Secret
  }

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
        [System.Text.Encoding]::
          UTF8.GetBytes(
            $body
          )
      )

  $response |
    ConvertTo-Json `
      -Depth 30

  if (
    $response.status -ne
      "SUCCESS"
  ) {
    exit 1
  }

  exit 0
}
catch {
  Write-Error $_.Exception.Message
  exit 1
}