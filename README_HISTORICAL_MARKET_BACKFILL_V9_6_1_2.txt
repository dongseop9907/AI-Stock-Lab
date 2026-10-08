AI STOCK LAB
v9.6.1 HISTORICAL SECURITY MASTER RECONCILIATION
v9.6.2 PIT-AWARE HISTORICAL OHLCV BACKFILL

Confirmed inputs
----------------
PIT compilation:
  294e193f-fc56-42cd-a972-a6ddbed56769

Historical codes: 2943
Missing from current security master: 300
Historical COMMON: 2820
COMMON names that look like SPAC: 185
Alphanumeric codes: 78

Historical OHLCV coverage:
  expected bars : 2,313,473
  available     :   148,068
  missing       : 2,165,405
  coverage      : 6.40%

Identity interpretation
-----------------------
The name/market-change list is dominated by legitimate time-varying events:
company renames, KOSDAQ/KOSPI transfers, and SPAC-to-operating-company
transformations.

market_daily_bars can keep stock_code as its reference key for this research
window, while historical name/market truth remains in PIT intervals.

v9.6.1
------
- inserts ONLY missing historical stock codes into stock_universe_securities
- never overwrites current KIS master rows
- does not infer listing_date or delisting_date from PIT boundaries
- stores historical name/market evidence in metadata
- permits alphanumeric KRX codes
- changes no current universe membership

v9.6.2
------
- derives tasks from exact compiled PIT intervals
- converts [valid_from,valid_to) to inclusive trading-day fetch ranges
- creates a task only when valid OHLCV is missing
- supports a stockCodes pilot filter
- reuses the existing proven v8.3 worker/lease/retry/resume engine
- current universe is never substituted

Install
-------
1. Run migration 060 in Supabase SQL Editor.
2. Copy it to supabase/migrations.
3. Run install-historical-market-backfill-v9-6-1-2.ps1.
4. npx.cmd tsc --noEmit
5. npm.cmd run build
6. restart server

Recommended pilot codes
-----------------------
000060  메리츠화재
001880  DL건설
008560  메리츠증권
010050  우리종금

A worker SUCCESS is not final proof of dataset completeness. Final proof is a
fresh v9.6 coverage evaluation after backfill.

Production
----------
production_applied=false
orders unchanged
risk unchanged
current universe memberships unchanged
