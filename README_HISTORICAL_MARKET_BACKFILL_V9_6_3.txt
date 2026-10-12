AI STOCK LAB
v9.6.3 ADAPTIVE WINDOWED HISTORICAL OHLCV BACKFILL

WHY v9.6.3
----------
The real four-security pilot proved two things:

1. KIS historical/delisted data works.
   000060 (Meritz Fire) returned and saved 34/34 historical bars.

2. Long date ranges are silently truncated by the KIS daily endpoint.
   DL Construction and Woori Investment Finance each returned exactly
   100 rows even though their PIT intervals were much longer.

The full v9.6.2 planner also failed with:
  canceling statement due to statement timeout

v9.6.3 fixes both issues WITHOUT replacing the proven v8.3 worker or
rewriting database migrations.

DESIGN
------
The full 2023-01-02..2026-07-31 range is split into <=120 calendar-day
windows.

120 calendar days contain at most about 86 weekdays, so one KIS request
cannot require 100 trading rows. This stays below the empirically observed
100-row cap.

For each window:
  1. Call the existing v9.6.2 PIT-aware planner.
  2. If the planner hits PostgreSQL statement_timeout, automatically split
     that window in half and retry.
  3. Run the existing v8.3 persistent lease/retry worker.
  4. Save progress to a local JSON state file.
  5. Resume from that state file after interruption.

After every window is complete, the script automatically reruns the
independent v9.6 Historical Market Data Coverage evaluator. That evaluator,
not worker SUCCESS, is the final data-completeness authority.

FILES
-----
run-historical-market-backfill-v9-6-3.ps1

NO NEW SQL MIGRATION IS REQUIRED.
NO EXISTING TYPESCRIPT FILE IS MODIFIED.
NO PRODUCTION TRADING LOGIC IS MODIFIED.

FIRST RUN
---------
Use one window first:

powershell.exe `
  -ExecutionPolicy Bypass `
  -File ".\run-historical-market-backfill-v9-6-3.ps1" `
  -MaxWindows 1 `
  -WindowCalendarDays 120 `
  -BatchSize 10 `
  -DelayMs 1500

The state is saved to:
  .\logs\historical-market-backfill-v9-6-3-state.json

If that first window finishes SUCCESS, resume all remaining windows simply by
running the same script without -MaxWindows:

powershell.exe `
  -ExecutionPolicy Bypass `
  -File ".\run-historical-market-backfill-v9-6-3.ps1" `
  -WindowCalendarDays 120 `
  -BatchSize 10 `
  -DelayMs 1500

IMPORTANT
---------
Do not delete the state file while the job is in progress.

If you intentionally want to start the entire v9.6.3 orchestration over,
rename or remove the state file first.

The existing pilot bars are safe. v9.6.2 skips fully covered PIT periods and
market_daily_bars uses upsert identity by stock_code + trading_date.

Expected total runtime can be many hours because thousands of securities are
processed with a conservative request delay. Resume is intentional.

FINAL GATE
----------
When all windows are done, the script automatically runs:

POST /api/research/data/v9/historical-market-coverage/evaluate

Target:
  overallBarCoverageRate >= 0.95
  readyMemberRate >= 0.80

If v9.6 is still INSUFFICIENT_DATA after this, inspect the remaining missing
securities/dates before proceeding to v9.7. Do not fake or forward-fill
missing market data.
