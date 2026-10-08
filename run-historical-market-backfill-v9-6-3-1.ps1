param(
    [string]$CompilationRunId =
        "294e193f-fc56-42cd-a972-a6ddbed56769",

    [string]$StartDate =
        "2023-01-02",

    [string]$EndDate =
        "2026-07-31",

    [int]$WindowCalendarDays =
        120,

    [int]$MinWindowCalendarDays =
        14,

    [int]$BatchSize =
        10,

    [int]$DelayMs =
        1500,

    [int]$MaxAttempts =
        3,

    [int]$MaxWindows =
        0,

    [string]$BaseUrl =
        "http://localhost:3000",

    [string]$StateFile =
        ".\logs\historical-market-backfill-v9-6-3-state.json"
)

$ErrorActionPreference =
    "Stop"

$Version =
    "HISTORICAL_MARKET_BACKFILL_WINDOWED_V9_6_3"

# v9.6.3.1 hotfix:
# Keep PowerShell member access on the same expression line.
# The original line-broken `.result` access was parsed as a command.

function Convert-ToDate {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    return [DateTime]::ParseExact(
        $Value,
        "yyyy-MM-dd",
        [System.Globalization.CultureInfo]::InvariantCulture
    ).Date
}

function Format-Date {
    param(
        [Parameter(Mandatory = $true)]
        [DateTime]$Value
    )

    return $Value.ToString(
        "yyyy-MM-dd"
    )
}

function Save-State {
    param(
        [Parameter(Mandatory = $true)]
        $State
    )

    $directory =
        Split-Path `
            $StateFile `
            -Parent

    if (
        $directory -and
        -not (
            Test-Path $directory
        )
    ) {
        New-Item `
            -ItemType Directory `
            -Path $directory `
            -Force |
            Out-Null
    }

    $State.updatedAt =
        (
            Get-Date
        ).ToString(
            "o"
        )

    $json =
        $State |
        ConvertTo-Json `
            -Depth 50

    Set-Content `
        -Path $StateFile `
        -Value $json `
        -Encoding UTF8
}

function New-Window {
    param(
        [Parameter(Mandatory = $true)]
        [DateTime]$WindowStart,

        [Parameter(Mandatory = $true)]
        [DateTime]$WindowEnd
    )

    return [PSCustomObject]@{
        startDate =
            Format-Date $WindowStart

        endDate =
            Format-Date $WindowEnd

        status =
            "PENDING"

        runId =
            $null

        taskCount =
            $null

        expectedBarCount =
            $null

        availableBarCount =
            $null

        missingBarCount =
            $null

        selectedSecurityCount =
            $null

        finalRunStatus =
            $null

        receivedRows =
            0

        savedRows =
            0

        error =
            $null
    }
}

function New-InitialState {
    $rangeStart =
        Convert-ToDate $StartDate

    $rangeEnd =
        Convert-ToDate $EndDate

    if (
        $rangeStart -gt
        $rangeEnd
    ) {
        throw "START_DATE_AFTER_END_DATE"
    }

    $windowDays =
        [Math]::Max(
            1,
            $WindowCalendarDays
        )

    $windows =
        New-Object `
            System.Collections.ArrayList

    $cursor =
        $rangeStart

    while (
        $cursor -le
        $rangeEnd
    ) {
        $windowEnd =
            $cursor.AddDays(
                $windowDays -
                1
            )

        if (
            $windowEnd -gt
            $rangeEnd
        ) {
            $windowEnd =
                $rangeEnd
        }

        [void]$windows.Add(
            (
                New-Window `
                    -WindowStart $cursor `
                    -WindowEnd $windowEnd
            )
        )

        $cursor =
            $windowEnd.AddDays(
                1
            )
    }

    return [PSCustomObject]@{
        version =
            $Version

        compilationRunId =
            $CompilationRunId

        startDate =
            $StartDate

        endDate =
            $EndDate

        initialWindowCalendarDays =
            $WindowCalendarDays

        minWindowCalendarDays =
            $MinWindowCalendarDays

        batchSize =
            $BatchSize

        delayMs =
            $DelayMs

        maxAttempts =
            $MaxAttempts

        createdAt =
            (
                Get-Date
            ).ToString(
                "o"
            )

        updatedAt =
            (
                Get-Date
            ).ToString(
                "o"
            )

        windows =
            $windows

        finalCoverage =
            $null
    }
}

function Load-OrCreateState {
    if (
        Test-Path $StateFile
    ) {
        $state =
            Get-Content `
                -Path $StateFile `
                -Raw |
            ConvertFrom-Json

        if (
            $state.version -ne
            $Version
        ) {
            throw (
                "STATE_VERSION_MISMATCH: " +
                $state.version
            )
        }

        if (
            $state.compilationRunId -ne
            $CompilationRunId -or
            $state.startDate -ne
            $StartDate -or
            $state.endDate -ne
            $EndDate
        ) {
            throw "STATE_RANGE_OR_COMPILATION_MISMATCH"
        }

        return $state
    }

    $state =
        New-InitialState

    Save-State $state

    return $state
}

function Get-ErrorResponseBody {
    param(
        [Parameter(Mandatory = $true)]
        $Exception
    )

    try {
        $response =
            $Exception.Response

        if (
            -not $response
        ) {
            return ""
        }

        $stream =
            $response.GetResponseStream()

        if (
            -not $stream
        ) {
            return ""
        }

        $reader =
            New-Object `
                System.IO.StreamReader(
                    $stream
                )

        try {
            return $reader.ReadToEnd()
        }
        finally {
            $reader.Close()
            $stream.Close()
        }
    }
    catch {
        return ""
    }
}

function Create-WindowRun {
    param(
        [Parameter(Mandatory = $true)]
        $Window
    )

    $body = @{
        compilationRunId =
            $CompilationRunId

        startDate =
            [string]$Window.startDate

        endDate =
            [string]$Window.endDate

        adjustedPrice =
            $true

        maxAttempts =
            $MaxAttempts

        requestDelayMs =
            $DelayMs
    } |
        ConvertTo-Json `
            -Compress

    try {
        return Invoke-RestMethod `
            -Uri (
                "$BaseUrl/api/research/data/v9/" +
                "historical-market-backfill/create"
            ) `
            -Method POST `
            -ContentType "application/json" `
            -Body $body `
            -TimeoutSec 600 `
            -ErrorAction Stop
    }
    catch {
        $bodyText =
            Get-ErrorResponseBody `
                -Exception $_.Exception

        $message =
            $_.Exception.Message

        if (
            $bodyText
        ) {
            $message =
                "$message | $bodyText"
        }

        throw $message
    }
}

function Split-WindowAtIndex {
    param(
        [Parameter(Mandatory = $true)]
        $State,

        [Parameter(Mandatory = $true)]
        [int]$Index
    )

    $window =
        $State.windows[
            $Index
        ]

    $start =
        Convert-ToDate `
            ([string]$window.startDate)

    $end =
        Convert-ToDate `
            ([string]$window.endDate)

    $calendarDays =
        (
            $end -
            $start
        ).Days +
        1

    if (
        $calendarDays -le
        $MinWindowCalendarDays
    ) {
        throw (
            "WINDOW_CANNOT_SPLIT_FURTHER " +
            "$($window.startDate).." +
            "$($window.endDate)"
        )
    }

    $leftDays =
        [Math]::Floor(
            $calendarDays /
            2
        )

    $leftEnd =
        $start.AddDays(
            $leftDays -
            1
        )

    $rightStart =
        $leftEnd.AddDays(
            1
        )

    $left =
        New-Window `
            -WindowStart $start `
            -WindowEnd $leftEnd

    $right =
        New-Window `
            -WindowStart $rightStart `
            -WindowEnd $end

    $replacement =
        New-Object `
            System.Collections.ArrayList

    for (
        $i = 0;
        $i -lt $State.windows.Count;
        $i++
    ) {
        if (
            $i -eq
            $Index
        ) {
            [void]$replacement.Add(
                $left
            )

            [void]$replacement.Add(
                $right
            )
        }
        else {
            [void]$replacement.Add(
                $State.windows[
                    $i
                ]
            )
        }
    }

    $State.windows =
        $replacement

    Save-State $State

    Write-Host (
        "Planner timeout: split window " +
        "$($window.startDate).." +
        "$($window.endDate) into " +
        "$($left.startDate).." +
        "$($left.endDate) and " +
        "$($right.startDate).." +
        "$($right.endDate)"
    )
}

function Get-RunStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RunId
    )

    return Invoke-RestMethod `
        -Uri (
            "$BaseUrl/api/market/data/v8/" +
            "backfill/status?runId=$RunId"
        ) `
        -Method GET `
        -TimeoutSec 60
}

function Process-WindowRun {
    param(
        [Parameter(Mandatory = $true)]
        $Window,

        [Parameter(Mandatory = $true)]
        $State
    )

    $runId =
        [string]$Window.runId

    while (
        $true
    ) {
        $statusResponse =
            Get-RunStatus `
                -RunId $runId

        $run =
            $statusResponse.result.run

        if (
            -not $run
        ) {
            throw (
                "BACKFILL_RUN_NOT_FOUND: " +
                $runId
            )
        }

        $Window.finalRunStatus =
            [string]$run.status

        $Window.receivedRows =
            [long]$run.received_rows

        $Window.savedRows =
            [long]$run.saved_rows

        Save-State $State

        Write-Host (
            "[{0}] window={1}..{2} " +
            "run={3} status={4} " +
            "success={5}/{6} pending={7} " +
            "failed={8} received={9} saved={10}" -f `
                (
                    Get-Date `
                        -Format "HH:mm:ss"
                ), `
                $Window.startDate, `
                $Window.endDate, `
                $runId, `
                $run.status, `
                $run.success_count, `
                $run.task_count, `
                $run.pending_count, `
                $run.failed_count, `
                $run.received_rows, `
                $run.saved_rows
        )

        if (
            $run.status -ne
            "RUNNING"
        ) {
            if (
                $run.status -eq
                "SUCCESS"
            ) {
                $Window.status =
                    "SUCCESS"

                $Window.error =
                    $null

                Save-State $State

                return
            }

            $Window.status =
                "FAILED"

            $Window.error =
                (
                    "BACKFILL_FINAL_STATUS_" +
                    $run.status
                )

            Save-State $State

            throw (
                "Historical backfill window failed: " +
                "$($Window.startDate).." +
                "$($Window.endDate) " +
                "status=$($run.status)"
            )
        }

        $body = @{
            runId =
                $runId

            maxTasks =
                $BatchSize

            requestDelayMs =
                $DelayMs
        } |
            ConvertTo-Json `
                -Compress

        try {
            $process =
                Invoke-RestMethod `
                    -Uri (
                        "$BaseUrl/api/market/data/v8/" +
                        "backfill/process"
                    ) `
                    -Method POST `
                    -ContentType "application/json" `
                    -Body $body `
                    -TimeoutSec 300 `
                    -ErrorAction Stop

            Write-Host (
                "  batch processed={0} success={1} " +
                "failure={2} -> status={3}" -f `
                    $process.result.processedTasks, `
                    $process.result.successes, `
                    $process.result.failures, `
                    $process.result.progress.status
            )
        }
        catch {
            Write-Warning (
                $_.Exception.Message
            )

            Start-Sleep `
                -Seconds 5
        }
    }
}

function Run-FinalCoverage {
    $body = @{
        universeCode =
            "KRX_ALL_LISTED"

        startDate =
            $StartDate

        endDate =
            $EndDate

        compilationRunId =
            $CompilationRunId

        minimumOverallBarCoverageRate =
            0.95

        minimumPerMemberCoverageRate =
            0.80

        minimumReadyMemberRate =
            0.80

        isValidation =
            $false
    } |
        ConvertTo-Json `
            -Compress

    return Invoke-RestMethod `
        -Uri (
            "$BaseUrl/api/research/data/v9/" +
            "historical-market-coverage/evaluate"
        ) `
        -Method POST `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 600
}

$state =
    Load-OrCreateState

Write-Host ""
Write-Host "v9.6.3 adaptive windowed Historical OHLCV backfill"
Write-Host "CompilationRunId: $CompilationRunId"
Write-Host "Range: $StartDate .. $EndDate"
Write-Host "Initial window: $WindowCalendarDays calendar days"
Write-Host "KIS safety: every window is <= 120 calendar days by default,"
Write-Host "which is safely below the observed 100 trading-row response cap."
Write-Host "State: $StateFile"
Write-Host ""

$completedThisInvocation =
    0

$index =
    0

while (
    $index -lt
    $state.windows.Count
) {
    $window =
        $state.windows[
            $index
        ]

    if (
        $window.status -eq
        "SUCCESS"
    ) {
        $index++
        continue
    }

    if (
        $MaxWindows -gt 0 -and
        $completedThisInvocation -ge
        $MaxWindows
    ) {
        Write-Host ""
        Write-Host (
            "MaxWindows=$MaxWindows reached. " +
            "State saved; rerun the same command to resume."
        )

        exit 0
    }

    Write-Host ""
    Write-Host (
        "=== Window {0}/{1}: {2} .. {3} ===" -f `
            (
                $index +
                1
            ), `
            $state.windows.Count, `
            $window.startDate, `
            $window.endDate
    )

    if (
        -not $window.runId
    ) {
        $window.status =
            "PLANNING"

        Save-State $state

        try {
            $create =
                Create-WindowRun `
                    -Window $window

            $window.runId =
                [string]$create.result.run_id

            $window.taskCount =
                [int]$create.result.task_count

            $window.expectedBarCount =
                [long]$create.result.expected_bar_count

            $window.availableBarCount =
                [long]$create.result.available_bar_count

            $window.missingBarCount =
                [long]$create.result.missing_bar_count

            $window.selectedSecurityCount =
                [int]$create.result.selected_security_count

            $window.status =
                "RUNNING"

            $window.error =
                $null

            Save-State $state

            Write-Host (
                "Created run={0} tasks={1} " +
                "expected={2} availableBefore={3} missing={4}" -f `
                    $window.runId, `
                    $window.taskCount, `
                    $window.expectedBarCount, `
                    $window.availableBarCount, `
                    $window.missingBarCount
            )
        }
        catch {
            $errorText =
                [string]$_

            $window.error =
                $errorText

            Save-State $state

            if (
                $errorText -match
                "statement timeout"
            ) {
                Split-WindowAtIndex `
                    -State $state `
                    -Index $index

                continue
            }

            $window.status =
                "FAILED"

            Save-State $state

            throw
        }
    }

    Process-WindowRun `
        -Window $window `
        -State $state

    $completedThisInvocation++

    $index++
}

Write-Host ""
Write-Host "All historical backfill windows finished."
Write-Host "Running independent v9.6 PIT-aware coverage evaluator..."

$coverage =
    Run-FinalCoverage

$state.finalCoverage =
    $coverage.result

Save-State $state

$coverage |
    ConvertTo-Json `
        -Depth 50

Write-Host ""
Write-Host (
    "FINAL V9.6 COVERAGE STATUS = " +
    $coverage.result.status
)

Write-Host (
    "overallBarCoverageRate = " +
    $coverage.result.summary.coverage.overallBarCoverageRate
)

Write-Host (
    "readyMemberRate = " +
    $coverage.result.summary.coverage.readyMemberRate
)
