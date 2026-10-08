AI STOCK LAB - v9.2 PURGED / EMBARGO VALIDATION FOUNDATION

PURPOSE
Define the historical research protocol before running historical Alpha tests.

Default:
Training 252 trading days
Purge   20 trading days
Test    63 trading days
Embargo 5 trading days
Label horizon 20 trading days

Key rule:
purge_days >= label_horizon_days

WHY
If a training sample's future-return label overlaps the test period, the model can
see information that belongs to the future test window. Purging removes that overlap.

The embargo gap adds additional separation between evaluation periods.

POINT-IN-TIME GATE
Every fold test-start is checked against stock_universe_memberships.

Current project state is expected to return:
BLOCKED_PIT_COVERAGE

because the broad KRX universe has only been observed from 2026-08-03 onward.
Past dates are deliberately NOT populated using today's surviving securities.

This is correct behavior.

v9.3 will build the historical point-in-time universe, including delisted names.
Only after v9.3 can the v9.2 validation plan become READY.

This stage:
- does not train Alpha
- does not backtest
- does not create orders
- does not claim performance
