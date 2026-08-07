$ErrorActionPreference = "Stop"

$ProjectRoot =
    "C:\Users\user\Desktop\ai-stock-lab"

$Runner =
    Join-Path `
        $ProjectRoot `
        "run-market-eod-sync.ps1"

$TaskName =
    "AI Stock Lab EOD Sync"

if (
    -not (
        Test-Path $Runner
    )
) {
    throw "RUNNER_NOT_FOUND: $Runner"
}

$PowerShellExe =
    "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

$arguments =
    '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $Runner

$action =
    New-ScheduledTaskAction `
        -Execute $PowerShellExe `
        -Argument $arguments `
        -WorkingDirectory $ProjectRoot

<#
Run Monday-Friday at 17:10 local Windows time.
This deliberately leaves a buffer after market close and after
the v7.7 16:30 freshness-ready threshold.
#>
$trigger =
    New-ScheduledTaskTrigger `
        -Weekly `
        -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday `
        -At "17:10"

$settings =
    New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (
            New-TimeSpan `
                -Hours 1
        )

$principal =
    New-ScheduledTaskPrincipal `
        -UserId $env:USERNAME `
        -LogonType Interactive `
        -RunLevel Limited

$task =
    New-ScheduledTask `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal

Register-ScheduledTask `
    -TaskName $TaskName `
    -InputObject $task `
    -Force |
    Out-Null

Write-Host ""
Write-Host "Scheduled task installed."
Write-Host "Task: $TaskName"
Write-Host "Schedule: Monday-Friday 17:10 local time"
Write-Host "Runner: $Runner"
Write-Host ""
Write-Host "Test manually with:"
Write-Host "  Start-ScheduledTask -TaskName `"$TaskName`""
Write-Host ""
Write-Host "Then inspect:"
Write-Host "  Get-ScheduledTaskInfo -TaskName `"$TaskName`""