AI STOCK LAB
v9.3B.2 DB-SIDE HISTORICAL PIT COMPILER

Observed state
--------------
Full KRX source coverage is complete:

2023-01-02 .. 2026-07-31
expected trading dates : 873
COMPLETE import dates   : 873
missing dates           : 0
duplicate dates         : 0
raw snapshot rows       : 2,313,473

Legacy full compilation run:
2a97528b-8037-4c54-a04a-a1da0d97ae17

It remained RUNNING with compiled_interval_count=0 after the HTTP request
returned 500.

Root cause addressed
--------------------
Legacy v9.3B first loaded every daily snapshot into one Node Map before doing
any interval work. With 873 dates and 2.3M+ rows, the Next.js worker becomes
the bottleneck.

v9.3B.2 keeps only the small date/import coverage preflight in Node and moves
the expensive interval-island calculation into PostgreSQL.

Interval semantics preserved
----------------------------
The DB compiler opens a new interval when:
1. the stock first appears,
2. the stock has a trading-date gap and later re-enters,
3. stock name / market / sector / security type / listed / tradable changes.

It preserves:
[valid_from, valid_to)

Evidence compaction
-------------------
All raw daily v9.3A snapshots remain intact.

A compiled interval stores only:
- first import ID
- last import ID
- evidence snapshot count
- first/last evidence date

instead of hundreds of duplicate UUIDs for long-lived securities.

Recommended rollout
-------------------
1. Run 057_historical_pit_db_compiler_v9_3b_2.sql in Supabase.
2. Copy it to supabase/migrations.
3. Run mark-legacy-v9-3b-full-run-failed.sql once.
4. Run install-historical-pit-compiler-v9-3b-2.ps1.
5. npx.cmd tsc --noEmit
6. npm.cmd run build
7. restart server
8. Re-run the existing v9.3B synthetic validation.
9. Regression compile 2023-01-02..2023-01-31.
   Expected interval count from legacy compiler: 2527.
10. Only if the month regression is 2527, run full 873-date compile.

Safety
------
- canonical stock_universe_memberships is untouched
- no production trading/risk changes
- missing/duplicate COMPLETE snapshots still fail closed
