AI STOCK LAB - v9.3C KRX HISTORICAL PIT PROVIDER

Confirmed KRX input:
2023-01-02
KOSPI stk_isu_base_info = 943 rows
KOSDAQ ksq_isu_base_info = 1,615 rows

v9.3C fetches both markets by basDd and normalizes them into the existing
v9.3A staging contract:
- historical_universe_snapshot_imports
- historical_universe_snapshot_rows

Then the already-validated v9.3B compiler can build:
[valid_from, valid_to) PIT membership intervals.

Safety:
- no current-universe backfill into the past
- both KOSPI and KOSDAQ calls must succeed
- implausibly small responses fail closed
- existing COMPLETE provider/date imports are reused
- no canonical stock_universe_memberships mutation
- no production trading/risk behavior

Important caveat:
KRX stock-base-info proves listing membership. It does not independently prove
non-suspension/tradability. Later historical bar/liquidity gates handle actual
data/trading availability.

Recommended rollout:
1) /validate: compare 2023-01-02 and 2026-08-14 with NO DB writes.
2) pilot import: 2023-01-02 through 2023-01-06.
3) compile pilot using existing v9.3B and provider:
   KRX_OPEN_API_STOCK_BASE_V1
4) only then run full 2023-01-02 through 2026-08-10.

Approximate full request scale:
~879 trading dates * 2 KRX requests ~= 1,758 requests before reuse.
