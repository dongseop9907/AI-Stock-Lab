# AI Stock Lab - register SHADOW 08:50 task
$ErrorActionPreference = "Stop"

$TaskName = 'AI Stock Lab - SHADOW 0850'
$Runner = 'C:\Users\user\Desktop\ai-stock-lab\scripts\run-shadow-controlled-producer-0850.ps1'
$PowerShellExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

$Action = New-ScheduledTaskAction -Execute $PowerShellExe -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $Runner + '"')
$Trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 08:50
$Settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$Task = New-ScheduledTask -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description "AI Stock Lab SHADOW controlled producer. Weekdays 08:50 local time. Fail-closed outside controlled window. No PAPER promotion or real trading."

Register-ScheduledTask -TaskName $TaskName -InputObject $Task -Force | Out-Null

$Registered = Get-ScheduledTask -TaskName $TaskName
$Info = Get-ScheduledTaskInfo -TaskName $TaskName

[pscustomobject]@{
    TaskName = $Registered.TaskName
    State = $Registered.State.ToString()
    NextRunTime = $Info.NextRunTime
    WakeToRun = [bool]$Registered.Settings.WakeToRun
    StartWhenAvailable = [bool]$Registered.Settings.StartWhenAvailable
    Enabled = ($Registered.State.ToString() -ne 'Disabled')
    User = $CurrentUser
    Schedule = "MON-FRI 08:50 local time"
    Runner = $Runner
} | ConvertTo-Json -Depth 5
