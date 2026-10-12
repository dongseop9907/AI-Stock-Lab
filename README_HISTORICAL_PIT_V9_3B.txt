AI STOCK LAB - v9.3B HISTORICAL PIT INTERVAL COMPILER

This stage works without KRX API approval.

What it proves:
- one COMPLETE snapshot is required for every trading date
- missing dates fail closed
- duplicate COMPLETE snapshots fail closed
- membership intervals use [valid_from, valid_to)
- disappearance closes an interval
- later appearance opens a new interval
- re-entry produces separate intervals
- canonical stock_universe_memberships are untouched

Synthetic validation:
V93001 continuous -> one interval
V93002 disappears -> interval closes on first absent trading date
V93003 appears later -> interval starts on first present trading date
V93004 present, absent, present -> two distinct intervals

Validation artifacts are deleted after the test.
Only the validation audit row remains.

When KRX data arrives:
KRX adapter -> v9.3A raw imports -> v9.3B compiler -> later gated promotion.
