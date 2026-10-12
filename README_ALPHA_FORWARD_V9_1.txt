AI STOCK LAB - v9.1 ALPHA FORWARD OUTCOME EVALUATOR

Purpose
- Accumulate honest forward evidence for research alpha signals.
- Signal features use information through signal_date.
- Entry = next actual trading day's OPEN.
- Exit = close of trading-day horizon 1/3/5/10/20.
- Missing future bars remain PENDING_FUTURE_DATA.

Reports
- average and median forward return
- positive-return rate
- selected vs unselected
- top-rank quartile vs bottom-rank quartile
- top-minus-bottom average-return spread
- cohort completion rate

Important
- One forward cohort is not proof of Alpha.
- production_applied remains false.
- No order, Risk Engine, or production-model behavior is changed.
