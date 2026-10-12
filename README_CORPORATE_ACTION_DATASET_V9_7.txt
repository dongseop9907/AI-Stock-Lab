AI STOCK LAB - v9.7 CORPORATE ACTION DATASET COVERAGE EVALUATOR

Why this exists:
Corporate actions are sparse.

If a database contains zero dividend/split rows for a date, that does NOT prove
that zero actions happened. Missing provider data and "no event" look identical.

Therefore v9.7 never infers completeness from event-row absence.

A COMPLETE corporate_action_coverage_assertion requires:
1. READY Historical PIT compilation covering the requested range.
2. Explicit COMPLETE provider/source coverage window.
3. Every PIT market is included in that source coverage.
4. Every required corporate-action type is included.

Default required action types:
- STOCK_SPLIT
- REVERSE_SPLIT
- CASH_DIVIDEND
- STOCK_DIVIDEND
- RIGHTS_ISSUE
- SPIN_OFF
- MERGER

If Historical PIT is missing:
BLOCKED_PIT

If PIT exists but explicit source coverage is missing:
BLOCKED_SOURCE_COVERAGE

Only COMPLETE/PARTIAL source evidence can create a real assertion.
A COMPLETE assertion is already consumed by the v9.5 backtest gate.

The synthetic validator:
- creates one validation-only PIT member,
- creates one COMPLETE source coverage window,
- covers its market + all required action types,
- expects COMPLETE,
- removes every synthetic artifact afterward.

No real corporate_action_events are changed.
No canonical stock_universe_memberships are changed.
productionApplied stays false.
