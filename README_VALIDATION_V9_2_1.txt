AI STOCK LAB
v9.2.1 HISTORICAL PIT BINDING

CONFIRMED HISTORICAL PIT
------------------------
Compilation run:
  294e193f-fc56-42cd-a972-a6ddbed56769

Range:
  2023-01-02 .. 2026-07-31

Coverage:
  expected = 873
  imported = 873
  missing  = 0
  duplicate= 0

Chunk compiler:
  88 / 88 SUCCESS

Compiled intervals:
  4934

Regression:
  2023-01 month = 2527
  exact match with previous compiler output

Observed fold PIT membership counts:
  fold 1 = 2614
  fold 2 = 2635
  fold 3 = 2660
  fold 4 = 2685
  fold 5 = 2709
  fold 6 = 2711
  fold 7 = 2712
  fold 8 = 2726

All observed folds are well above minimumPitMembers=500.

WHY v9.2.1 IS REQUIRED
----------------------
Original v9.2 reads canonical/current PIT membership storage.

Historical v9.3B.3 intentionally writes:
  public.historical_universe_compiled_memberships

v9.2.1 does NOT copy historical staging intervals into the canonical table.

Instead each validation plan binds explicitly to:
  alpha_validation_plans.pit_compilation_run_id

Every fold test-start resolves membership from that exact READY compilation.

INSTALL
-------
1. Run 059_historical_pit_binding_v9_2_1.sql in Supabase SQL Editor.
2. Copy the migration into supabase/migrations.
3. Run install-validation-v9-2-1.ps1.
4. npx.cmd tsc --noEmit
5. npm.cmd run build
6. restart server

TEST
----
POST:
  /api/research/validation/v9/purged-walk-forward/historical-plan

Use compilationRunId:
  294e193f-fc56-42cd-a972-a6ddbed56769

Use endDate:
  2026-07-31

Expected:
  status = READY
  pitBlocked = 0
  each fold pitCoverage.status = READY
  productionApplied = false

Do not extend this plan beyond 2026-07-31 until historical PIT compilation
coverage is explicitly extended.
