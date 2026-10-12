param(
    [Parameter(Mandatory = $true)]
    [string]$RunId,

    [int]$BatchSize = 10,

    [int]$DelayMs = 1500,

    [int]$PauseBetweenBatchesMs = 500,

    [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

function Get-BackfillStatus {
    $uri =
        "$BaseUrl/api/market/data/v8/backfill/status?runId=$RunId"

    return Invoke-RestMethod `
        -Uri $uri `
        -Method GET
}

Write-Host "v8.3 backfill runner"
Write-Host "RunId: $RunId"
Write-Host "BatchSize: $BatchSize"
Write-Host "Request delay: $DelayMs ms"
Write-Host ""

while ($true) {
    $statusResponse =
        Get-BackfillStatus

    $run =
        $statusResponse.result.run

    if (-not $run) {
        throw "BACKFILL_RUN_NOT_FOUND: $RunId"
    }

    Write-Host (
        "[{0}] status={1} success={2}/{3} pending={4} running={5} failed={6} savedRows={7}" -f `
        (Get-Date -Format "HH:mm:ss"), `
        $run.status, `
        $run.success_count, `
        $run.task_count, `
        $run.pending_count, `
        $run.running_count, `
        $run.failed_count, `
        $run.saved_rows
    )

    if (
        $run.status -ne "RUNNING"
    ) {
        Write-Host ""
        Write-Host "Backfill finished: $($run.status)"
        break
    }

    $body = @{
        runId         = $RunId
        maxTasks      = $BatchSize
        requestDelayMs = $DelayMs
    } | ConvertTo-Json -Compress

    try {
        $process =
            Invoke-RestMethod `
                -Uri "$BaseUrl/api/market/data/v8/backfill/process" `
                -Method POST `
                -ContentType "application/json" `
                -Body $body

        $progress =
            $process.result.progress

        Write-Host (
            "  batch processed={0} success={1} failure={2} -> runStatus={3}" -f `
            $process.result.processedTasks, `
            $process.result.successes, `
            $process.result.failures, `
            $progress.status
        )
    }
    catch {
        Write-Warning $_.Exception.Message
        Start-Sleep -Seconds 5
    }

    if (
        $PauseBetweenBatchesMs -gt 0
    ) {
        Start-Sleep `
            -Milliseconds $PauseBetweenBatchesMs
    }
}
