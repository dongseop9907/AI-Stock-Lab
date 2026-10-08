AI STOCK LAB - v9.6.1 TYPESCRIPT HOTFIX

Observed compiler error:
Property 'counts' / 'coverage' does not exist on the BLOCKED_PIT summary branch.

Cause:
evaluateHistoricalMarketDataCoverageV96 has two legitimate response shapes:

BLOCKED_PIT:
summary = {
  pitCompilation,
  reason,
  currentUniverseSubstituted,
  productionApplied
}

PIT-ready coverage evaluation:
summary = {
  pitCompilation,
  criteria,
  counts,
  coverage,
  worstCoverage,
  safety
}

The synthetic validator knows it supplied a READY validation-only PIT
compilation, but TypeScript still correctly requires the union to be narrowed.

Fix:
Before reading summary.counts / summary.coverage, v9.6.1 verifies:

"counts" in result.summary
"coverage" in result.summary

If not, validation throws:
V9_6_VALIDATION_UNEXPECTED_STATUS_<STATUS>

The patch updates BOTH:
- project-root validate-historical-market-data-coverage-v9-6.ts
- lib/research/validate-historical-market-data-coverage-v9-6.ts

because the current tsconfig is compiling both copies, which is why the same
7 errors appeared twice.

No SQL migration is needed.
