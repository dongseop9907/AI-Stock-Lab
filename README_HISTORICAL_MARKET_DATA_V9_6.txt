AI STOCK LAB - v9.6 HISTORICAL MARKET DATA COVERAGE EVALUATOR

Purpose:
Measure whether broad historical OHLCV coverage is actually sufficient for a
future leakage-safe Alpha backtest.

Key rule:
Expected bars are generated from the exact historical PIT membership intervals.

The evaluator NEVER does:
today's universe -> past dates

If Historical PIT is absent:
status = BLOCKED_PIT
no historical_market_data_coverage_assertion is written.

When PIT exists, each security gets:
expected bars
available bars
missing bars
coverage rate
first/last expected date
first/last available date
data-ready flag

Default completion criteria:
overall bar coverage >= 95%
per-security ready threshold >= 80%
at least 80% of PIT members are data-ready

A COMPLETE result writes the evidence table already consumed by v9.5:
historical_market_data_coverage_assertions

Synthetic validator:
Uses one real security that already has complete bars across four recent market
dates, creates a temporary validation-only PIT interval, expects 100% coverage,
then deletes all temporary artifacts.

Real historical market_daily_bars are never modified.
Canonical PIT memberships are never modified.
