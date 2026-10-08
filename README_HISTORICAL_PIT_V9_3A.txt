AI STOCK LAB - v9.3A HISTORICAL PIT INGESTION FOUNDATION

This stage can be completed before KRX API approval.

Implemented:
- provider-neutral HistoricalUniverseProvider interface
- normalized daily historical snapshot payload
- raw snapshot audit tables
- SHA-256 evidence fingerprint / idempotent imports
- COMPLETE / PARTIAL / UNKNOWN coverage status
- DB-clock finished_at to avoid Node/DB clock skew
- canonical stock_universe_memberships remain untouched

Why this matters:
When KRX approval arrives, only the provider adapter needs to be added.
The storage/audit/normalization pipeline is already complete.

Do NOT populate old dates using today's 2,689 surviving securities.
Historical snapshots remain staging evidence until daily completeness and
delisted-security coverage are proven.
