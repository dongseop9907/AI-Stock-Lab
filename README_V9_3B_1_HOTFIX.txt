AI STOCK LAB - v9.3B.1 VALIDATION HARNESS HOTFIX

Observed result:
- expected intervals == actual intervals
- all functional assertions were true
- cleanup succeeded
- canonical memberships were untouched

Why status was FAIL:
The validator included `productionApplied: false` inside an assertion object and
then evaluated every assertion with `value === true`.

Therefore the safety condition itself forced PASS -> FAIL.

Fix:
`productionApplied: false` in the assertion set is replaced by
`productionNotApplied: true`.

The returned safety object still correctly reports:
`productionApplied: false`.

No database migration is required.
The previous FAIL audit row should be kept as historical evidence.
Rerunning validation should create a new PASS audit row.
