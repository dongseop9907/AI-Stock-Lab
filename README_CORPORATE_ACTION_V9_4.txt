AI STOCK LAB - v9.4 CORPORATE ACTION FOUNDATION

Purpose:
Prevent stock splits and other corporate actions from being mistaken for real
Alpha returns.

v9.4 deterministic adjustment support:
- STOCK_SPLIT
- REVERSE_SPLIT

Recorded but NOT automatically adjusted:
- CASH_DIVIDEND
- STOCK_DIVIDEND
- RIGHTS_ISSUE
- SPIN_OFF
- MERGER
- OTHER

Important:
Raw market_daily_bars are never updated.

Research consumers use:
market_daily_bars_split_adjusted_v9_4

Timing:
An action effective on date D applies to bars STRICTLY BEFORE D.

2-for-1 split:
ratioFrom=1
ratioTo=2
price factor=0.5
share factor=2.0

The adjusted view uses only the LATEST READY non-validation adjustment run for
each stock. This prevents duplicate adjustment when factors are rebuilt.

Synthetic validation:
- records a 2-for-1 split
- records a reverse split
- records a cash dividend
- proves only the two split-family actions produce deterministic factors
- verifies cumulative factor arithmetic
- removes synthetic artifacts afterward

No KRX API key is required for this foundation.
A future provider adapter can populate real corporate-action events later.
