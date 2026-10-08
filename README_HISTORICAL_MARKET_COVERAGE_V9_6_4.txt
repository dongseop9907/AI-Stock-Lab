AI STOCK LAB
v9.6.4 Historical Market Data Coverage - Adaptive Pagination Hotfix

PROBLEM
-------
The complete Historical PIT OHLCV dataset is now large enough that the
existing v9.6 coverage RPC times out even at offset 0.

The existing evaluator already paginates securities, but uses:

    const pageSize = 500;

The database error is:

    v9.6 coverage RPC failed at offset 0:
    canceling statement due to statement timeout

WHY THIS HOTFIX
---------------
Do NOT rerun Historical PIT.
Do NOT rerun the OHLCV backfill.
Do NOT increase data completeness thresholds.
Do NOT substitute the current universe.

This hotfix changes only the RPC computation batch size.

New behavior:
- initial batch: 50 securities
- if statement timeout: retry same offset with 25
- if still timeout: 12
- final minimum: 10
- non-timeout errors still fail closed

The exact v9.6 coverage semantics remain unchanged:
- exact Historical PIT membership intervals
- positive OHLC
- non-null, non-negative volume
- overall coverage threshold >= 0.95
- per-member coverage threshold >= 0.80
- ready-member threshold >= 0.80
- productionApplied = false

INSTALL
-------
Extract the zip into:

    C:\Users\user\Desktop\ai-stock-lab

Then run:

powershell.exe `
  -ExecutionPolicy Bypass `
  -File ".\patch-historical-market-coverage-v9-6-4.ps1"

Then:

npx.cmd tsc --noEmit
npm.cmd run build

taskkill /IM node.exe /F

Start-ScheduledTask `
  -TaskName "AI Stock Lab Server"

Start-Sleep -Seconds 15

Invoke-RestMethod `
  -Uri "http://localhost:3000/api/health" `
  -Method GET |
  ConvertTo-Json -Depth 20

RE-RUN FINAL COVERAGE
---------------------
$body = @{
    universeCode =
      "KRX_ALL_LISTED"

    startDate =
      "2023-01-02"

    endDate =
      "2026-07-31"

    compilationRunId =
      "294e193f-fc56-42cd-a972-a6ddbed56769"

    minimumOverallBarCoverageRate =
      0.95

    minimumPerMemberCoverageRate =
      0.80

    minimumReadyMemberRate =
      0.80

    isValidation =
      $false
} | ConvertTo-Json -Compress

$coverage = Invoke-RestMethod `
  -Uri "http://localhost:3000/api/research/data/v9/historical-market-coverage/evaluate" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body `
  -TimeoutSec 600

$coverage |
  ConvertTo-Json -Depth 50

SUCCESS CRITERIA
----------------
Expected:
- status = COMPLETE
- observedMemberCount around 2943
- overallBarCoverageRate >= 0.95
- readyMemberRate >= 0.80

If the request still times out at pageSize=10, do not raise PostgreSQL
statement_timeout blindly. The next step would be a persisted chunked
coverage worker/RPC, but this adaptive hotfix should be tried first because
the current failure occurred with an unnecessarily large 500-security page.
