param(
    [Parameter(Mandatory=$true)]
    [string]$RunId,

    [int]$BatchSize = 5,

    [int]$DelayMs = 400,

    [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

Write-Host "v9.3C KRX historical PIT runner"
Write-Host "RunId: $RunId"
Write-Host "BatchSize: $BatchSize"
Write-Host "Inter-date delay: $DelayMs ms"
Write-Host ""

while ($true) {
    $status =
        Invoke-RestMethod `
            -Uri "$BaseUrl/api/market/universe/v9/historical/krx/status?runId=$RunId" `
            -Method GET

    $run =
        $status.result.run

    Write-Host (
        "[{0}] status={1} success={2}/{3} pending={4} running={5} failed={6} apiRequests={7} importedMembers={8}" -f `
            (Get-Date -Format "HH:mm:ss"), `
            $run.status, `
            $run.success_count, `
            $run.trading_date_count, `
            $run.pending_count, `
            $run.running_count, `
            $run.failed_count, `
            $run.api_request_count, `
            $run.imported_member_rows
    )

    if ($run.status -eq "SUCCESS") {
        Write-Host ""
        Write-Host "KRX historical PIT import finished: SUCCESS"
        exit 0
    }

    if ($run.status -eq "FAILED" -or $run.status -eq "CANCELLED") {
        Write-Host ""
        Write-Host "KRX historical PIT import finished: $($run.status)"
        exit 1
    }

    $body = @{
        runId          = $RunId
        maxTasks       = $BatchSize
        requestDelayMs = $DelayMs
    } | ConvertTo-Json -Compress

    $processed =
        Invoke-RestMethod `
            -Uri "$BaseUrl/api/market/universe/v9/historical/krx/process" `
            -Method POST `
            -ContentType "application/json" `
            -Body $body `
            -TimeoutSec 300

    Write-Host (
        "  batch processed={0} success={1} failure={2} -> runStatus={3}" -f `
            $processed.result.processedTasks, `
            $processed.result.successes, `
            $processed.result.failures, `
            $processed.result.progress.status
    )

    if ($processed.result.processedTasks -eq 0) {
        Start-Sleep -Seconds 3
    }
}
