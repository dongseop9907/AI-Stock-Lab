$ErrorActionPreference = "Stop"

$ProjectRoot =
    "C:\Users\user\Desktop\ai-stock-lab"

$ServerTaskName =
    "AI Stock Lab Server"

$EodEndpoint =
    "http://localhost:3000/api/market/regime/v7/eod-sync"

$IntegrityEndpoint =
    "http://localhost:3000/api/market/regime/v7/integrity"

$LogDirectory =
    Join-Path `
        $ProjectRoot `
        "logs"

$LogFile =
    Join-Path `
        $LogDirectory `
        "market-eod-sync.log"

$MaxAttempts =
    3

$RetryMinutes =
    10

if (
    -not (
        Test-Path $LogDirectory
    )
) {
    New-Item `
        $LogDirectory `
        -ItemType Directory `
        -Force |
        Out-Null
}

function Write-Log {
    param(
        [string]$Message
    )

    $line =
        "{0} {1}" -f `
            (
                Get-Date `
                    -Format "yyyy-MM-dd HH:mm:ss"
            ),
            $Message

    Add-Content `
        -Path $LogFile `
        -Value $line `
        -Encoding UTF8

    Write-Host $line
}

function Test-Server {
    try {
        Invoke-WebRequest `
            -Uri "http://localhost:3000" `
            -Method GET `
            -UseBasicParsing `
            -TimeoutSec 5 |
            Out-Null

        return $true
    }
    catch {
        return $false
    }
}

function Invoke-EodSync {
    $body = @{
        lookbackCalendarDays =
            10

        skipIfAlreadyFresh =
            $true
    } |
        ConvertTo-Json `
            -Compress

    return Invoke-RestMethod `
        -Uri $EodEndpoint `
        -Method POST `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 180
}

function Invoke-IntegrityScan {
    param(
        [bool]$Repair
    )

    $body = @{
        windowCalendarDays =
            45

        repair =
            $Repair
    } |
        ConvertTo-Json `
            -Compress

    return Invoke-RestMethod `
        -Uri $IntegrityEndpoint `
        -Method POST `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 300
}

Write-Log "EOD + integrity runner started."

if (
    -not (
        Test-Server
    )
) {
    Write-Log "Local server is not responding. Starting scheduled server task."

    try {
        Start-ScheduledTask `
            -TaskName $ServerTaskName

        Start-Sleep `
            -Seconds 15
    }
    catch {
        Write-Log "Failed to start server scheduled task: $($_.Exception.Message)"
        exit 1
    }
}

if (
    -not (
        Test-Server
    )
) {
    Write-Log "Local server is still unavailable."
    exit 1
}

for (
    $attempt = 1;
    $attempt -le $MaxAttempts;
    $attempt++
) {
    try {
        Write-Log "Calling EOD sync. attempt=$attempt/$MaxAttempts"

        $eod =
            Invoke-EodSync

        if (
            -not $eod.ok
        ) {
            throw "EOD API returned ok=false"
        }

        $eodStatus =
            [string]$eod.result.status

        $expectedMarketDate =
            [string]$eod.result.expectedMarketDate

        Write-Log "EOD sync result: status=$eodStatus expectedMarketDate=$expectedMarketDate"

        if (
            $eodStatus -ne "SUCCESS" -and
            $eodStatus -ne "SKIPPED_ALREADY_FRESH"
        ) {
            throw "EOD sync did not finish in an acceptable state: $eodStatus"
        }

        Write-Log "Calling v7.9 integrity scan with repair=false."

        $integrity =
            Invoke-IntegrityScan `
                -Repair $false

        if (
            -not $integrity.ok
        ) {
            throw "Integrity API returned ok=false"
        }

        $integrityStatus =
            [string]$integrity.result.status

        $errorCount =
            [int]$integrity.result.before.counts.errors

        $warningCount =
            [int]$integrity.result.before.counts.warnings

        $repairableCount =
            [int]$integrity.result.before.counts.repairable

        Write-Log "Integrity result: status=$integrityStatus errors=$errorCount warnings=$warningCount repairable=$repairableCount"

        if (
            $integrityStatus -eq "CLEAN" -or
            $integrityStatus -eq "WARNING"
        ) {
            if (
                $integrityStatus -eq "WARNING"
            ) {
                Write-Log "Integrity warnings detected. No automatic repair is performed for warning-only findings."
            }

            Write-Log "EOD + integrity runner completed successfully."
            exit 0
        }

        if (
            $integrityStatus -eq "ERROR" -and
            $repairableCount -gt 0
        ) {
            Write-Log "Repairable integrity errors detected. Calling repair=true."

            $repair =
                Invoke-IntegrityScan `
                    -Repair $true

            if (
                -not $repair.ok
            ) {
                throw "Integrity repair API returned ok=false"
            }

            $repairStatus =
                [string]$repair.result.status

            $afterErrors =
                [int]$repair.result.after.counts.errors

            $afterWarnings =
                [int]$repair.result.after.counts.warnings

            Write-Log "Integrity repair result: status=$repairStatus afterErrors=$afterErrors afterWarnings=$afterWarnings"

            if (
                $repairStatus -eq "REPAIRED" -and
                $afterErrors -eq 0
            ) {
                Write-Log "EOD + integrity runner completed after automatic repair."
                exit 0
            }

            throw "Integrity repair did not fully recover the data: status=$repairStatus afterErrors=$afterErrors"
        }

        throw "Integrity scan returned an unacceptable state: $integrityStatus"
    }
    catch {
        Write-Log "Attempt failed: $($_.Exception.Message)"

        if (
            $attempt -lt $MaxAttempts
        ) {
            Write-Log "Waiting $RetryMinutes minute(s) before retry."

            Start-Sleep `
                -Seconds (
                    $RetryMinutes *
                    60
                )
        }
    }
}

Write-Log "EOD + integrity runner failed after all retry attempts."
exit 1