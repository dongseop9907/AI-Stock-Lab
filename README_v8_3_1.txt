v8.3.1 MARKET DAILY BARS FK FIX

WHY
market_daily_bars.stock_code still referenced the old legacy stocks table.
The v8.3 KIS worker successfully received 305 rows in the first 5 tasks,
but every insert failed because newly collected KRX codes are represented
by stock_universe_securities, not by the legacy 5-row stocks table.

FIX
market_daily_bars.stock_code now references:
  stock_universe_securities(stock_code)

NOT:
  stocks(stock_code)

The migration also resets only tasks whose last_error contains:
  market_daily_bars_stock_code_fkey

Their attempts return to zero, so the existing run can be resumed safely.

IMPORTANT
Stop run-market-data-backfill-v8-3.ps1 with Ctrl+C BEFORE applying migration 045.
