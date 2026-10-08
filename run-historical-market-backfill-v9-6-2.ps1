param(
    [Parameter(Mandatory = $true)]
    [string]$RunId,

    [int]$BatchSize = 5,

    [int]$DelayMs = 1500,

    [int]$PauseBetweenBatchesMs = 500,

    [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

Write-Host "v9.6.2 PIT-aware historical OHLCV backfill"
Write-Host "Reusing v8.3 persistent worker"
Write-Host "RunId: $RunId"
Write-Host "BatchSize: $BatchSize"
Write-Host "Request delay: $DelayMs ms"
Write-Host ""

while ($true) {
    $status =
        Invoke-RestMethod `
            -Uri "$BaseUrl/api/market/data/v8/backfill/status?runId=$RunId" `
            -Method GET `
            -TimeoutSec 60

    $run =
        $status.result.run

    if (-not $run) {
        throw "BACKFILL_RUN_NOT_FOUND: $RunId"
    }

    Write-Host (
        "[{0}] status={1} success={2}/{3} pending={4} running={5} failed={6} received={7} saved={8}" -f `
            (Get-Date -Format "HH:mm:ss"), `
            $run.status, `
            $run.success_count, `
            $run.task_count, `
            $run.pending_count, `
            $run.running_count, `
            $run.failed_count, `
            $run.received_rows, `
            $run.saved_rows
    )

    if ($run.status -ne "RUNNING") {
        Write-Host ""
        Write-Host "Historical OHLCV backfill finished: $($run.status)"
        break
    }

    $body = @{
        runId          = $RunId
        maxTasks       = $BatchSize
        requestDelayMs = $DelayMs
    } | ConvertTo-Json -Compress

    try {
        $process =
            Invoke-RestMethod `
                -Uri "$BaseUrl/api/market/data/v8/backfill/process" `
                -Method POST `
                -ContentType "application/json" `
                -Body $body `
                -TimeoutSec 300

        Write-Host (
            "  batch processed={0} success={1} failure={2} -> status={3}" -f `
                $process.result.processedTasks, `
                $process.result.successes, `
                $process.result.failures, `
                $process.result.progress.status
        )
    }
    catch {
        Write-Warning $_.Exception.Message
        Start-Sleep -Seconds 5
    }

    if ($PauseBetweenBatchesMs -gt 0) {
        Start-Sleep `
            -Milliseconds $PauseBetweenBatchesMs
    }
}
