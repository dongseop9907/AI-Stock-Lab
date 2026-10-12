AI STOCK LAB
v9.3B.3 RESUMABLE CHUNKED DB HISTORICAL PIT COMPILER

Confirmed blocker
-----------------
Full KRX coverage is complete:
  expected trading dates = 873
  COMPLETE imports       = 873
  missing                = 0
  duplicate              = 0
  raw snapshot rows      = 2,313,473

v9.3B.2 correctness was proven:
  synthetic validation PASS
  2023-01 regression = 2527 intervals, exactly matching legacy v9.3B

The full v9.3B.2 run failed only because PostgreSQL/PostgREST cancelled the
single large statement:
  canceling statement due to statement timeout

Database size after expansion:
  1649 MB

Compiled staging table:
  10,564 rows / 28 MB

v9.3B.3 design
---------------
Default chunk = 10 trading days.

Each RPC:
1. validates COMPLETE snapshot coverage inside the chunk
2. computes interval islands only for that chunk
3. merges metadata-identical continuous intervals at the chunk boundary
4. inserts the remaining new intervals
5. commits

This preserves:
- [valid_from, valid_to)
- delisting/disappearance
- new listing
- re-entry
- metadata-change boundaries

The run is resumable using:
  historical_universe_compilation_chunks

Recommended regression
----------------------
First run 2023-01-02..2023-01-31 with chunkTradingDays=5.
Expected final compiled_interval_count:
  2527

Only after that matches, create the full 2023-01-02..2026-07-31 run with
chunkTradingDays=10.

The old v9.3B.2 route remains untouched for small regression and synthetic
validation.
