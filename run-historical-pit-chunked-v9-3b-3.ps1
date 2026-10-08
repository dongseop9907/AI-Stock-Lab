param(
    [Parameter(Mandatory=$true)]
    [string]$CompilationRunId,

    [int]$MaxChunks = 1,

    [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

Write-Host "v9.3B.3 Historical PIT chunked compiler"
Write-Host "CompilationRunId: $CompilationRunId"
Write-Host "MaxChunks per request: $MaxChunks"
Write-Host ""

while ($true) {
    $status =
        Invoke-RestMethod `
            -Uri "$BaseUrl/api/market/universe/v9/historical/compile/chunked/status?compilationRunId=$CompilationRunId" `
            -Method GET `
            -TimeoutSec 60

    $run =
        $status.result.run

    $counts =
        $status.result.counts

    Write-Host (
        "[{0}] status={1} chunks={2} success={3} pending={4} running={5} failed={6} compiledIntervals={7}" -f `
            (Get-Date -Format "HH:mm:ss"), `
            $run.status, `
            $counts.chunks, `
            $counts.success, `
            $counts.pending, `
            $counts.running, `
            $counts.failed, `
            $run.compiled_interval_count
    )

    if (
        $run.status -eq "READY"
    ) {
        Write-Host ""
        Write-Host "Historical PIT chunked compilation finished: READY"
        exit 0
    }

    if (
        $run.status -eq "FAILED" -or
        $run.status -eq "CANCELLED"
    ) {
        Write-Host ""
        Write-Host "Historical PIT chunked compilation finished: $($run.status)"
        exit 1
    }

    $body = @{
        compilationRunId = $CompilationRunId
        maxChunks        = $MaxChunks
    } | ConvertTo-Json -Compress

    try {
        $processed =
            Invoke-RestMethod `
                -Uri "$BaseUrl/api/market/universe/v9/historical/compile/chunked/process" `
                -Method POST `
                -ContentType "application/json" `
                -Body $body `
                -TimeoutSec 120 `
                -ErrorAction Stop

        Write-Host (
            "  processed={0} success={1} failure={2} -> status={3}" -f `
                $processed.result.processedChunks, `
                $processed.result.successfulChunks, `
                $processed.result.failedChunks, `
                $processed.result.progress.status
        )
    }
    catch {
        Write-Host "  process request failed; waiting 5 seconds before status re-check."
        Write-Host "  $($_.Exception.Message)"
        Start-Sleep -Seconds 5
    }
}
